import { history, historyField, historyKeymap, undo } from "@codemirror/commands";
import { Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, ViewUpdate } from "@codemirror/view";

import { isTableEditing, type NexusPlugin } from "@floatboat/nexus-core";

// ============================================================
// 撤销分组：将表编辑等连续操作合并为单个撤销步骤
//
// 策略：不修改 CodeMirror 内部机制，而是在分组结束时计算
// 区间内新增的历史条目数，通过自定义 Ctrl+Z 绑定，一次性
// 撤销多条，实现"一次撤销回退整个分组"的效果。
// ============================================================

// -- 标记：下次 Ctrl+Z 应批量撤销的条目数 --
const setBatchUndoCount = StateEffect.define<number>();

// -- StateField：挂起的批量撤销计数，文档变更后自动清零 --
const batchUndoCountField = StateField.define<number>({
  create: () => 0,
  update: (value, tr) => {
    for (const e of tr.effects) {
      if (e.is(setBatchUndoCount)) return e.value;
    }
    if (tr.docChanged) return 0;
    return value;
  }
});

// -- 高优先级 Ctrl+Z：优先检测是否有批量撤销 --
const batchUndoKeymap = Prec.highest(keymap.of([
  {
    key: "Mod-z",
    run: (view) => {
      const count = view.state.field(batchUndoCountField, false);
      if (count && count > 1) {
        for (let i = 0; i < count; i++) {
          undo(view);
        }
        view.dispatch({ effects: setBatchUndoCount.of(0) });
        return true;
      }
      return false; // 交给默认 historyKeymap
    }
  }
]));

// -- ViewPlugin：监听表编辑，自动管理分组 --
const tableGroupTracker = ViewPlugin.fromClass(class {
  private view: EditorView;
  private wasInTable = false;
  private groupStartDone = 0;

  constructor(view: EditorView) {
    this.view = view;
  }

  update(_update: ViewUpdate) {
    const inTable = isTableEditing(this.view);

    if (inTable && !this.wasInTable) {
      // 表编辑开始 → 记录当前 history.done 长度
      const hist = this.view.state.field(historyField, false);
      this.groupStartDone = hist ? hist.done.length : 0;
    }

    if (!inTable && this.wasInTable) {
      this._closeGroup();
    }

    this.wasInTable = inTable;
  }

  destroy() {
    if (this.wasInTable) this._closeGroup();
  }

  _closeGroup() {
    const hist = this.view.state.field(historyField, false);
    if (!hist) return;

    const newItems = hist.done.length - this.groupStartDone;
    if (newItems > 1) {
      this.view.dispatch({ effects: setBatchUndoCount.of(newItems) });
    }
  }
});

// -- 公开 API：程序中手动管理分组 --
export function beginUndoGroup(view: EditorView): void {
  const hist = view.state.field(historyField, false);
  if (!hist) return;
  // 将起始位置存入一个临时属性（简单方案：用 WeakMap）
  undoGroupStartMap.set(view, hist.done.length);
}

const undoGroupStartMap = new WeakMap<EditorView, number>();

export function endUndoGroup(view: EditorView): void {
  const startLen = undoGroupStartMap.get(view);
  if (startLen === undefined) return;
  undoGroupStartMap.delete(view);

  const hist = view.state.field(historyField, false);
  if (!hist) return;

  const newItems = hist.done.length - startLen;
  if (newItems > 1) {
    view.dispatch({ effects: setBatchUndoCount.of(newItems) });
  }
}

// -- 插件入口 --
export function createHistoryPlugin(): NexusPlugin {
  return {
    name: "plugin-history",
    cmExtensions: [
      history(),
      keymap.of(historyKeymap),
      batchUndoKeymap,
      batchUndoCountField,
      tableGroupTracker
    ]
  };
}
