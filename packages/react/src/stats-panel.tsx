/**
 * @file stats-panel.tsx
 * @description 文档统计面板组件
 * @author Nexus Editor Team
 * @date 2024
 * 
 * 业务背景：
 * 为 Nexus 文档编辑器提供增强的统计信息展示面板，帮助用户实时了解文档内容特征
 * 
 * 核心功能：
 * 1. 基础统计展示（字数、字符数、行数、段落数）
 * 2. 阅读时间预估
 * 3. 写作目标管理与进度追踪
 * 4. 标题层级分布统计
 * 5. 媒体内容统计（链接、图片、代码块）
 * 6. 文档复杂度自动评估
 * 7. 数据导出（CSV/JSON格式）
 * 
 * UI 设计特点：
 * - 卡片式布局，清晰分区展示各类统计信息
 * - 响应式设计，适配不同面板宽度
 * - 直观的进度条展示写作目标完成情况
 * - 颜色编码的复杂度评级（绿色/橙色/红色）
 */

import { useState } from "react";
import { useStats } from "./use-stats";
import type { EditorAPI } from "@floatboat/nexus-core";

/**
 * 统计面板组件属性接口
 */
interface StatsPanelProps {
  /** 编辑器 API 实例，用于获取文档统计数据 */
  editor: EditorAPI | null;
}

/**
 * 统计面板主组件
 * 
 * @param props - 组件属性
 * @returns 统计面板 React 元素
 */
