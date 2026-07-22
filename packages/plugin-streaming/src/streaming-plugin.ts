import { Extension, StateEffect, StateField, Transaction } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import type { NexusPlugin } from "@floatboat/nexus-core";

/**
 * Options for managing an active AI token streaming session.
 */
export interface StreamingSessionOptions {
  sessionId?: string;
  showShimmerCursor?: boolean;
  shimmerClassName?: string;
  autoScroll?: boolean;
  onChunk?: (chunk: string, totalText: string) => void;
  onFinish?: (fullText: string) => void;
}

/**
 * Internal state representation of a streaming session.
 */
export interface StreamingSessionState {
  active: boolean;
  sessionId: string | null;
  startPos: number;
  currentPos: number;
  text: string;
}

/**
 * State effect payload to initialize a new streaming session.
 */
export interface StartStreamPayload {
  sessionId: string;
  pos: number;
}

/**
 * State effect payload to append a chunk to the active stream.
 */
export interface AppendStreamPayload {
  sessionId: string;
  chunk: string;
}

/**
 * State effect payload to terminate the active stream.
 */
export interface FinishStreamPayload {
  sessionId: string;
}

export const startStreamEffect = StateEffect.define<StartStreamPayload>();
export const appendStreamEffect = StateEffect.define<AppendStreamPayload>();
export const finishStreamEffect = StateEffect.define<FinishStreamPayload>();

const INITIAL_STATE: StreamingSessionState = {
  active: false,
  sessionId: null,
  startPos: 0,
  currentPos: 0,
  text: "",
};

/**
 * StateField tracking active streaming session state and positions.
 */
export const streamingSessionField = StateField.define<StreamingSessionState>({
  create() {
    return INITIAL_STATE;
  },
  update(value, tr) {
    let state = value;
    let appendedInTr = false;

    for (const effect of tr.effects) {
      if (effect.is(startStreamEffect)) {
        state = {
          active: true,
          sessionId: effect.value.sessionId,
          startPos: effect.value.pos,
          currentPos: effect.value.pos,
          text: "",
        };
      } else if (effect.is(appendStreamEffect)) {
        if (state.active && state.sessionId === effect.value.sessionId) {
          const addedLen = effect.value.chunk.length;
          state = {
            ...state,
            currentPos: state.currentPos + addedLen,
            text: state.text + effect.value.chunk,
          };
          appendedInTr = true;
        }
      } else if (effect.is(finishStreamEffect)) {
        if (state.active && state.sessionId === effect.value.sessionId) {
          state = INITIAL_STATE;
        }
      }
    }

    if (state.active && tr.docChanged && !appendedInTr) {
      const newStart = tr.changes.mapPos(state.startPos, 1);
      const newCurrent = tr.changes.mapPos(state.currentPos, 1);
      state = {
        ...state,
        startPos: newStart,
        currentPos: newCurrent,
      };
    }

    return state;
  },
});

/**
 * CodeMirror Widget rendering a typing indicator at the stream position.
 */
export class StreamingCursorWidget extends WidgetType {
  constructor(private readonly className: string = "nexus-streaming-cursor") {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = this.className;
    span.setAttribute("aria-hidden", "true");
    span.setAttribute("data-nexus-streaming-head", "true");
    return span;
  }

  eq(other: StreamingCursorWidget): boolean {
    return this.className === other.className;
  }
}

/**
 * Factory creating ViewPlugin that renders the animated typing cursor widget at stream head.
 */
export function createStreamingDecorationPlugin(shimmerClassName: string = "nexus-streaming-cursor"): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.state.field(streamingSessionField) !== update.startState.field(streamingSessionField)) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView): DecorationSet {
        const state = view.state.field(streamingSessionField);
        if (!state.active) {
          return Decoration.none;
        }

        const widget = Decoration.widget({
          widget: new StreamingCursorWidget(shimmerClassName),
          side: 1,
        });

        return Decoration.set([widget.range(state.currentPos)]);
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

export interface StreamingPluginOptions {
  shimmerClassName?: string;
  autoScroll?: boolean;
}

/**
 * Manager class for controlling active AI streaming operations.
 */
export class StreamingManager {
  private options: StreamingPluginOptions;

  constructor(options: StreamingPluginOptions = {}) {
    this.options = options;
  }

  /**
   * Starts a new token streaming session in the given CodeMirror view.
   */
  startStream(view: EditorView, sessionId: string, atPos?: number): void {
    const docLen = view.state.doc.length;
    const rawPos = atPos ?? view.state.selection.main.head;
    const pos = Math.max(0, Math.min(rawPos, docLen));
    view.dispatch({
      effects: [startStreamEffect.of({ sessionId, pos })],
    });
  }

  /**
   * Appends a chunk of text to an ongoing stream session.
   */
  appendChunk(view: EditorView, sessionId: string, chunk: string): void {
    const session = view.state.field(streamingSessionField);
    if (!session.active || session.sessionId !== sessionId) {
      return;
    }

    const insertPos = session.currentPos;
    view.dispatch({
      changes: { from: insertPos, insert: chunk },
      effects: [appendStreamEffect.of({ sessionId, chunk })],
      annotations: [Transaction.userEvent.of("ai-stream")],
    });

    if (this.options.autoScroll !== false) {
      const newPos = insertPos + chunk.length;
      view.dispatch({
        selection: { anchor: newPos },
        scrollIntoView: true,
      });
    }
  }

  /**
   * Completes the token stream session.
   */
  finishStream(view: EditorView, sessionId: string): StreamingSessionState {
    const session = view.state.field(streamingSessionField);
    const finalState = { ...session };
    if (session.active && session.sessionId === sessionId) {
      view.dispatch({
        effects: [finishStreamEffect.of({ sessionId })],
      });
    }
    return finalState;
  }

  /**
   * Returns current active stream session state from view.
   */
  getSessionState(view: EditorView): StreamingSessionState {
    return view.state.field(streamingSessionField);
  }
}

/**
 * Returns extension suite for token streaming.
 */
export function createStreamingExtension(options: StreamingPluginOptions = {}): Extension[] {
  const className = options.shimmerClassName ?? "nexus-streaming-cursor";
  return [
    streamingSessionField,
    createStreamingDecorationPlugin(className),
    EditorView.theme({
      [`.${className}`]: {
        display: "inline-block",
        width: "2px",
        height: "1.2em",
        backgroundColor: "var(--nexus-streaming-color, #3b82f6)",
        marginLeft: "1px",
        verticalAlign: "text-bottom",
        animation: "nexus-shimmer-pulse 1s infinite alternate",
      },
      "@keyframes nexus-shimmer-pulse": {
        "0%": { opacity: 0.2 },
        "100%": { opacity: 1.0 },
      },
    }),
  ];
}

/**
 * Nexus-Editor plugin wrapper for AI token streaming.
 */
export function createStreamingPlugin(options: StreamingPluginOptions = {}): NexusPlugin & { manager: StreamingManager } {
  const manager = new StreamingManager(options);

  return {
    name: "streaming",
    cmExtensions: createStreamingExtension(options),
    manager,
  };
}
