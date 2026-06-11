import { history, historyKeymap } from "@codemirror/commands";
import { keymap } from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

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
 * @example
 * ```ts
 * const plugin = createHistoryPlugin({
 *   newGroupDelay: 500,  // 停止输入 500ms 后新建分组
 *   minDepth: 1,         // 至少 1 个 change 即开始合并
 * });
 * ```
 */
export function createHistoryPlugin(options: HistoryPluginOptions = {}): NexusPlugin {
  return {
    name: "plugin-history",
    cmExtensions: [
      history({
        newGroupDelay: options.newGroupDelay ?? 500,
        minDepth: options.minDepth ?? 1,
      }),
      keymap.of(historyKeymap),
    ],
  };
}
