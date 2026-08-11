import { Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { EditorAPI, NexusPlugin } from "@floatboat/nexus-core";
import { findSuggestionContextFromDoc } from "./foundation-models-context";
import { createFoundationModelsSuggestionCache } from "./foundation-models-cache";
import type { FoundationModelsBridge, NativeAvailability } from "./foundation-models";

const REQUEST_DELAY_MS = 500;
const PROMPT_VERSION = "inline-next-sentence-v2";
const MODEL_VERSION = "foundation-models-default";

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
  getDiagnostics(): FoundationModelsDiagnostics;
  dispose(): void;
}

export interface FoundationModelsDiagnostics {
  contextExtractions: number;
  contextExtractionMs: number;
  scheduledRequests: number;
  cacheHits: number;
  nativeStarts: number;
  nativeCompletions: number;
  cancellations: number;
  staleResults: number;
  renderedSuggestions: number;
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
  let nativeRequestActive = false;
  let disposed = false;
  const cache = createFoundationModelsSuggestionCache({
    suggestionTtlMs: 60_000,
    nullTtlMs: 15_000,
    maxEntries: 64,
  });
  const diagnostics: FoundationModelsDiagnostics = {
    contextExtractions: 0,
    contextExtractionMs: 0,
    scheduledRequests: 0,
    cacheHits: 0,
    nativeStarts: 0,
    nativeCompletions: 0,
    cancellations: 0,
    staleResults: 0,
    renderedSuggestions: 0,
  };

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
    if (next) {
      diagnostics.renderedSuggestions += 1;
    }
    const currentView = view;
    if (currentView) {
      currentView.dispatch({ effects: setSuggestion.of(next) });
    }
    emitStateChange();
  }

  function clear(): void {
    requestId += 1;
    clearTimer();
    cancelActiveSuggestion();
    if (visibleSuggestion) {
      renderSuggestion(null);
    }
  }

  function cancelActiveSuggestion(): void {
    if (!nativeRequestActive) {
      return;
    }
    nativeRequestActive = false;
    diagnostics.cancellations += 1;
    const currentBridge = bridge;
    void currentBridge?.cancelSuggestion().catch(() => undefined);
  }

  function clearDuringUpdate(currentView: EditorView, clearsDecorationImmediately: boolean): void {
    requestId += 1;
    clearTimer();
    cancelActiveSuggestion();
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

    const position = currentView.state.selection.main.head;
    const extractionStart = performance.now();
    const context = findSuggestionContextFromDoc(currentView.state.doc, position);
    diagnostics.contextExtractions += 1;
    diagnostics.contextExtractionMs += performance.now() - extractionStart;
    if (!context) {
      return;
    }

    const scheduledBridge = bridge;
    if (!scheduledBridge) {
      return;
    }

    const currentRequest = ++requestId;
    diagnostics.scheduledRequests += 1;
    timer = setTimeout(() => {
      timer = null;
      void (async () => {
        let suggestion: string | null = null;
        const cacheKey = {
          paragraph: context.paragraph,
          promptVersion: PROMPT_VERSION,
          modelVersion: MODEL_VERSION,
          availability: availability.available ? "available" : availability.reason ?? "unavailable",
        };
        const cached = cache.get(cacheKey);
        if (cached !== undefined) {
          diagnostics.cacheHits += 1;
          suggestion = cached;
        } else {
          nativeRequestActive = true;
          diagnostics.nativeStarts += 1;
          try {
            suggestion = await scheduledBridge.suggest(context.paragraph);
          } catch {
            suggestion = null;
          } finally {
            if (currentRequest === requestId) {
              nativeRequestActive = false;
            }
            diagnostics.nativeCompletions += 1;
          }
          cache.set(cacheKey, suggestion);
        }

        const currentContext = view ? findSuggestionContextFromDoc(view.state.doc, context.to) : null;
        if (
          disposed ||
          currentRequest !== requestId ||
          !suggestion ||
          !view ||
          !selectionMatches(view, context.to) ||
          !currentContext ||
          currentContext.from !== context.from ||
          currentContext.to !== context.to ||
          currentContext.paragraph !== context.paragraph
        ) {
          if (currentRequest !== requestId || !currentContext || currentContext.paragraph !== context.paragraph) {
            diagnostics.staleResults += 1;
          }
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
      cache.clear();
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
      cache.clear();
      clear();
      if (view) {
        schedule(view);
      }
    },
    clear,
    getDiagnostics() {
      return { ...diagnostics };
    },
    dispose() {
      disposed = true;
      requestId += 1;
      clearTimer();
      cancelActiveSuggestion();
      cache.clear();
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
      cancelActiveSuggestion();
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
