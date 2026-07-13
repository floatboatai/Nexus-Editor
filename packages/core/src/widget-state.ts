import { StateField, type EditorState, type Transaction, StateEffect } from "@codemirror/state";

/**
 * Global interaction state shared across all widgets in a single editor.
 * Replaces the bare module-level counter with an inspectable structure.
 */
export interface WidgetInteractionState {
  /** Number of widgets with active editing locks. */
  activeWidgetCount: number;
}

// ── Module-level editing counter ──
// Kept as a simple counter so widgets can increment/decrement without
// dispatching CM6 transactions (which would defeat the purpose — we're
// trying to PREVENT rebuilds during editing). The StateField below exists
// purely for devtools inspection and testing; the live-preview guard reads
// the module counter directly.

let widgetEditingCount = 0;

/**
 * Returns `true` when any widget currently holds an interactive editing
 * lock. The live-preview StateField calls this in its update function to
 * skip full decoration rebuilds, preserving widget DOM during multi-frame
 * interactions (drag, contentEditable focus, range selection, etc.).
 */
export function isWidgetEditing(): boolean {
  return widgetEditingCount > 0;
}

/**
 * Acquire a widget editing lock. Call this before starting any multi-frame
 * interaction (mousedown → drag, cell focus → edit, etc.). Each call MUST
 * be paired with a matching {@link releaseWidgetEditingLock} call.
 *
 * Returns a cleanup function for convenience; callers that prefer manual
 * management can ignore the return value and call `releaseWidgetEditingLock`
 * directly.
 */
export function acquireWidgetEditingLock(): () => void {
  widgetEditingCount++;
  return releaseWidgetEditingLock;
}

/**
 * Release a widget editing lock. MUST be paired with a prior
 * {@link acquireWidgetEditingLock} call. Count is clamped to 0 so
 * unbalanced releases are harmless.
 */
export function releaseWidgetEditingLock(): void {
  widgetEditingCount = Math.max(0, widgetEditingCount - 1);
}

/**
 * Internal StateEffect used by the inspection field to synchronise the
 * module counter into CM6 state. Widgets never need to dispatch this
 * directly — the counter is the source of truth.
 */
const syncWidgetCount = StateEffect.define<number>();

/**
 * Inspection-only StateField that mirrors {@link widgetEditingCount} into
 * CM6 state so it can be read in devtools, tested via
 * `view.state.field(widgetEditingState)`, and used by future tooling.
 *
 * This field does NOT gate the live-preview rebuild decision — use
 * {@link isWidgetEditing} for that.
 */
export const widgetEditingState = StateField.define<number>({
  create() {
    return 0;
  },
  update(value: number, tr: Transaction) {
    for (const effect of tr.effects) {
      if (effect.is(syncWidgetCount)) return effect.value;
    }
    return value;
  },
});

/**
 * Read the current widget editing count from CM6 state (for testing /
 * devtools inspection). Returns 0 if the StateField hasn't been loaded.
 */
export function getWidgetEditingCount(state: EditorState): number {
  const field = state.field(widgetEditingState, false);
  return field ?? 0;
}
