import { Compartment } from "@codemirror/state";
import { history, historyKeymap } from "@codemirror/commands";
import { EditorView, ViewPlugin, keymap } from "@codemirror/view";

import type { NexusPlugin, EditorAPI } from "@floatboat/nexus-core";

export interface HistoryPluginOptions {
  /**
   * 用户停止输入后多久（ms）才开始新的撤销分组。
   * 连续输入在此时间内的修改会被合并为一个撤销单元。
   * 默认 500ms，与 CodeMirror 6 内置值一致。
   */
  newGroupDelay?: number;

  /**
   * 合并到同一撤销单元的最小 change 数量。
   * 默认 1（即连续输入合并为一步，直到超时或用户执行非输入操作）。
   */
  minDepth?: number;
}

/**
 * 创建历史记录（undo/redo）插件。
 *
 * 支持配置撤销分组行为——连续快速输入（如逐字打字）会自动合并为一个撤销步骤，
 * 用户只需一次 Ctrl+Z 即可回退整段输入，而非逐字符撤销。
 *
 * 同时注册 `history.clear` 命令用于清空撤销/重做栈。
 * 清除后 canUndo() / canRedo() 均返回 false，并触发 historyChange 事件。
 *
 * @example
 * ```ts
 * const plugin = createHistoryPlugin({
 *   newGroupDelay: 500,  // 停止输入 500ms 后新建分组
 *   minDepth: 1,         // 至少 1 个 change 即开始合并
 * });
 *
 * // 清空历史栈
 * editor.runCommand("history.clear");
 * ```
 */
export function createHistoryPlugin(options: HistoryPluginOptions = {}): NexusPlugin {
  const config = {
    newGroupDelay: options.newGroupDelay ?? 500,
    minDepth: options.minDepth ?? 1,
  };

  // 将 history 扩展放在 Compartment 中，以便通过 reconfigure
  // 动态替换——替换后的新 StateField 以 HistoryState.empty 起始，
  // 从而清空所有已记录的撤销/重做步骤。
  const historyCompartment = new Compartment();

  // 通过 ViewPlugin 捕获 EditorView 引用，供 clearHistory 使用。
  // ViewPlugin 是 CodeMirror 6 的"视图层插件"——它在 EditorView 生命周期
  // 中挂载/卸载，通过 constructor 获取 view 引用。
  let viewRef: EditorView | null = null;
  const viewTracker = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        viewRef = view;
      }
      destroy() {
        viewRef = null;
      }
    },
  );

  return {
    name: "plugin-history",
    cmExtensions: [
      viewTracker,
      historyCompartment.of(
        history({
          newGroupDelay: config.newGroupDelay,
          minDepth: config.minDepth,
        }),
      ),
      keymap.of(historyKeymap),
    ],
    commands: [
      {
        id: "history.clear",
        label: "Clear history",
        run: (editor: EditorAPI) => {
          if (!viewRef || editor.isComposing()) return false;

          // 双阶段 Compartment 重配置清空历史栈：
          //
          // Step 1: reconfigure 到空数组 —— 移除 history StateField，
          //         连带删除所有已记录的 done/undone 条目。
          // Step 2: reconfigure 回 history(config) —— 重新创建
          //         history StateField，以 HistoryState.empty 起始。
          //
          // 单次 reconfigure(history(config)) 不够，因为 historyField_
          // 是模块级单例，id 不变，CM6 会映射旧状态而非重建。
          viewRef.dispatch({
            effects: historyCompartment.reconfigure([]),
          });
          viewRef.dispatch({
            effects: historyCompartment.reconfigure(
              history({
                newGroupDelay: config.newGroupDelay,
                minDepth: config.minDepth,
              }),
            ),
          });

          return true;
        },
      },
    ],
  };
}
