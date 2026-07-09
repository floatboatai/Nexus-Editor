import { history, historyKeymap, isolateHistory } from "@codemirror/commands";
import { keymap } from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

/**
 * 历史记录插件的配置项。
 * 对齐 CodeMirror 6 的 HistoryConfig，提供撤销/重做分组控制。
 */
export interface HistoryPluginConfig {
  /**
   * 两次相邻编辑的最大时间间隔（毫秒），在此时间窗口内的连续编辑
   * 会被合并为一个撤销步骤。
   *
   * 默认 500ms —— 用户连续输入时，一次 Ctrl+Z 可撤销整段输入。
   * 设置为更大的值（如 2000）可以让更长的连续输入合并为一步撤销；
   * 设置为 0 则每次按键都独立为一个撤销步骤。
   */
  newGroupDelay?: number;

  /**
   * 最少保留的历史事件数。超过此数量后，最早的事件会被丢弃。
   * 默认 100。
   */
  minDepth?: number;
}

/**
 * 重新导出 isolateHistory annotation，供其他插件（如表格编辑）
 * 在需要手动标记撤销组边界时使用。
 *
 * 使用方式：
 * - isolateHistory.of("before") — 阻止与前一个事务合并
 * - isolateHistory.of("after")  — 阻止与后一个事务合并
 * - isolateHistory.of("full")   — 完全隔离（前后都不合并）
 */
export { isolateHistory };

/**
 * 创建历史记录插件，提供撤销/重做功能。
 *
 * 默认行为：500ms 内的连续编辑操作自动合并为一个撤销步骤，
 * 用户一次 Ctrl+Z 即可撤销整段连续输入。
 *
 * @param config - 可选配置，控制撤销分组行为
 * @returns NexusPlugin 插件对象
 *
 * @example
 * // 默认配置：500ms 内连续输入合并为一步撤销
 * createHistoryPlugin()
 *
 * @example
 * // 自定义：2 秒内连续输入合并为一步撤销
 * createHistoryPlugin({ newGroupDelay: 2000 })
 *
 * @example
 * // 禁用自动分组：每次按键独立为一个撤销步骤
 * createHistoryPlugin({ newGroupDelay: 0 })
 */
export function createHistoryPlugin(config: HistoryPluginConfig = {}): NexusPlugin {
  return {
    name: "plugin-history",
    cmExtensions: [
      history({
        newGroupDelay: config.newGroupDelay,
        minDepth: config.minDepth,
      }),
      keymap.of(historyKeymap)
    ]
  };
}
