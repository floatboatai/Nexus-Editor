import type { EditorView } from "@codemirror/view";

/**
 * Simplified measure request matching CM6's {@link EditorView.requestMeasure}
 * contract. The `read` callback runs during the measure phase; the optional
 * `write` callback runs during the write phase with the value returned by
 * `read`.
 */
export interface WidgetMeasureRequest<T = unknown> {
  read(view: EditorView): T;
  write?(value: T, view: EditorView): void;
}

/**
 * Context object provided to every {@link EditorWidget} instance during its
 * lifecycle. Gives widgets controlled access to the CM6 view without exposing
 * internals directly.
 */
export interface WidgetContext {
  /** The CM6 EditorView this widget lives in. Read-only from the widget's perspective. */
  readonly view: EditorView;

  /** Absolute document offset where this widget's source range starts. */
  readonly from: number;

  /** Absolute document offset where this widget's source range ends (exclusive). */
  readonly to: number;

  /**
   * Dispatch a CM6 transaction from within the widget. Prefer this over
   * calling `view.dispatch()` directly.
   */
  dispatch(changes: { from: number; to: number; insert: string }): void;

  /**
   * Returns `true` when the current CM6 selection intersects this widget's
   * document range `[from, to]`.
   */
  isCursorInside(): boolean;

  /**
   * Delegate to CM6's `requestMeasure`. Use this when you need to read
   * layout-dependent values (e.g. `getBoundingClientRect`) after a DOM
   * mutation that hasn't been painted yet.
   */
  requestMeasure<T>(request: WidgetMeasureRequest<T>): void;
}
