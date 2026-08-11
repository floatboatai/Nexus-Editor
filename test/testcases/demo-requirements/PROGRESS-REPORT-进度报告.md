# fp2tc 进度报告 + 检查清单（demo-requirements）

> 生成时间: 2026-08-11
> 输入功能点: 20 个一级 / 116 个二级（FP-demo-requirements-功能点.md）
> 测试框架: Playwright（Electron demo e2e）
> 模式: 基础+增强一步到位（每个子智能体生成前先阅读源码确认 DOM 选择器/行为，直接产出增强格式用例）

---

## 一、逐文件明细

| 序号 | FP 编号 | 一级功能点 | 文件路径 | 二级 FP 数 | 用例总数 |
|------|---------|-----------|---------|-----------|---------|
| 01 | FP-01 | ElectronMain 进程 | `CASE-ElectronMain进程/CASE-ElectronMain进程-测试用例.md` | 5 | 66 |
| 02 | FP-02 | createEditor 配置 | `CASE-createEditor配置/CASE-createEditor配置-测试用例.md` | 6 | 63 |
| 03 | FP-03 | EditorAPI 文档操作 | `CASE-EditorAPI文档操作/CASE-EditorAPI文档操作-测试用例.md` | 6 | 46 |
| 04 | FP-04 | EditorAPI 选区操作 | `CASE-EditorAPI选区操作/CASE-EditorAPI选区操作-测试用例.md` | 3 | 29 |
| 05 | FP-05 | EditorAPI 命令与资源 | `CASE-EditorAPI命令与资源/CASE-EditorAPI命令与资源-测试用例.md` | 3 | 30 |
| 06 | FP-06 | EditorAPI 事件与生命周期 | `CASE-EditorAPI事件与生命周期/CASE-EditorAPI事件与生命周期-测试用例.md` | 4 | 36 |
| 07 | FP-07 | NexusPlugin 插件体系 | `CASE-NexusPlugin插件体系/CASE-NexusPlugin插件体系-测试用例.md` | 4 | 38 |
| 08 | FP-08 | LivePreview 系统 | `CASE-LivePreview系统/CASE-LivePreview系统-测试用例.md` | 5 | 38 |
| 09 | FP-09 | Wikilinks 双向链接 | `CASE-Wikilinks双向链接/CASE-Wikilinks双向链接-测试用例.md` | 4 | 37 |
| 10 | FP-10 | 核心扩展功能 | `CASE-核心扩展功能/CASE-核心扩展功能-测试用例.md` | 5 | 30 |
| 11 | FP-11 | 多光标编辑 | `CASE-多光标编辑/CASE-多光标编辑-测试用例.md` | 2 | 25 |
| 12 | FP-12 | 国际化 | `CASE-国际化/CASE-国际化-测试用例.md` | 2 | 14 |
| 13 | FP-13 | GFM 预设 | `CASE-GFM预设/CASE-GFM预设-测试用例.md` | 5 | 36 |
| 14 | FP-14 | 撤销重做插件 | `CASE-撤销重做插件/CASE-撤销重做插件-测试用例.md` | 2 | 24 |
| 15 | FP-15 | 斜杠命令插件 | `CASE-斜杠命令插件/CASE-斜杠命令插件-测试用例.md` | 8 | 47 |
| 16 | FP-16 | 工具栏插件 | `CASE-工具栏插件/CASE-工具栏插件-测试用例.md` | 10 | 48 |
| 17 | FP-17 | 搜索插件 | `CASE-搜索插件/CASE-搜索插件-测试用例.md` | 8 | 41 |
| 18 | FP-18 | 字数统计插件 | `CASE-字数统计插件/CASE-字数统计插件-测试用例.md` | 9 | 48 |
| 19 | FP-19 | Demo 集成 | `CASE-Demo集成/CASE-Demo集成-测试用例.md` | 7 | 37 |
| 20 | FP-20 | Demo UI 布局 | `CASE-DemoUI布局/CASE-DemoUI布局-测试用例.md` | 5 | 32 |
| | | | **合计** | **116** | **765** |

---

## 二、二级功能点覆盖统计

| 统计项 | 数值 |
|-------|------|
| 一级功能点总数 | 20 |
| 二级功能点总数 | 116 |
| 已覆盖二级功能点 | 116 |
| 覆盖率 | 100% |
| 用例总数 | 765 |
| 平均每二级功能点用例数 | 6.6 |

---

## 三、框架分布

| 框架 | 用例数 | 占比 |
|------|-------|------|
| Playwright（Electron demo e2e） | 765 | 100% |

所有用例统一使用 `_electron as electron` + `launchDemo()` 启动 Electron demo，无 Chrome 浏览器测试。

---

## 四、FP 编号分配表

