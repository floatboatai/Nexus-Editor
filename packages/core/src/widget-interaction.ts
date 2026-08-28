import { StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

const widgetInteractionCounts = new WeakMap<EditorView, number>();

/** Dispatched when the last interaction lock on a view is released so decorations can rebuild. */
export const widgetInteractionRefreshEffect = StateEffect.define<null>();

export function isWidgetInteracting(view: EditorView | null | undefined): boolean {
  return !!view && (widgetInteractionCounts.get(view) ?? 0) > 0;
}

/**
 * Identity helper for CM6 `WidgetType.eq()`. While a lock is held the DOM
 * must be reused even if the content fingerprint changed; the refresh
 * effect rebuilds after the last `endWidgetInteraction`.
 */
export function shouldReuseWidgetDom(
  view: EditorView | null | undefined,
  identityEqual: boolean,
): boolean {
  if (isWidgetInteracting(view)) return true;
  return identityEqual;
}

export function beginWidgetInteraction(view: EditorView): void {
  widgetInteractionCounts.set(view, (widgetInteractionCounts.get(view) ?? 0) + 1);
}

export function endWidgetInteraction(
  view: EditorView,
  options?: { refresh?: boolean },
): void {
  const next = Math.max(0, (widgetInteractionCounts.get(view) ?? 0) - 1);
  if (next === 0) widgetInteractionCounts.delete(view);
  else widgetInteractionCounts.set(view, next);

  if (next > 0 || options?.refresh === false) return;

  const ownerWindow = view.dom.ownerDocument.defaultView;
  const enqueue = ownerWindow?.queueMicrotask?.bind(ownerWindow) ?? queueMicrotask;
  enqueue(() => {
    if (isWidgetInteracting(view)) return;
    try {
      view.dispatch({ effects: widgetInteractionRefreshEffect.of(null) });
    } catch {
      // View may have been destroyed before the deferred refresh.
    }
  });
}

export function clearWidgetInteraction(view: EditorView): void {
  widgetInteractionCounts.delete(view);
}
