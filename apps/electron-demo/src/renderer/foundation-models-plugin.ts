import { Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { EditorAPI, NexusPlugin } from "@floatboat/nexus-core";
import { findSuggestionContext } from "./foundation-models-context";
import type { FoundationModelsBridge, NativeAvailability } from "./foundation-models";

const REQUEST_DELAY_MS = 500;

interface VisibleSuggestion {
  from: number;
  to: number;
  text: string;
}

class SuggestionWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "nexus-foundation-suggestion";
    span.setAttribute("aria-hidden", "true");
    span.setAttribute("contenteditable", "false");
    span.textContent = this.text;
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }

  eq(other: SuggestionWidget): boolean {
    return other.text === this.text;
  }
}

const setSuggestion = StateEffect.define<VisibleSuggestion | null>();

const suggestionField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSuggestion)) {
        const suggestion = effect.value;
        if (!suggestion) return Decoration.none;
        return Decoration.set([
          Decoration.widget({
            widget: new SuggestionWidget(suggestion.text),
            side: 1,
          }).range(suggestion.to),
        ]);
      }
    }
    if (transaction.docChanged) {
      return Decoration.none;
    }
    return value.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const suggestionTheme = EditorView.theme({
  ".nexus-foundation-suggestion": {
    color: "var(--nexus-text-muted,var(--nexus-text-faint,#8a8a8a))",
    opacity: "0.78",
    pointerEvents: "none",
    whiteSpace: "pre-wrap",
  },
});

function hasSingleCollapsedSelection(view: EditorView): boolean {
  const selection = view.state.selection;
  return selection.ranges.length === 1 && selection.main.empty;
}

function selectionMatches(view: EditorView, position: number): boolean {
  return hasSingleCollapsedSelection(view) && view.state.selection.main.head === position;
}

export interface FoundationModelsController {
  setEnabled(enabled: boolean): void;
  setAvailability(availability: NativeAvailability): void;
  clear(): void;
  dispose(): void;
}

