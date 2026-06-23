# 贡献指南 / Contributing to Nexus Editor

感谢贡献！本仓库为 pnpm + TypeScript monorepo，遵循 **Conventional Commits** 与 **OpenSpec** 驱动开发。

[English](./CONTRIBUTING.md)

> **开始之前：** 请先读 [`GOVERNANCE.md`](./GOVERNANCE.md)，了解项目范围、贡献政策（CLA、AI 生成代码、依赖）以及我们接受 / 拒绝的标准。本文件讲*流程*，`GOVERNANCE.md` 讲*规则*。

---

## 1. 仓库结构速览

| 路径 | 说明 |
|---|---|
| `packages/core` | 核心编辑器（CodeMirror 6 内核、live-preview、AST） |
| `packages/preset-gfm` | GFM 默认预设 |
| `packages/plugin-*` | 各功能插件（history / search / slash / toolbar / math / vim / wordcount） |
| `packages/react`、`packages/vue` | 框架 SDK |
| `apps/electron-demo` | 桌面端 demo / 集成测试场 |
| `openspec/` | 规格驱动（proposal / specs / archive） |
| `docs/ROADMAP.md` | 当前 roadmap 与 owner 分布 |

---

## 2. 分支与提交

### 分支命名

```
<type>/<scope>-<short-desc>
```

示例：`feat/toolbar-list-toggle`、`fix/search-regex-escape`、`docs/roadmap-update`。

### Commit Message（Conventional Commits）

```
<type>(<scope>): <subject>
```

- **type**：`feat` / `fix` / `perf` / `refactor` / `test` / `docs` / `chore` / `ci` / `build`
- **scope**（强约束，必须是下表之一或省略）：

  | scope | 对应目录 |
  |---|---|
  | `core` | `packages/core` |
  | `react` | `packages/react` |
  | `vue` | `packages/vue` |
  | `gfm` | `packages/preset-gfm` |
  | `history` / `search` / `slash` / `toolbar` / `math` / `vim` / `wordcount` | 对应 `plugin-*` |
  | `electron` | `apps/electron-demo` |
  | `live-preview` / `wikilinks` / `image` | core 内部子系统（沿用历史用法） |
  | `openspec` | `openspec/` |

- **subject**：祈使句、英文、≤ 72 字符、句末不加句号

参考既有 commit：

```
feat(image): Obsidian-style image preview with |width syntax and drag-resize
fix(live-preview): height-neutral decorations + always-on block widgets
test(live-preview): regression tests for click-drift invariants
```

### 何时拆 PR

- 一个 PR 解决一件事。重构与功能不要混在同一个 PR。
- 涉及多个 package 的连锁修改可放同一 PR，但必须在描述中按 package 分节说明。

---

## 3. PR 流程

### 3.1 是否需要 OpenSpec proposal

下列情况**必须**先走 `openspec/changes/<id>/` 提案，再开实现 PR：

- 引入新 capability（如新插件、新公开 API）
- 公共 API 的破坏性变更
- 跨包架构调整、性能/安全相关大改

不需要 proposal 的情况：bug 修复、内部重构、依赖升级、测试/文档补充。

具体流程见 `openspec/AGENTS.md`。

### 3.2 PR 必备项

- [ ] 标题遵循 Conventional Commits（同 commit message 规则）
- [ ] 描述说明 **Why** 而不只是 **What**
- [ ] 包含测试（见下方测试矩阵）
- [ ] `pnpm test` 全绿
- [ ] 受影响包能 `pnpm build` 成功
- [ ] 若改动公共 API，更新对应 `packages/*/README.md`
- [ ] 若改动 `packages/core/src/live-preview-table.ts`，逐条核对 `CLAUDE.md` 中的 12 条 Table Widget 规则
- [ ] 若新增/修改 capability，附上 OpenSpec change id

### 3.3 测试矩阵

| 改动类型 | 必须 | 建议 |
|---|---|---|
| `packages/core` 渲染层 | vitest 单测 | electron-demo 手动验证 |
| `plugin-*` | vitest 单测 | demo 集成验证 |
| React/Vue SDK | 框架单测 | 在 demo 中挂载验证 |
| Live-preview / 表格 / wikilinks | **回归用例必加** | 鼠标交互手动走查 |
| 仅文档/配置 | — | — |

---

## 4. 代码风格

- TypeScript strict；公共导出必须有类型签名。
- 不写 what 注释、不写 PR/issue 引用注释。只在 **why 非显然**时写一行简注（参考 CLAUDE.md "Doing tasks"）。
- UI 改动需要在 electron-demo 实际跑一遍，不能只看类型检查。

---

## 5. 安全与权限

- 不要提交 `.env`、密钥、token、个人 vault 数据。
- 不要提交构建产物（`dist/`、`dist-electron/`、由 `.ts` 编译出的 `.js`）——它们在 `.gitignore` 里是有原因的，别用 `git add -f` 强加。
- 不要在未授权下 `git push --force` 到 `main`。
- 安全漏洞：请通过 GitHub 的 *"Report a vulnerability"* 私密上报，不要开公开 issue。见 [`GOVERNANCE.md` §7](./GOVERNANCE.md#7-security)。

---

## 6. 发布

发布由 maintainer 通过 `pnpm publish:packages` + tag 触发，贡献者无需操作 npm。
