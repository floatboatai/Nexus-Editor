# Nexus Editor 测试体系

TypeScript monorepo（pnpm workspace）CodeMirror 6 Markdown 编辑器的测试体系说明。三层金字塔结构，对应 CI 触发频率：

| 层 | 内容 | 位置 | CI |
|---|---|---|---|
| L0 | prd 代表性 vitest 用例（核心数据流，实测 42 用例） | `test/testcases/prd/CASE-核心数据流/` | 每次 PR（`pnpm test:prd`） |
| L1 | 撤销重做插件 e2e（实测 27 用例） | `test/testcases/demo-requirements/CASE-撤销重做插件/` | PR e2e job |
| L2 | 核心扩展功能 e2e（实测 24 通过 + 7 skip）+ fold vitest（实测 7 用例） | `test/testcases/demo-requirements/CASE-核心扩展功能/` | PR e2e job |

> 用例数为 2026-08-11 实测；随用例增删会变化，请以当前运行结果为准。

> 本文件是**测试体系**说明，覆盖 `test/testcases/` 下三层测试的组成、本地运行与 CI 集成。

## 本地运行

### `pnpm test`（常规单测，全量）
`vitest run packages apps/electron-demo/test` —— 覆盖 packages/* 与 apps/electron-demo/test 下的 vitest 用例（34 文件 537 用例全绿）。**不含** `test/testcases/` 下的用例。

### `pnpm test:prd`（L0 核心数据流）
`vitest run test/testcases/prd/CASE-核心数据流 --exclude "**/RUN-FP-03-01-F02.test.ts"` —— 跑 PRD 核心数据流用例，实测 31 文件 42 用例全绿。被 exclude 的是 BUG-001 复现文件（见下文"已知 BUG"）。无需额外前置条件。

### e2e（L1 / L2，Playwright + 真实 Electron）
前置条件（按顺序）：
1. `pnpm install`
2. `pnpm build:electron-demo`（构建 apps/electron-demo 产物——e2e 需要其中的 `dist-electron/main.js`，renderer 页面由 dev server 提供）
3. 启动 Vite dev server：`pnpm --filter @floatboat/nexus-electron-demo dev:renderer`（监听 localhost:5173，e2e 通过 `VITE_DEV_SERVER_URL=http://localhost:5173` 驱动）

两种跑法：

- **跑单个 CASE（推荐调试）**：直接 `npx playwright test` 配合各 CASE 目录内独立 `playwright.config.ts`（`testDir: "./"`，`testMatch: /RUN-.*\.spec\.ts$/`）。示例：
  ```bash
  cd test/testcases/demo-requirements/CASE-撤销重做插件 && npx playwright test
  ```
- **跑 runner（生成 results.json）**：cd 进 CASE 目录执行 `node RUN-*-runner.mjs`。runner 双通道扫描本目录 `RUN-*.spec.ts`（Playwright，用 CASE 级 config）与 `RUN-*.test.ts`（Vitest，用项目根 config 提供 `@codemirror/*` 等 alias），汇总写入 `RUN-*-results.json`。支持 `--case=` / `--channel=` 过滤，任一失败时退出码非 0。
  ```bash
  cd test/testcases/demo-requirements/CASE-核心扩展功能 && node RUN-核心扩展功能-runner.mjs
  ```
  过滤示例：`node RUN-核心扩展功能-runner.mjs --case=FP-11-01-N01`（单条）、`--channel=playwright`（仅 Playwright 通道），更多见各 runner.mjs 文件头。

### `pnpm test:e2e`（两个 CASE 串行）
`node test/testcases/demo-requirements/CASE-撤销重做插件/RUN-撤销重做插件-runner.mjs && node test/testcases/demo-requirements/CASE-核心扩展功能/RUN-核心扩展功能-runner.mjs` —— 串行跑两个 runner。**需 Vite dev server 运行中**；本地有显示服务器直接 node，CI 无显示服务器用 `xvfb-run -a` 包裹（见下）。

## CI 集成（.github/workflows/ci.yml）

- **verify job**（每次 PR）：`pnpm typecheck` → `pnpm test` → `pnpm test:prd` → `pnpm build` → `pnpm build:electron-demo`。PRD 用例不进 `pnpm test`（其仅覆盖 packages 与 electron-demo/test），因此单独用 `test:prd` 保证 PRD 用例进 CI。
- **e2e job**（新增，首次落地）：
  - 步骤：安装依赖 → build → build:electron-demo → `npx playwright install --with-deps electron` → 后台启动 dev server（`nohup pnpm --filter @floatboat/nexus-electron-demo dev:renderer`，curl 轮询 localhost:5173 就绪）→ `xvfb-run -a node` 依次跑两个 runner.mjs（两个步骤均 `if: always()`）。
  - **`continue-on-error: true`**：首次 CI 接入，允许 Electron 系统依赖/显示服务器等环境差异导致的失败不阻塞 PR（用例已在本地全绿）。ci.yml 注释明确：首次 CI 稳定后（如连续 N 次全绿）应移除该标志，避免被永久保留。
  - CI 不复用 `pnpm test:e2e`：本地/CI 有显示服务器与 dev server 启动方式的差异，故拆成两个独立步骤 + xvfb-run。

## 设计说明

- **每个 CASE 目录持独立 `playwright.config.ts`**（`testDir: "./"`、`testMatch: /RUN-.*\.spec\.ts$/`、`timeout: 90_000`、`workers: 1` 串行）。根 `playwright.config.ts` 的 testDir 仅覆盖 `./test/e2e`（另一批直接落库的 e2e 测试，本次 CI 集成不动），两者互不干扰。
- **e2e 驱动真实 Electron demo**：`test/e2e/helpers/electron-launcher.ts` 的 `launchDemo()` 用 `_electron.launch` 启动 `apps/electron-demo`（electron 二进制经 `createRequire` 从 electron-demo 的依赖解析，不传 executablePath 以保证 Playwright 连接注入），注入 `VITE_DEV_SERVER_URL` 后等待 `.cm-content` 出现。
- **用例来源**：fp2tc 依据需求生成 CASE 文档（`test/testcases/*/*-测试用例.md`），由 tcAIrunner 固化为 `.spec.ts` / `.test.ts` + `runner.mjs`，运行结果落 `results.json`。
- **已知限制**：demo 未挂载 `foldGutter`/`foldKeymap` 且 renderer 不暴露 CM6 view，fold 相关 e2e 用例采用"能力探测 → skip"策略，验证目标由 vitest 单测 `RUN-FP-11-02.test.ts`（7 用例）承接。探测与 skip 的完整原因见 `RUN-核心扩展功能.spec.ts` 文件头注释。
- **已知 BUG**：BUG-001（CM6 history 合并相邻变更，混合 input+setDocument 无法逐步 undo/redo），复现用例 `RUN-FP-03-01-F02.test.ts` 被 `test:prd` 的 `--exclude` 排除；根因分析与 `isolateHistory.of(true)` 修复建议见 `test/testcases/prd/CASE-核心数据流/BUG-核心数据流.md`。
