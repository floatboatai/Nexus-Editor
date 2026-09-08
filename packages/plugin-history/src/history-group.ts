import { isolateHistory } from "@codemirror/commands";
import type { Annotation, TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export type IsolateHistoryMode = "before" | "after" | "full";

function asAnnotationList(
  existing: TransactionSpec["annotations"]
): Annotation<unknown>[] {
  if (!existing) return [];
  return (Array.isArray(existing) ? existing : [existing]) as Annotation<unknown>[];
}

export function withIsolatedHistory(
  spec: TransactionSpec,
  mode: IsolateHistoryMode = "full"
): TransactionSpec {
  const annotation = isolateHistory.of(mode);
  return {
    ...spec,
    annotations: [...asAnnotationList(spec.annotations), annotation]
  };
}

/**
 * Run `fn` so its dispatches are isolated from history events before/after
 * the group. Edits inside the group still follow CM6 join rules relative
 * to each other.
 */
export function runInHistoryGroup(
  view: EditorView,
  fn: (view: EditorView) => void
): void {
  view.dispatch({ annotations: isolateHistory.of("before") });
  try {
    fn(view);
  } finally {
    view.dispatch({ annotations: isolateHistory.of("after") });
  }
}