| FP 编号 | 一级功能点 | 二级 FP 范围 | 需求源 |
|---------|-----------|-------------|--------|
| FP-01 | ElectronMain 进程 | FP-01-01 ~ FP-01-05 | demo-requirements.md §2 |
| FP-02 | createEditor 配置 | FP-02-01 ~ FP-02-06 | demo-requirements.md §3.1 |
| FP-03 | EditorAPI 文档操作 | FP-03-01 ~ FP-03-06 | demo-requirements.md §3.2 |
| FP-04 | EditorAPI 选区操作 | FP-04-01 ~ FP-04-03 | demo-requirements.md §3.3 |
| FP-05 | EditorAPI 命令与资源 | FP-05-01 ~ FP-05-03 | demo-requirements.md §3.4-3.5 |
| FP-06 | EditorAPI 事件与生命周期 | FP-06-01 ~ FP-06-04 | demo-requirements.md §3.6-3.7 |
| FP-07 | NexusPlugin 插件体系 | FP-07-01 ~ FP-07-04 | demo-requirements.md §3.9 |
| FP-08 | LivePreview 系统 | FP-08-01 ~ FP-08-05 | demo-requirements.md §3.10 |
| FP-09 | Wikilinks 双向链接 | FP-09-01 ~ FP-09-04 | demo-requirements.md §3.11 |
| FP-10 | 核心扩展功能 | FP-10-01 ~ FP-10-05 | demo-requirements.md §3.12-3.13 |
| FP-11 | 多光标编辑 | FP-11-01 ~ FP-11-02 | demo-requirements.md §3.3 |
| FP-12 | 国际化 | FP-12-01 ~ FP-12-02 | demo-requirements.md §3.8 |
| FP-13 | GFM 预设 | FP-13-01 ~ FP-13-05 | demo-requirements.md §4 |
| FP-14 | 撤销重做插件 | FP-14-01 ~ FP-14-02 | demo-requirements.md §5 |
| FP-15 | 斜杠命令插件 | FP-15-01 ~ FP-15-08 | demo-requirements.md §6 |
| FP-16 | 工具栏插件 | FP-16-01 ~ FP-16-10 | demo-requirements.md §7 |
| FP-17 | 搜索插件 | FP-17-01 ~ FP-17-08 | demo-requirements.md §8 |
| FP-18 | 字数统计插件 | FP-18-01 ~ FP-18-09 | demo-requirements.md §9 |
| FP-19 | Demo 集成 | FP-19-01 ~ FP-19-07 | demo-requirements.md §10 |
| FP-20 | Demo UI 布局 | FP-20-01 ~ FP-20-05 | demo-requirements.md §11 |

---

## 五、未覆盖功能点列表

无。116 个二级功能点已 100% 覆盖。

---

## 六、关键陷阱提示汇总

以下是各子智能体在源码调查中发现的、对后续用例执行（tcAIrunner）至关重要的陷阱：

| # | 陷阱 | 影响 FP | 应对策略 |
|---|------|---------|---------|
| 1 | demo 未暴露 editor 实例到 window | 全部 | 所有用例通过 UI 副作用间接验证（DOM textContent/innerHTML/类名/属性） |
| 2 | 斜杠菜单 dismissed 后有锁存状态 | FP-15 | 测试间需 Escape 关闭菜单重置 |
| 3 | CM6 文本被渲染层截断 | FP-03 | 大文本断言改用 wordcount 状态栏而非 DOM textContent |
| 4 | 字数统计有 150ms 防抖 | FP-18 | 输入后 `waitForTimeout(200)` 再断言；选区统计同步更新无防抖 |
| 5 | demo 存在两套搜索 UI | FP-17 | CM6 面板用 `[data-test-id=...]`，独立 SearchBar 用 `.nexus-search-bar` |
| 6 | Mod-f 快捷键被 app.ts 抢占 | FP-17 | 通过 `page.evaluate` dispatch keydown 打开 CM6 搜索面板 |
| 7 | demo 未启用搜索历史 | FP-17 | `createSearchPlugin()` 未传 history，历史功能默认关闭 |
| 8 | demo 未启用斜杠命令历史 | FP-15 | `createSlashMenuUI(editor)` 未传 history，reorder/record 返回 null |
| 9 | applySettings 仅调用 setTheme() | FP-19 | livePreview/tabSize/direction 仅在初始化时生效，运行时不动态切换 |
| 10 | 工具栏有 19 个按钮（非 8） | FP-16 | 实际 8 组含 19 个 `.nexus-toolbar-btn`，3 个按钮触发下拉 |
| 11 | 斜杠菜单高亮类名是 `.is-active` | FP-15 | 选择器为 `.nexus-slash-menu__item.is-active` |
| 12 | 面板显隐基于 `style.display` | FP-20 | 切换面板不改变 DOM 存在性，仅改 `display: none/flex` |
| 13 | Backlinks unlinked 异步扫描 | FP-20 | requestIdleCallback 扫描，需 timeout 250ms 等待 |
| 14 | 颜色装饰空选区不修改 | FP-16 | applyTextColor/applyHighlight 空选区 return false |
| 15 | 工具栏按钮无 data 属性 | FP-20 | 定位策略用 `.toolbar button` + textContent 匹配 emoji 图标 |

---

## 七、执行批次记录

| 批次 | FP 编号 | 并行子智能体数 | 生成用例数 |
|------|---------|-------------|-----------|
| 第1轮 | FP-01/02/03 | 3 | 66+63+46=175 |
| 第2轮 | FP-04/05/06 | 3 | 29+30+36=95 |
| 第3轮 | FP-07/08/09 | 3 | 38+38+37=113 |
| 第4轮 | FP-10/11/12 | 3 | 30+25+14=69 |
| 第5轮 | FP-13/14/15 | 3 | 36+24+47=107 |
| 第6轮 | FP-16/17/18 | 3 | 48+41+48=137 |
| 第7轮 | FP-19/20 | 2 | 37+32=69 |
| **合计** | **20 个一级 FP** | **共 20 个子智能体** | **765** |
