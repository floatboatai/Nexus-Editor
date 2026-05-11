# 文档统计面板需求设计

## 1. 需求概述

为Nexus Editor设计并实现一个**文档统计面板**，在侧边栏展示当前文档的实时统计信息，包括字数统计、阅读时间、段落分析等实用指标。

## 2. 需求背景

当前编辑器缺乏文档统计功能，用户无法快速了解文档的基本信息。一个轻量级的统计面板可以帮助用户：
- 了解文档长度和复杂度
- 估算阅读时间
- 快速定位文档结构

## 3. 功能需求

### 3.1 核心统计指标

| 需求编号 | 功能描述 | 优先级 |
| :--- | :--- | :--- |
| STATS-001 | 显示字数（不含空格） | 高 |
| STATS-002 | 显示字符数（含空格） | 高 |
| STATS-003 | 显示行数 | 高 |
| STATS-004 | 显示段落数 | 中 |
| STATS-005 | 估算阅读时间（中文300字/分钟） | 高 |
| STATS-006 | 显示标题层级分布（H1-H6数量） | 中 |

### 3.2 扩展统计指标

| 需求编号 | 功能描述 | 优先级 |
| :--- | :--- | :--- |
| STATS-007 | 显示代码块数量 | 低 |
| STATS-008 | 显示链接数量 | 低 |
| STATS-009 | 显示图片数量 | 低 |
| STATS-010 | 显示标签数量（如果使用#标签语法） | 低 |

### 3.3 UI与交互

| 需求编号 | 功能描述 | 优先级 |
| :--- | :--- | :--- |
| STATS-011 | 在侧边栏添加"Stats"面板标签 | 高 |
| STATS-012 | 实时更新统计数据（随编辑变化） | 高 |
| STATS-013 | 点击标题统计可跳转到对应标题位置 | 中 |
| STATS-014 | 响应式布局，适配不同窗口尺寸 | 中 |

### 3.4 增强功能（React扩展）

| 需求编号 | 功能描述 | 优先级 |
| :--- | :--- | :--- |
| STATS-015 | 写作目标设定与进度追踪 | 中 |
| STATS-016 | 统计数据导出为CSV格式 | 低 |
| STATS-017 | 统计数据导出为JSON格式 | 低 |
| STATS-018 | 文档复杂度分析与评级 | 中 |

## 4. 技术设计

### 4.1 数据结构

```typescript
interface DocumentStats {
  /** 字数（不含空格） */
  words: number;
  /** 字符数（含空格） */
  characters: number;
  /** 字符数（不含空格） */
  charactersNoSpace: number;
  /** 行数 */
  lines: number;
  /** 段落数 */
  paragraphs: number;
  /** 估算阅读时间（分钟） */
  readTime: number;
  /** 标题层级分布 */
  headings: {
    h1: number;
    h2: number;
    h3: number;
    h4: number;
    h5: number;
    h6: number;
  };
  /** 代码块数量 */
  codeBlocks: number;
  /** 链接数量 */
  links: number;
  /** 图片数量 */
  images: number;
}
```

### 4.3 React扩展数据结构

```typescript
interface WritingGoal {
  /** 目标字数 */
  targetWords: number;
  /** 目标字符数 */
  targetChars: number;
}

interface StatsProgress {
  /** 字数进度百分比 */
  words: number;
  /** 字符进度百分比 */
  chars: number;
}
```

### 4.4 核心组件

#### 4.4.1 StatsService（统计服务）

**职责**：从EditorState计算统计数据

**接口设计**：
```typescript
interface StatsService {
  /** 从编辑器状态计算统计 */
  compute(state: EditorState): DocumentStats;
  /** 从AST提取统计（更精确） */
  computeFromAst(ast: Root): Partial<DocumentStats>;
}
```

#### 4.4.2 StatsPanel（统计面板组件）

**职责**：展示统计数据

**Props设计**：
```typescript
interface StatsPanelProps {
  stats: DocumentStats;
  onHeadingClick?: (level: number, index: number) => void;
}
```

## 5. 实现计划（1天）

### 5.1 阶段一：核心统计逻辑（2小时）

| 任务 | 描述 |
| :--- | :--- |
| T1 | 在core包中实现StatsService |
| T2 | 实现基础统计计算（字数、字符数、行数） |
| T3 | 实现从AST提取标题、代码块、链接等统计 |

### 5.2 阶段二：UI组件开发（2小时）

| 任务 | 描述 |
| :--- | :--- |
| T4 | 在electron-demo中创建StatsPanel组件 |
| T5 | 设计简洁的卡片式UI展示 |
| T6 | 添加标题点击跳转功能 |

### 5.3 阶段三：集成与测试（2小时）

| 任务 | 描述 |
| :--- | :--- |
| T7 | 集成到EditorShell侧边栏 |
| T8 | 实现实时更新（监听EditorState变化） |
| T9 | 单元测试与边界情况处理 |

## 6. 边界条件与异常处理

| 场景 | 处理策略 |
| :--- | :--- |
| 空文档 | 显示0值，友好提示 |
| 大文档（>10000字） | 异步计算，避免阻塞UI |
| 纯代码文档 | 合理统计代码行数 |

## 7. UI设计参考

```
┌─────────────────────────────┐
│         📊 Stats            │
├─────────────────────────────┤
│  Words:         1,234       │
│  Characters:    6,789       │
│  Lines:           45        │
│  Paragraphs:      8        │
│  Read Time:     4 min       │
├─────────────────────────────┤
│  📝 Headings                │
│  ├─ H1: 1                  │
│  ├─ H2: 3                  │
│  ├─ H3: 5                  │
│  └─ H4: 2                  │
├─────────────────────────────┤
│  📎 Media                   │
│  ├─ Links: 12              │
│  ├─ Images: 3              │
│  └─ Code Blocks: 4         │
└─────────────────────────────┘

## 8. 已实现扩展功能

### 8.1 写作目标追踪
- 支持设置目标字数和目标字符数
- 实时显示进度百分比
- 进度条可视化展示
- 支持重置目标

### 8.2 数据导出
- **CSV导出**：将统计数据导出为逗号分隔值文件
- **JSON导出**：将统计数据导出为JSON格式文件
- 一键下载功能

### 8.3 文档复杂度分析
基于以下指标自动评估文档复杂度：
- 文档字数（>5000字为复杂）
- 代码块数量（>10个为复杂）
- 链接数量（>20个增加复杂度）
- 标题数量（>10个增加复杂度）

复杂度等级：
- 🟢 简单（评分0-2）
- 🟠 中等（评分3-4）
- 🔴 复杂（评分≥5）

## 9. 未来扩展规划

- [ ] 写作进度历史记录
- [ ] 字数目标提醒（达到目标时通知）
- [ ] 多文档统计对比
- [ ] 统计数据可视化图表