export function StatsPanel(props: StatsPanelProps) {
  const { editor } = props;
  
  // 使用 useStats Hook 获取统计数据和操作函数
  const { stats, goal, progress, setGoal, exportAsCSV, exportAsJSON, resetGoal } = useStats(editor);
  
  // 弹窗状态管理
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [newGoal, setNewGoal] = useState({ words: "", chars: "" });

  /**
   * 计算文档复杂度等级
   * 
   * 业务规则（基于多维度评分）：
   * - 字数：>5000 +2分，>2000 +1分
   * - 代码块：>10 +2分，>3 +1分
   * - 链接数：>20 +1分
   * - 标题数：>10 +1分
   * 
   * 等级划分：
   * - 简单（绿色）：0-2分
   * - 中等（橙色）：3-4分
   * - 复杂（红色）：5分及以上
   * 
   * @returns 复杂度等级和对应的颜色标识
   */
  const getComplexityLevel = () => {
    if (!stats) return { level: "未知", color: "gray" };
    
    const { words, codeBlocks, links, headings } = stats;
    const headingCount = (Object.values(headings) as number[]).reduce((a: number, b: number) => a + b, 0);
    
    let score = 0;
    // 字数评分
    if (words > 5000) score += 2;
    else if (words > 2000) score += 1;
    
    // 代码块评分
    if (codeBlocks > 10) score += 2;
    else if (codeBlocks > 3) score += 1;
    
    // 链接数评分
    if (links > 20) score += 1;
    
    // 标题数量评分
    if (headingCount > 10) score += 1;
    
    // 根据总分确定复杂度等级
    if (score >= 5) return { level: "复杂", color: "red" };
    if (score >= 3) return { level: "中等", color: "orange" };
    return { level: "简单", color: "green" };
  };

  const complexity = getComplexityLevel();

  /**
   * 保存写作目标
   * 
   * 业务逻辑：
   * 1. 将用户输入的字符串转换为数字
   * 2. 通过 setGoal 更新全局目标状态
   * 3. 关闭弹窗并清空输入
   */
  const handleSaveGoal = () => {
    setGoal({
      targetWords: parseInt(newGoal.words) || 0,
      targetChars: parseInt(newGoal.chars) || 0,
    });
    setShowGoalModal(false);
    setNewGoal({ words: "", chars: "" });
  };

  /**
   * 空状态渲染
   * 
   * 当统计数据未加载时显示等待提示
   */
  if (!stats) {
    return (
      <div className="stats-panel">
        <div className="stats-panel-header">📊 Stats</div>
        <div className="stats-panel-content">
          <div className="stats-empty">等待文档加载...</div>
        </div>
      </div>
    );
  }

  /**
   * 主渲染逻辑
   * 
   * 面板结构：
   * 1. 头部区域：标题 + 操作按钮（目标设置、CSV导出、JSON导出）
   * 2. 内容区域：
   *    - 基础统计网格（4项）
   *    - 阅读时间
   *    - 写作目标进度（条件渲染）
   *    - 标题分布
   *    - 媒体内容统计
   *    - 文档复杂度评级
   * 3. 弹窗：写作目标设置
   */
  return (
    <div className="stats-panel">
      {/* 面板头部 */}
      <div className="stats-panel-header">
        <span>📊 Stats</span>
        <div className="stats-panel-actions">
          <button className="stats-btn" onClick={() => setShowGoalModal(true)} title="设置写作目标">
            🎯
          </button>
          <button className="stats-btn" onClick={exportAsCSV} title="导出CSV">
            📄
          </button>
          <button className="stats-btn" onClick={exportAsJSON} title="导出JSON">
            📋
          </button>
        </div>
      </div>

      {/* 面板内容区 */}
      <div className="stats-panel-content">
        {/* 基础统计 - 四宫格展示核心指标 */}
        <div className="stats-section">
          <div className="stats-grid">
            <div className="stat-item">
              <div className="stat-label">字数</div>
              <div className="stat-value">{stats.words.toLocaleString()}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">字符</div>
              <div className="stat-value">{stats.characters.toLocaleString()}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">行数</div>
              <div className="stat-value">{stats.lines.toLocaleString()}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">段落</div>
              <div className="stat-value">{stats.paragraphs.toLocaleString()}</div>
            </div>
          </div>
        </div>

        {/* 阅读时间预估 */}
        <div className="stats-section">
          <div className="stats-section-title">⏱️ 阅读时间</div>
          <div className="stat-badge">{stats.readTime} 分钟</div>
        </div>

        {/* 写作目标进度 - 仅在设置目标后显示 */}
        {(goal.targetWords > 0 || goal.targetChars > 0) && (
          <div className="stats-section">
            <div className="stats-section-title">
              🎯 写作目标
              <button className="stats-reset-btn" onClick={resetGoal}>✕</button>
            </div>
            {goal.targetWords > 0 && (
              <div className="progress-item">
                <span className="progress-label">字数目标</span>
                <span className="progress-text">{stats.words} / {goal.targetWords}</span>
                <div className="progress-bar">
                  <div 
                    className="progress-fill" 
                    style={{ width: `${progress.words}%` }}
                  />
                </div>
              </div>
            )}
            {goal.targetChars > 0 && (
              <div className="progress-item">
                <span className="progress-label">字符目标</span>
                <span className="progress-text">{stats.characters} / {goal.targetChars}</span>
                <div className="progress-bar">
                  <div 
                    className="progress-fill" 
                    style={{ width: `${progress.chars}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* 标题层级分布 */}
        <div className="stats-section">
          <div className="stats-section-title">📝 标题分布</div>
          <div className="heading-list">
            {(Object.entries(stats.headings) as [string, number][]).map(([level, count]) => (
              count > 0 && (
                <div key={level} className="heading-item">
                  <span className={`heading-level heading-${level}`}>H{level.slice(1)}</span>
                  <span className="heading-count">{count}</span>
                </div>
              )
            ))}
          </div>
        </div>

        {/* 媒体内容统计 */}
        <div className="stats-section">
          <div className="stats-section-title">📎 媒体内容</div>
          <div className="media-grid">
            <div className="media-item">
              <span className="media-icon">🔗</span>
              <span className="media-label">链接</span>
              <span className="media-count">{stats.links}</span>
            </div>
            <div className="media-item">
              <span className="media-icon">🖼️</span>
              <span className="media-label">图片</span>
              <span className="media-count">{stats.images}</span>
            </div>
            <div className="media-item">
              <span className="media-icon">💻</span>
              <span className="media-label">代码块</span>
              <span className="media-count">{stats.codeBlocks}</span>
            </div>
          </div>
        </div>

        {/* 文档复杂度评级 */}
        <div className="stats-section">
          <div className="stats-section-title">📊 文档复杂度</div>
          <div className={`complexity-badge complexity-${complexity.color}`}>
            {complexity.level}
          </div>
        </div>
      </div>

      {/* 写作目标设置弹窗 */}
      {showGoalModal && (
        <div className="stats-modal-overlay" onClick={() => setShowGoalModal(false)}>
          <div className="stats-modal" onClick={(e) => e.stopPropagation()}>
            <div className="stats-modal-header">
              <span>设置写作目标</span>
              <button className="modal-close" onClick={() => setShowGoalModal(false)}>✕</button>
            </div>
            <div className="stats-modal-body">
              <div className="modal-input-group">
                <label>目标字数</label>
                <input
                  type="number"
                  value={newGoal.words}
                  onChange={(e) => setNewGoal({ ...newGoal, words: e.target.value })}
                  placeholder="例如：1000"
                />
              </div>
              <div className="modal-input-group">
                <label>目标字符数</label>
                <input
                  type="number"
                  value={newGoal.chars}
                  onChange={(e) => setNewGoal({ ...newGoal, chars: e.target.value })}
                  placeholder="例如：5000"
                />
              </div>
            </div>
            <div className="stats-modal-footer">
              <button className="modal-btn modal-btn-cancel" onClick={() => setShowGoalModal(false)}>
                取消
              </button>
              <button className="modal-btn modal-btn-confirm" onClick={handleSaveGoal}>
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}