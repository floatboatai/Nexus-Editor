import type { EditorAPI, NexusPlugin } from "@floatboat/nexus-core";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { Text } from "@codemirror/state";

export interface AutosaveOptions {
  /** 保存回调。宿主在此执行异步 IO。 */
  onSave(document: string): Promise<void>;
  /** 去抖延迟（毫秒），默认 1000。设为 0 时无去抖立即触发。 */
  debounceMs?: number;
}

// ── 状态存储：WeakMap<view, 运行时状态> ────────────────────────────────────

interface AutosaveState {
  lastSavedDoc: Text;
  timer: ReturnType<typeof setTimeout> | null;
  onSave: (doc: string) => Promise<void>;
}

const states = new WeakMap<EditorView, AutosaveState>();

// ── 配置（无状态） ──────────────────────────────────────────────────────

export function createAutosavePlugin(options: AutosaveOptions): NexusPlugin {
  const debounceMs = options.debounceMs ?? 1000;

  const viewPlugin = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        states.set(view, {
          lastSavedDoc: view.state.doc,
          timer: null,
          onSave: options.onSave,
        });
      }

      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        const state = states.get(this.view);
        if (!state) return;
        if (state.timer) clearTimeout(state.timer);
        state.timer = setTimeout(async () => {
          const snapshot = this.view.state.doc;
          try {
            await state.onSave(snapshot.toString());
            state.lastSavedDoc = snapshot;
          } catch {
            // 保存失败 → 不更新 lastSavedDoc，isDirty 保持 true
          }
        }, debounceMs);
      }

      destroy() {
        const state = states.get(this.view);
        if (state?.timer) clearTimeout(state.timer);
        states.delete(this.view);
      }
    },
  );

  return {
    name: "plugin-autosave",
    cmExtensions: [viewPlugin],
  };
}

// ── 查询（纯函数，传入 editor 句柄） ────────────────────────────────────

function getState(editor: EditorAPI): AutosaveState | null {
  const view = editor._nexusView;
  if (!view) return null;
  return states.get(view) ?? null;
}

/** 是否有未保存的更改。若未注册 autosave 插件则始终返回 false。 */
export function isDirty(editor: EditorAPI): boolean {
  const state = getState(editor);
  if (!state) return false;
  return !editor._nexusView.state.doc.eq(state.lastSavedDoc);
}

/**
 * 立即触发保存（跳过 debounce）。
 * SPA 路由卸载前调用：清除待处理 timer，立即向宿主发起保存。
 * 若未注册 autosave 插件则无操作。
 */
export function forceSave(editor: EditorAPI): void {
  const state = getState(editor);
  if (!state) return;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  const snapshot = editor._nexusView.state.doc;
  // 不等待 Promise — SPA 路由卸载时等不起异步 IO
  state.onSave(snapshot.toString()).then(() => {
    state.lastSavedDoc = snapshot;
  }).catch(() => {});
}
