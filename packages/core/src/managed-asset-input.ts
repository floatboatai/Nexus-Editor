import { type ChangeDesc } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import type { AssetInputEvent, AssetUploadContext, EditorInputBookmark } from "./assets";
import type { EditorAPI, EditorConfig, EditorDomEventHookContext } from "./types";

interface TrackedRange { from: number; to: number; }
let assetOperationSequence = 0;
interface UploadTask {
  readonly id: string;
  readonly abort: AbortController;
  readonly target: EditorInputBookmark;
  readonly ranges?: TrackedRange[];
}

function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Asset input cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

function assetMarkdown(file: File, reference: string): string | null {
  const source = reference.trim();
  if (!source || /[\u0000-\u001f\u007f]/.test(source)) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(source)?.[1].toLowerCase();
  if (scheme && !["http", "https", "data", "blob", "nexus-asset", "nexus-vault"].includes(scheme)) return null;
  if (scheme === "data" && !/^data:image\/[a-z0-9.+-]+;base64,/i.test(source)) return null;
  const label = (file.name || "image").replace(/[\\[\]`*_!]/g, "\\$&").replace(/[\r\n]/g, " ");
  const url = source.replace(/[\s()<>\\|]/g, (character) =>
    character === "(" ? "%28" : character === ")" ? "%29" : encodeURIComponent(character));
  const image = file.type.startsWith("image/") || /\.(?:png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name);
  return `${image ? "!" : ""}[${label}](${url})`;
}

/** Owns asynchronous insertions; file storage and orphan cleanup remain with the uploader. */
export class ManagedAssetInput {
  private readonly tasks = new Set<UploadTask>();

  constructor(
    private readonly view: EditorView,
    private readonly editor: EditorAPI,
    private readonly config: EditorConfig,
  ) {}

  handle(
    files: readonly File[],
    operation: "paste" | "drop",
    context: EditorDomEventHookContext,
    point?: { x: number; y: number },
  ): boolean {
    if (!files.length || !this.config.onAssetUpload) return false;
    const id = `asset-input:${++assetOperationSequence}`;
    if (this.view.state.readOnly) {
      this.emit({ operationId: id, status: "failed", code: "read-only", completed: 0, total: files.length });
      return true;
    }
    let ranges: TrackedRange[] | undefined;
    let target: EditorInputBookmark | null = null;
    if (context.surface === "document") {
      const position = point ? this.view.posAtCoords(point) : null;
      if (point && position === null) {
        this.emit({ operationId: id, status: "failed", code: "unsupported-target", completed: 0, total: files.length });
        return true;
      }
      ranges = position === null
        ? this.view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to }))
        : [{ from: position, to: position }];
      const tracked = ranges;
      let valid = true;
      target = {
        isValid: () => valid && !this.view.state.readOnly,
        replaceSelection: (text) => {
          if (!valid || this.view.state.readOnly) return false;
          const before = this.view.state.doc;
          this.view.dispatch({
            changes: tracked.map((range) => ({ ...range, insert: text })),
            userEvent: "input.paste",
            annotations: isolateHistory.of("full"),
          });
          return this.view.state.doc !== before;
        },
        dispose: () => { valid = false; },
      };
    } else {
      try { target = context.inputTarget?.captureSelection?.(point) ?? null; }
      catch { target = null; }
    }
    if (!target) {
      this.emit({ operationId: id, status: "failed", code: "unsupported-target", completed: 0, total: files.length });
      return true;
    }
    const task: UploadTask = { id, abort: new AbortController(), target, ranges };
    this.tasks.add(task);
    void this.upload(task, files, operation).catch(() => {
      console.error("Nexus asset input cleanup failed");
    });
    return true;
  }

  mapChanges(changes: ChangeDesc): void {
    for (const task of this.tasks) {
      let conflict = false;
      for (const range of task.ranges ?? []) {
        changes.iterChangedRanges((from, to) => {
          if (from < to && from <= range.to && to >= range.from ||
            from === to && from > range.from && from < range.to) conflict = true;
        });
      }
      if (conflict) {
        task.abort.abort();
        continue;
      }
      for (const range of task.ranges ?? []) {
        const collapsed = range.from === range.to;
        range.from = changes.mapPos(range.from, 1);
        range.to = collapsed ? range.from : changes.mapPos(range.to, -1);
      }
    }
    this.validateTargets();
  }

  validateTargets(): void {
    for (const task of this.tasks) {
      try {
        if (!task.target.isValid()) task.abort.abort();
      } catch {
        // A broken third-party bookmark cannot retain authority to insert.
        task.abort.abort();
      }
    }
  }

  cancel(operationId?: string): void {
    for (const task of this.tasks) if (!operationId || task.id === operationId) task.abort.abort();
  }

  private emit(event: AssetInputEvent): void {
    try { this.config.assetInput?.onEvent?.(Object.freeze(event)); }
    catch { console.error("Nexus asset input observer failed"); }
  }

  private async upload(task: UploadTask, files: readonly File[], operation: "paste" | "drop"): Promise<void> {
    const upload = this.config.onAssetUpload;
    if (!upload) {
      this.tasks.delete(task);
      task.target.dispose();
      return;
    }
    let completed = 0;
    const fragments: string[] = [];
    const signal = task.abort.signal;
    const invalidate = () => task.abort.abort();
    task.target.signal?.addEventListener("abort", invalidate, { once: true });
    if (task.target.signal?.aborted) invalidate();
    const context: AssetUploadContext = { signal, operation, operationId: task.id };
    const event = (status: AssetInputEvent["status"], code?: AssetInputEvent["code"]) =>
      this.emit({ operationId: task.id, status, code, completed, total: files.length });
    event("uploading");
    try {
      for (const file of files) {
        if (signal.aborted) throw new DOMException("Asset input cancelled", "AbortError");
        try {
          const reference = await abortable(Promise.resolve(upload(file, context)), signal);
          const markdown = reference ? assetMarkdown(file, reference) : null;
          if (markdown) fragments.push(markdown);
          else event("failed", "invalid-reference");
        } catch (error) {
          if (signal.aborted) throw error;
          event("failed", "upload-failed");
        }
        completed += 1;
        event("uploading");
      }
      if (signal.aborted || !task.target.isValid()) {
        event("cancelled", "target-changed");
        return;
      }
      if (!fragments.length) {
        event("failed", "upload-failed");
        return;
      }
      // Do not map this task's own insertion as a conflicting external edit.
      this.tasks.delete(task);
      if (task.target.replaceSelection(fragments.join("\n"))) event("inserted");
      else event("failed", this.editor.isReadOnly?.() ? "read-only" : "target-changed");
    } catch {
      event("cancelled", "target-changed");
    } finally {
      this.tasks.delete(task);
      task.target.signal?.removeEventListener("abort", invalidate);
      task.target.dispose();
    }
  }
}