export function createFoundationModelsPlugin(options: {
  bridge: FoundationModelsBridge;
  enabled: boolean;
  availability: NativeAvailability;
  onStateChange?: () => void;
}): NexusPlugin & { controller: FoundationModelsController } {
  let view: EditorView | null = null;
  let enabled = options.enabled;
  let availability = options.availability;
  let bridge: FoundationModelsBridge | null = options.bridge;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let requestId = 0;
  let visibleSuggestion: VisibleSuggestion | null = null;
  let disposed = false;

  function emitStateChange(): void {
    options.onStateChange?.();
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function renderSuggestion(next: VisibleSuggestion | null): void {
    visibleSuggestion = next;
    const currentView = view;
    if (currentView) {
      currentView.dispatch({ effects: setSuggestion.of(next) });
    }
    emitStateChange();
  }

  function clear(): void {
    requestId += 1;
    clearTimer();
    if (visibleSuggestion) {
      renderSuggestion(null);
    }
  }

  function clearDuringUpdate(currentView: EditorView, clearsDecorationImmediately: boolean): void {
    requestId += 1;
    clearTimer();
    if (!visibleSuggestion) {
      return;
    }

    visibleSuggestion = null;
    emitStateChange();

    if (!clearsDecorationImmediately) {
      queueMicrotask(() => {
        if (!disposed && view === currentView && visibleSuggestion === null) {
          currentView.dispatch({ effects: setSuggestion.of(null) });
        }
      });
    }
  }

  function canRequest(): boolean {
    return !disposed && enabled && availability.available && bridge !== null;
  }

  function schedule(currentView: EditorView): void {
    view = currentView;

    if (!canRequest() || !hasSingleCollapsedSelection(currentView)) {
      return;
    }

    const documentText = currentView.state.doc.toString();
    const position = currentView.state.selection.main.head;
    const context = findSuggestionContext(documentText, position);
    if (!context) {
      return;
    }

    const scheduledBridge = bridge;
    if (!scheduledBridge) {
      return;
    }

    const currentRequest = ++requestId;
    timer = setTimeout(() => {
      timer = null;
      void (async () => {
        let suggestion: string | null = null;
        try {
          suggestion = await scheduledBridge.suggest(context.paragraph);
        } catch {
          suggestion = null;
        }

        if (
          disposed ||
          currentRequest !== requestId ||
          !suggestion ||
          !view ||
          view.state.doc.toString() !== documentText ||
          !selectionMatches(view, context.to)
        ) {
          return;
        }

        renderSuggestion({
          from: context.to,
          to: context.to,
          text: suggestion,
        });
      })();
    }, REQUEST_DELAY_MS);
  }

  function handleUpdate(update: ViewUpdate): void {
    view = update.view;
    if (update.docChanged || update.selectionSet) {
      clearDuringUpdate(update.view, update.docChanged);
      schedule(update.view);
    }
  }

  const controller: FoundationModelsController = {
    setEnabled(nextEnabled) {
      if (disposed || enabled === nextEnabled) {
        return;
      }
      enabled = nextEnabled;
      clear();
      if (view) {
        schedule(view);
      }
    },
    setAvailability(nextAvailability) {
      if (disposed) {
        return;
      }
      availability = nextAvailability;
      clear();
      if (view) {
        schedule(view);
      }
    },
    clear,
    dispose() {
      disposed = true;
      requestId += 1;
      clearTimer();
      bridge = null;
      renderSuggestion(null);
      view = null;
    },
  };

  function acceptWithEditor(editor: EditorAPI): boolean {
    if (!visibleSuggestion) {
      return false;
    }

    const selections = editor.getSelections();
    if (
      selections.ranges.length !== 1 ||
      selections.ranges[0].anchor !== selections.ranges[0].head ||
      selections.ranges[0].anchor !== visibleSuggestion.to
    ) {
      return false;
    }

    const accepted = visibleSuggestion;
    controller.clear();
    editor.replaceRange(accepted.from, accepted.to, accepted.text, {
      anchor: accepted.to + accepted.text.length,
    });
    return true;
  }

  function acceptWithView(currentView: EditorView): boolean {
    if (!visibleSuggestion || !hasSingleCollapsedSelection(currentView)) {
      return false;
    }

    const selection = currentView.state.selection.main;
    if (selection.head !== visibleSuggestion.to) {
      return false;
    }

    const accepted = visibleSuggestion;
    requestId += 1;
    clearTimer();
    visibleSuggestion = null;
    currentView.dispatch({
      changes: { from: accepted.from, to: accepted.to, insert: accepted.text },
      selection: { anchor: accepted.to + accepted.text.length },
      effects: setSuggestion.of(null),
      scrollIntoView: true,
    });
    emitStateChange();
    return true;
  }

  function clearVisibleSuggestion(): boolean {
    if (!visibleSuggestion) {
      return false;
    }
    controller.clear();
    return true;
  }

  return {
    name: "foundation-models-inline-suggestions",
    controller,
    shortcuts: [
      {
        key: "Tab",
        run: acceptWithEditor,
      },
      {
        key: "Escape",
        run: () => clearVisibleSuggestion(),
      },
    ],
    cmExtensions: [
      Prec.highest(
        keymap.of([
          {
            key: "Tab",
            run: acceptWithView,
          },
          {
            key: "Escape",
            run: () => clearVisibleSuggestion(),
          },
        ])
      ),
      suggestionField,
      suggestionTheme,
      ViewPlugin.define((pluginView) => {
        view = pluginView;
        return {
          update: handleUpdate,
          destroy() {
            controller.dispose();
          },
        };
      }),
      EditorView.domEventHandlers({
        blur() {
          controller.clear();
          return false;
        },
      }),
    ],
    handlers: {
      keydown(event, ctx) {
        if (event.key === "Escape") {
          return clearVisibleSuggestion();
        }

        if (event.key !== "Tab") {
          return false;
        }

        return acceptWithEditor(ctx.editor);
      },
    },
  };
}
