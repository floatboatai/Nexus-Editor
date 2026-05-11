/**
 * @file react-stats-panel.tsx
 * @description React 统计面板工厂函数
 * @author Nexus Editor Team
 * @date 2024
 * 
 * 业务背景：
 * 将 React 版本的 StatsPanel 组件集成到 Electron 原生应用中
 * 提供与原有核心版统计面板一致的接口，实现无缝替换
 * 
 * 核心作用：
 * 1. 创建容器元素用于挂载 React 组件
 * 2. 使用 React 18 的 createRoot API 创建根节点
 * 3. 渲染 StatsPanel 组件并传入编辑器实例
 * 4. 提供 dispose 方法用于组件卸载时的资源清理
 * 
 * 设计目的：
 * - 保持与 @floatboat/nexus-core 中 createStatsPanel 相同的接口签名
 * - 实现从核心版到 React 版的平滑迁移
 * - 统一面板创建和销毁的生命周期管理
 */

import { createRoot, Root } from "react-dom/client";
import { StatsPanel } from "@floatboat/nexus-react";
import type { EditorAPI } from "@floatboat/nexus-core";

/**
 * React 统计面板接口定义
 * 
 * 与 @floatboat/nexus-core 中的 StatsPanel 接口保持一致
 */
export interface ReactStatsPanel {
  /** 面板的 DOM 元素，用于挂载到编辑器界面 */
  element: HTMLElement;
  /** 清理函数，用于卸载 React 组件并释放资源 */
  dispose: () => void;
}

/**
 * 创建 React 版本的统计面板
 * 
 * @param editor - 编辑器 API 实例
 * @returns ReactStatsPanel 对象，包含 DOM 元素和清理方法
 * 
 * 使用方式：
 * ```typescript
 * const statsPanel = createReactStatsPanel(editor);
 * container.appendChild(statsPanel.element);
 * // 卸载时调用
 * statsPanel.dispose();
 * ```
 */
export function createReactStatsPanel(editor: EditorAPI): ReactStatsPanel {
  // 创建容器元素
  const container = document.createElement("div");
  container.className = "stats-panel";

  // 使用 React 18 createRoot API 创建根节点
  const root: Root = createRoot(container);
  root.render(<StatsPanel editor={editor} />);

  // 返回接口对象
  return {
    element: container,
    dispose: () => root.unmount(),
  };
}