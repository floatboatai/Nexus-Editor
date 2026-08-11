# prd — 功能点清单

> 输入源: prd.md（产品需求文档 v1.0）
> 生成时间: 2026-08-10
> 执行模式: 仅功能点提取（模式3）

## 功能点表格

| 编号 | 一级功能点 | 二级功能点 | 类型标签 | 需求源索引 |
|------|-----------|-----------|---------|----------|
| FP-01-01 | EditorConfig 配置对象 | container 必填挂载节点 | [API契约] | prd.md §3.1 |
| FP-01-02 | EditorConfig 配置对象 | initialValue 初始 Markdown | [API契约] | prd.md §3.1 |
| FP-01-03 | EditorConfig 配置对象 | plugins 插件系统入口 | [API契约][插件能力] | prd.md §3.1 |
| FP-01-04 | EditorConfig 配置对象 | themePrefix 主题变量前缀（默认 'nx-'） | [API契约] | prd.md §3.1 |
| FP-01-05 | EditorConfig 配置对象 | onChange 内容变更回调 | [API契约] | prd.md §3.1 |
| FP-01-06 | EditorConfig 配置对象 | onFocus/onBlur 焦点回调 | [API契约] | prd.md §3.1 |
| FP-01-07 | EditorConfig 配置对象 | onAssetUpload 文件拖拽上传钩子 | [API契约][数据IO] | prd.md §3.1 |
| FP-02-01 | NexusPlugin 插件接口 | name 插件唯一标识 | [API契约][插件能力] | prd.md §3.2 |
| FP-02-02 | NexusPlugin 插件接口 | Tier1 shortcuts 快捷键 | [插件能力][编辑交互] | prd.md §3.2 |
| FP-02-03 | NexusPlugin 插件接口 | Tier1 slashCommands 斜杠命令 | [插件能力][编辑交互] | prd.md §3.2 |
| FP-02-04 | NexusPlugin 插件接口 | Tier2 remarkPlugins 扩展解析器 | [插件能力][AST解析] | prd.md §3.2 |
| FP-02-05 | NexusPlugin 插件接口 | Tier2 widgets 自定义视图 | [插件能力][Live Preview] | prd.md §3.2 |
| FP-02-06 | NexusPlugin 插件接口 | Tier3 cmExtensions 注入 CM6 | [插件能力] | prd.md §3.2 |
| FP-03-01 | 核心数据流 | 用户输入→CM6 Transaction→EditorState | [AST解析][编辑交互] | prd.md §2.2 |
| FP-03-02 | 核心数据流 | 防抖调用 Unified 生成 AST | [AST解析][性能] | prd.md §2.2 |
| FP-03-03 | 核心数据流 | Decorations 将 AST 节点→Widget/Mark | [AST解析][Live Preview] | prd.md §2.2 |
| FP-03-04 | 核心数据流 | onChange(markdown, ast) 对外输出 | [API契约] | prd.md §2.2 |
| FP-04-01 | Live Preview 实时预览 | 光标不在结构内时折叠为 Widget | [Live Preview] | prd.md §4.1 |
| FP-04-02 | Live Preview 实时预览 | 光标移入时展开源码 | [Live Preview][编辑交互] | prd.md §4.1 |
| FP-04-03 | Live Preview 实时预览 | React createPortal 渲染桥接 | [Live Preview][API契约] | prd.md §4.1 |
| FP-05-01 | 安全与零信任 | rehype-sanitize 强制清洗 | [安全] | prd.md §4.2 |
| FP-05-02 | 安全与零信任 | 外部链接默认 rel="noopener noreferrer" | [安全] | prd.md §4.2 |
| FP-05-03 | 安全与零信任 | 执行型代码块隔离运行环境 | [安全][边界异常] | prd.md §4.2 |
| FP-06-01 | 模块化 UI 委托 | core 只计算坐标+选区状态 | [API契约] | prd.md §4.3 |
| FP-06-02 | 模块化 UI 委托 | editor.on('slashMenuChange') 状态订阅 | [API契约][编辑交互] | prd.md §4.3 |
| FP-06-03 | 模块化 UI 委托 | 宿主渲染绝对定位组件（解决 overflow 截断） | [插件能力][Live Preview] | prd.md §4.3 |
| FP-07-01 | Roadmap 演进路线 | Phase1 核心引擎 MVP | [一致性] | prd.md §5 |
| FP-07-02 | Roadmap 演进路线 | Phase2 框架拥抱（react/gfm/history/search） | [一致性] | prd.md §5 |
| FP-07-03 | Roadmap 演进路线 | Phase3 桌面端深度（IO 防抖/Widget API） | [一致性] | prd.md §5 |

## 统计汇总

- 一级功能点: 7
- 二级功能点: 29
- 类型标签分布:
  - [API契约]×11、[插件能力]×7、[编辑交互]×5、[AST解析]×4、[Live Preview]×5、[安全]×3、[数据IO]×1、[性能]×1、[边界异常]×1、[一致性]×3

## 覆盖率报告

### 输入源覆盖统计

| 输入源 | 功能项数 | 已覆盖 | 覆盖率 |
|--------|---------|--------|--------|
| prd.md §2 架构 | 4 数据流步骤 | 4 | 100% |
| prd.md §3 API | 13 接口字段 | 13 | 100% |
| prd.md §4 功能模块 | 9 功能点 | 9 | 100% |
| prd.md §5 Roadmap | 3 Phase | 3 | 100% |
| prd.md §1 概述 | 0 | 0 | 0%（纯定位描述，无可测试行为） |

### 未覆盖的需求点

- prd.md §1 产品定位/设计哲学（原因：声明性描述，无具体可测试行为）

### 总覆盖率: 29/29 = **100%**（可测试部分全覆盖）
