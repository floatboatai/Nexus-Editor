## Superpowers

- Superpowers is installed for Codex on this machine via `~/.agents/skills/superpowers`.
- If the current runtime can access those skills, use the relevant Superpowers workflow for planning, debugging, code review, and execution.

## Interview PR Evaluation Rules

When working on the LLM Wiki interview PR, judge every implementation decision through the same three dimensions the reviewer will use:

1. **Difficulty / 实现难度**
   - Prefer a scoped but non-trivial feature: filesystem workflow, Electron IPC, Python sidecar, async background compile queue, path safety, status reporting, and tests.
   - Avoid low-signal cosmetic work, one-off demos, or features that only work with a real LLM key.
   - Do not spend difficulty budget on unrelated rewrites, new frameworks, vector databases, GraphRAG, gbrain, or full chat UI.

2. **Completeness / 完成度**
   - The feature must work end to end without a real model by using a deterministic fixture provider.
   - A complete happy path is: first save creates/opens the LLM Wiki project, writes content into `raw/`, runs background ingest + lint, writes `wiki/`, refreshes the vault tree, refreshes `LinkIndex`, and makes wikilinks/backlinks usable.
   - Failure paths must be visible to the user: missing Python, dependency failure, provider timeout, invalid path, malformed JSON, no raw files, and lint issues.
   - CI must not require Claude CLI login, API keys, network access, or nondeterministic LLM output.

3. **Code Style / 代码风格**
   - Match the existing code style before adding abstractions. The Electron demo uses plain TypeScript, DOM APIs, small helper functions, `async`/`await`, and `contextBridge` IPC boundaries.
   - Keep changes close to existing ownership boundaries: Electron host logic in `apps/electron-demo/electron/`, renderer wiring in `apps/electron-demo/src/renderer/`, Python sidecar under `apps/electron-demo/llm-wiki/`.
   - Do not put LLM, Python, network, provider, or env-var logic into `@floatboat/nexus-core`.
   - Keep CSS additions minimal and consistent with the existing utilitarian demo UI. Do not redesign the app shell for this PR.
   - Prefer explicit guards and boring data structures over clever abstractions. A small duplicated check is better than a premature framework.

## LLM Wiki Development Rules

The LLM Wiki integration must be rigorous because it crosses trust boundaries: user files, generated files, Python execution, optional model access, and Electron renderer/main process separation.

1. **Architecture boundary**
   - Python sidecar owns `ensure`, `ingest`, and `lint`.
   - Electron main owns project resolution, raw save helper, Python process runner, debounce, single-flight compile queue, timeout, stdout size limit, and status events.
   - Renderer owns save-flow wiring and UI status only. Renderer must never read `.env`, spawn Python, access Node APIs directly, or receive model secrets.

2. **Project layout**
   - If a vault is open, that vault is the LLM Wiki project root.
   - If no vault is open, create/use the default project under Electron `app.getPath("documents")`, e.g. `Nexus LLM Wiki/`.
   - Project structure is `raw/`, `wiki/`, and `.nexus/llm-wiki-schema.md`.
   - Do not create a root-level `CLAUDE.md` for the LLM Wiki schema; it conflicts with project agent instructions.

3. **Save and compile semantics**
   - Saving a normal document imports/saves it to `raw/<safe-name>.md` and queues background compile.
   - Saving a file already under `raw/` writes that raw file and queues background compile.
   - Saving a file under `wiki/` must not mirror it back to `raw/` and must not trigger ingest. Only refresh link state.
   - Filesystem watchers may refresh vault/index state, but they must not trigger ingest. Ingest is scheduled only from controlled raw save paths.

4. **Safety**
   - Use `spawn(command, args)` with an argument array. Never compose a shell string for Python execution.
   - Normalize and validate all generated paths. Reject `..`, absolute paths, backslash escape, control characters, and writes outside the intended `raw/` or `wiki/` directories.
   - During ingest, Python treats `raw/` as read-only and writes only to `wiki/`.
   - Generated provider output is untrusted until slug, frontmatter, links, and paths are validated.

