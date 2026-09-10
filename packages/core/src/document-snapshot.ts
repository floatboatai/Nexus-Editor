import type { EditorView } from "@codemirror/view";
import { isTableInputPending } from "./live-preview-table";

/** Wait for final input events, including the table's isolated contentEditable surface. */
export function waitForSnapshotInput(
  view: EditorView,
  isComposing: () => boolean,
  lifetime: AbortSignal,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      lifetime.removeEventListener("abort", abort);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Document snapshot cancelled", "AbortError"));
    };
    const check = () => {
      if (lifetime.aborted || signal?.aborted) return abort();
      if (isComposing() || isTableInputPending(view)) {
        timer = setTimeout(check, 32);
        return;
      }
      cleanup();
      resolve();
    };
    lifetime.addEventListener("abort", abort, { once: true });
    signal?.addEventListener("abort", abort, { once: true });
    if (lifetime.aborted || signal?.aborted) return abort();
    // compositionend can precede the final input event / table source microtask.
    timer = setTimeout(check, 0);
  });
}
