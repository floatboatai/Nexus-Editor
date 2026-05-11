/**
 * @file use-stats.ts
 * @description 文档统计数据管理 Hook
 * @author Nexus Editor Team
 * @date 2024
 * 
 * 业务背景：
 * 为文档编辑器提供增强的统计功能，包括：
 * 1. 实时统计数据获取（字数、字符数、行数、段落数等）
 * 2. 写作目标追踪（字数/字符数目标设置与进度展示）
 * 3. 数据导出（支持 CSV 和 JSON 格式）
 * 
 * 使用场景：
 * - 写作目标管理：帮助用户设定并追踪写作进度
 * - 数据报表导出：支持统计数据的外部分析和存档
 * - 实时统计展示：配合 StatsPanel 组件展示文档统计信息
 */

import { useState, useCallback, useEffect } from "react";
import type { EditorAPI, DocumentStats } from "@floatboat/nexus-core";

/**
 * 写作目标接口定义
 * 用于追踪用户设定的写作目标
 */
interface WritingGoal {
  /** 目标字数 */
  targetWords: number;
  /** 目标字符数 */
  targetChars: number;
}

/**
 * Hook 返回结果接口
 * 包含统计数据、目标设置和导出功能
 */
interface StatsResult {
  /** 当前文档统计数据 */
  stats: DocumentStats | null;
  /** 当前写作目标设置 */
  goal: WritingGoal;
  /** 当前进度百分比（0-100） */
  progress: {
    words: number;
    chars: number;
  };
  /** 设置写作目标 */
  setGoal: (goal: Partial<WritingGoal>) => void;
  /** 导出统计数据为 CSV 格式 */
  exportAsCSV: () => void;
  /** 导出统计数据为 JSON 格式 */
  exportAsJSON: () => void;
  /** 重置写作目标 */
  resetGoal: () => void;
}

/**
 * 文档统计管理 Hook
 * 
 * @param editor - 编辑器 API 实例（可为 null）
 * @returns 统计数据和操作函数
 * 
 * 核心功能：
 * 1. 监听编辑器变化，实时更新统计数据
 * 2. 管理写作目标状态
 * 3. 提供数据导出能力
 * 
 * 设计要点：
 * - 使用 useEffect 监听编辑器 change 事件，确保统计数据实时同步
 * - 使用 useCallback 优化导出函数性能
 * - 支持编辑器实例为 null 的边界情况
 */
export function useStats(editor: EditorAPI | null): StatsResult {
  /** 文档统计数据状态 */
  const [stats, setStats] = useState<DocumentStats | null>(null);
  
  /** 写作目标状态 */
  const [goal, setGoalState] = useState<WritingGoal>({
    targetWords: 0,
    targetChars: 0,
  });

  /**
   * 实时获取统计数据
   * 
   * 业务逻辑：
   * - 当编辑器实例变化时，重新建立事件监听
   * - 初始化时立即获取一次统计数据
   * - 监听编辑器 change 事件，实时更新统计
   * - 组件卸载时清理事件监听
   */
  useEffect(() => {
    if (!editor) {
      setStats(null);
      return;
    }

    /** 更新统计数据的内部函数 */
    const updateStats = () => {
      const documentStats = editor.getDocumentStats();
      setStats(documentStats);
    };

    // 初始化时立即获取统计
    updateStats();

    // 监听编辑器内容变化事件
    editor.on("change", updateStats);

    // 清理函数：组件卸载时移除事件监听
    return () => {
      editor.off("change", updateStats);
    };
  }, [editor]);

  /**
   * 计算写作进度
   * 
   * 业务规则：
   * - 进度 = 当前值 / 目标值 * 100
   * - 进度上限为 100%（即使超过目标也显示 100%）
   * - 未设置目标时进度为 0
   */
  const progress = {
    words: goal.targetWords > 0 && stats
      ? Math.min((stats.words / goal.targetWords) * 100, 100)
      : 0,
    chars: goal.targetChars > 0 && stats
      ? Math.min((stats.characters / goal.targetChars) * 100, 100)
      : 0,
  };

  /**
   * 设置写作目标
   * 
   * @param newGoal - 新的目标设置（支持部分更新）
   * 
   * 业务场景：用户在弹窗中设置或修改写作目标
   */
  const setGoal = useCallback((newGoal: Partial<WritingGoal>) => {
    setGoalState((prev) => ({
      ...prev,
      ...newGoal,
    }));
  }, []);

  /**
   * 重置写作目标
   * 
   * 业务场景：用户希望清除已设置的写作目标
   */
  const resetGoal = useCallback(() => {
    setGoalState({
      targetWords: 0,
      targetChars: 0,
    });
  }, []);

  /**
   * 导出统计数据为 CSV 格式
   * 
   * 业务场景：
   * - 用户需要将统计数据导入电子表格进行分析
   * - 数据存档和备份
   * - 生成报表
   * 
   * 导出内容：
   * - 基础指标：字数、字符数、行数、段落数
   * - 阅读时间预估
   * - 标题分布（H1-H6）
   * - 媒体内容统计（代码块、链接、图片）
   */
  const exportAsCSV = useCallback(() => {
    if (!stats) return;

    const headers = [
      "指标", "数值",
    ];
    const data = [
      ["字数", stats.words.toString()],
      ["字符数（含空格）", stats.characters.toString()],
      ["字符数（不含空格）", stats.charactersNoSpace.toString()],
      ["行数", stats.lines.toString()],
      ["段落数", stats.paragraphs.toString()],
      ["阅读时间（分钟）", stats.readTime.toString()],
      ["H1标题", stats.headings.h1.toString()],
      ["H2标题", stats.headings.h2.toString()],
      ["H3标题", stats.headings.h3.toString()],
      ["H4标题", stats.headings.h4.toString()],
      ["H5标题", stats.headings.h5.toString()],
      ["H6标题", stats.headings.h6.toString()],
      ["代码块", stats.codeBlocks.toString()],
      ["链接", stats.links.toString()],
      ["图片", stats.images.toString()],
    ];

    const csvContent = [headers.join(","), ...data.map((row) => row.join(","))].join("\n");
    downloadFile(csvContent, "document-stats.csv", "text/csv");
  }, [stats]);

  /**
   * 导出统计数据为 JSON 格式
   * 
   * 业务场景：
   * - 开发者需要通过 API 处理统计数据
   * - 与其他系统集成
   * - 结构化数据存储
   */
  const exportAsJSON = useCallback(() => {
    if (!stats) return;

    const jsonContent = JSON.stringify(stats, null, 2);
    downloadFile(jsonContent, "document-stats.json", "application/json");
  }, [stats]);

  return {
    stats,
    goal,
    progress,
    setGoal,
    exportAsCSV,
    exportAsJSON,
    resetGoal,
  };
}

/**
 * 文件下载辅助函数
 * 
 * @param content - 文件内容
 * @param filename - 文件名
 * @param mimeType - MIME 类型
 * 
 * 实现原理：
 * 1. 创建 Blob 对象存储文件内容
 * 2. 创建临时 URL 指向 Blob
 * 3. 创建隐藏的 <a> 标签触发下载
 * 4. 清理临时资源
 */
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}