5. **Environment management**
   - Commit only `apps/electron-demo/llm-wiki/.env.example`.
   - Real config belongs in `apps/electron-demo/llm-wiki/.env`, which must stay ignored.
   - Python loads env only from the sidecar directory. Do not read project-root `.env`.
   - The default provider is `fixture`. Real `claude-agent-sdk` support is optional and must not be required for tests.
   - If using Claude Agent SDK, avoid accidental API-key billing. Strip `ANTHROPIC_API_KEY` by default unless an explicit sidecar env flag allows it.

6. **Queue and status**
   - Use debounce after save and allow only one Python compile process at a time.
   - If a save happens while compile is running, mark a pending rerun and execute once after the current run exits.
   - Raw save success must not wait for LLM compile completion.
   - Surface `queued`, `running`, `succeeded`, and `failed` statuses in the app status line or equivalent existing UI.

7. **Testing**
   - Add Python unit tests for ensure, slug/path guards, fixture ingest, lint, malformed provider output, and raw unchanged after ingest.
   - Add TypeScript/Vitest coverage for project resolution helpers, save path classification, wiki-save skip behavior, queue single-flight behavior, bridge types, and status handling.
   - Verify with `pnpm --filter @floatboat/nexus-electron-demo test` and `pnpm --filter @floatboat/nexus-electron-demo build` when implementation changes touch Electron demo code.

## Table Widget Development Rules

When modifying `packages/core/src/live-preview-table.ts`:

1. **Never clear state that was just set in the same flow.** If a function sets `rangeStart`, don't call another function that nullifies it before the value is used. Trace the full lifecycle (mousedown → mousemove → mouseup) before changing cleanup logic.

2. **rAF polling must respect all active interaction states.** Before clearing state in a rAF loop, check ALL flags: `isRangeSelecting`, `cellMouseDown`, `self.editing`. Missing any one causes the "works then immediately breaks" pattern.

3. **Never use inline border styles for drag indicators.** Use `box-shadow` or absolute-positioned overlay divs. Setting `border*` on table cells destroys structural borders on cleanup.

4. **`contentEditable` must be off by default on table cells.** Only activate on mousedown→focus, deactivate on blur. Otherwise browser text selection enters cells from outside.

5. **HTML5 Drag API is forbidden for table grips.** Use mousedown/mousemove/mouseup custom drag. HTML5 drag creates uncontrollable ghost images and can't be constrained to the table.

6. **Column grip pills must be positioned relative to header cells** (via absolute overlay or inline in header), NOT in a separate `<tr>` row — separate rows don't align with content column widths.

7. **Test every change with ALL interaction paths:** click-to-edit, drag-to-select-range, grip-click-to-select-column, grip-drag-to-reorder, click-outside-to-deselect, delete-key-on-selection.

8. **Any mouse interaction that spans multiple frames MUST set `self.editing = true` and increment `tableEditingCount`.** This prevents CM6 from recreating the widget DOM mid-interaction (via `eq()` returning true). Release in the mouseup handler. Without this, CM6 may destroy the DOM between mousedown and mousemove, leaving event listeners pointing at detached nodes.

9. **Cell `blur` handlers MUST check for active grip drag before clearing `editing`.** When user clicks a grip while a cell is focused, the event order is: grip mousedown (sets editing=true) → cell blur (async, would clear editing=false). The blur handler must guard with `if (draggingCol < 0 && draggingRow < 0)` before decrementing. Without this guard, drag works only when no cell was previously focused.

10. **`onDragEnd` MUST release editing lock BEFORE dispatching moveColumn/moveRow.** If editing=true during dispatch, the StateField takes the `decos.map` path (preserves old DOM), so the column move updates the markdown but the widget still shows old order. Correct order: (1) clean up visual state, (2) reset drag flags, (3) `self.editing = false; tableEditingCount--`, (4) dispatch move.

11. **rAF polling must respect ALL active interaction states.** Before clearing state in a rAF loop, check ALL flags: `isRangeSelecting`, `cellMouseDown`, `self.editing`, AND `rangeActive`. The `rangeActive` flag persists after mouseup for multi-cell selections — it is only cleared by explicit actions (`clearRangeSelection`). Missing this flag causes range selection to vanish on the next animation frame.

12. **StateField update must skip ALL rebuilds during `isTableEditing()`.** Both `docChanged` and selection-only changes. For docChanged use `decos.map(tr.changes)`, for selection-only return existing decos unchanged. If you only guard docChanged, selection changes during editing will trigger a full rebuild that recreates the widget DOM.
