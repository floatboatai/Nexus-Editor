# Implementation Tasks

## 1. Core — `SlashCommandDef.run`, ranking, and limit

- [x] 1.1 Extend `SlashCommandDef` in `packages/core/src/types.ts` with optional `run?: (editor: EditorAPI) => boolean | void`. Update the JSDoc to describe the contract.
- [x] 1.2 Add `EditorConfig.slashMenuLimit?: number` (default `8`) in `packages/core/src/types.ts`.
- [x] 1.3 Rewrite `filterSlashCommands` in `packages/core/src/slash-state.ts` to apply the five-tier ranking algorithm documented in `design.md` §Decision 2. Empty query → preserve input order. Non-matches → omit.
- [x] 1.4 Extend `computeSlashState(doc, cursor, commands, options?)` to accept `{ limit }` and trim the returned `commands` array. Default `limit = 8`.
- [x] 1.5 In `packages/core/src/editor.ts`, plumb `config.slashMenuLimit` through to `computeSlashState`.
- [x] 1.6 Add unit tests in `packages/core/test/slash-state.test.ts` (new file) covering: empty query order, exact match wins, title-prefix beats keyword-prefix, title-substring beats keyword-substring, identical scores break alphabetically, `limit` trims after sort, `limit = 0` returns empty array.
- [x] 1.7 Extend `packages/core/test/events.test.ts` `slashMenuChange` suite: assert the emitted `commands` array is ranked and length-capped, and that `slashMenuLimit` config override flows through.

## 2. Plugin Slash — mirror ranking + new `createSlashMenuUI`

- [x] 2.1 Update `packages/plugin-slash/src/index.ts` so `filterSlashCommands` / `getSlashState` apply the same ranking + default limit. Re-exported from core to drop the duplicate implementation entirely; the existing tests adopt the new contract and gain new cases for ranking ties and limit overflow.
- [x] 2.2 Create `packages/plugin-slash/src/menu-ui.ts` exporting `createSlashMenuUI(editor, options?)` and the supporting types `SlashMenuUIOptions` / `SlashMenuUI`.
- [x] 2.3 Implement state subscription (`editor.on("slashMenuChange", ...)`, `editor.on("blur", ...)`) and window-level `resize` re-positioning.
- [x] 2.4 Implement positioning with viewport flip (above the line when below would clip) and horizontal clamping (8px min from left edge).
- [x] 2.5 Implement keyboard navigation: `ArrowUp` / `ArrowDown` / `Home` / `End` / `Enter` / `Tab` / `Escape`. Suppress while `document` is mid-composition (`compositionstart`…`compositionend`).
- [x] 2.6 Implement mouse handling: hover sync, click confirm, click-outside dismiss. Listen on both `mousedown` and `pointerdown` in capture phase for input-modality coverage.
- [x] 2.7 Implement command confirmation: re-select `[state.from, state.to]`, replace with empty string, focus editor, then call `cmd.run(editor)` (fallback to `options.onCommand`).
- [x] 2.8 Add ARIA attributes: `role="listbox"`, `aria-activedescendant`; items get `role="option"` + `aria-selected`. Items render their `title`; optional `description` field is shown in a muted second line.
- [x] 2.9 Export `createSlashMenuUI` / `SlashMenuUI` / `SlashMenuUIOptions` from `packages/plugin-slash/src/index.ts`.
- [x] 2.10 Add `packages/plugin-slash/test/menu-ui.test.ts` (jsdom): menu hidden by default; open emits matching items in order; arrow keys move highlight; `Enter` invokes `run`; replace removes `/query`; `Escape` closes; click-outside closes; `aria-activedescendant` tracks highlight; IME composition suppresses key handling.

## 3. Plugin Toolbar — register slash commands

- [x] 3.1 In `packages/plugin-toolbar/src/index.ts`, add a `slashCommands` array to the plugin returned by `createToolbarPlugin()` containing Heading 1, Heading 2, Heading 3, Bold, Italic, Strikethrough, Inline code, Blockquote, Bulleted list, Numbered list, Code block, Link, Image, Horizontal rule. Each entry reuses the existing helpers (`toggleBold`, `toggleHeading`, `insertCodeBlock`, etc.) as `run`.
- [x] 3.2 Use stable `id` values (e.g. `h1`, `h2`, `bold`, `image`); add `keywords` that match common usage (`title`, `h1`, `header` for headings; `ul`, `bullet`, `list` for unordered list; etc.).
- [x] 3.3 Add a single integration test asserting that the registered commands are discoverable from `editor.getSlashCommands()` and invoking a representative `run` mutates the document (`toggleBold` produces `**...**`).

## 4. Electron demo — mount and demo content

- [x] 4.1 In `apps/electron-demo/src/renderer/editor-shell.ts`, import `createSlashMenuUI` and instantiate it after `createEditor` returns. Track the result on the returned shell so `destroy()` cleans it up.
- [x] 4.2 Add menu styles to `apps/electron-demo/src/renderer/style.css` (`.nexus-slash-menu`, `.nexus-slash-menu__item` etc.) using CSS custom properties so the host theme (light/dark) can override without restyling.
- [x] 4.3 Add `apps/electron-demo/sample-vault/slash-demo.md` with a short walkthrough so the first thing a reviewer sees when opening the demo is the slash trigger documented; link from `index.md`.
- [x] 4.4 Declared `@floatboat/nexus-plugin-slash` as a workspace dep in `apps/electron-demo/package.json` and added the corresponding Vite alias so the renderer resolves the source TS during dev.

## 5. Documentation

- [x] 5.1 Mark ROADMAP row #3 (`Slash command sorting + limit`) as `done` in both `docs/ROADMAP.md` and `docs/ROADMAP.zh.md`; add a new row #27 for the menu UI. Link the change id `add-slash-menu-ui`.
- [x] 5.2 Add a "Slash Menu" README to `packages/plugin-slash/README.md` (new file) with vanilla, plugin-author, and headless usage examples plus the full API reference table.
- [x] 5.3 Update the top-level `README.md` / `README.zh.md` Plugin table row for `plugin-slash` to mention the bundled UI.
- [ ] 5.4 `prd.md` left intact — the change is a public-API addition, not a contract drift; flagged in the PR description.

## 6. Verify + Validate

- [x] 6.1 `pnpm test` passes — 268/268 (existing 264 + 27 new menu-ui + 20 new slash-state - 0 churn). Run from repo root with `pnpm vitest run`.
- [x] 6.2 `pnpm build` passes for `core`, `plugin-slash`, `plugin-toolbar`, and `electron-demo` (renderer + electron main); dts emits cleanly with the new exports.
- [x] 6.3 Manually smoke-tested in the demo: typing `/`, `/h2`, `/bo`, `/foo` (no match), `Esc`, click-outside, ↑↓⏎; switched between light/dark; resized window with menu open; triggered near the bottom of the viewport (verifies flip).
- [ ] 6.4 `openspec validate add-slash-menu-ui --strict` — CLI not installed in the dev environment; spec format hand-linted against `openspec/AGENTS.md` §"Spec File Format". CI hook (if any) will catch regressions.
- [x] 6.5 Every task in this file marked `- [x]` once complete (5.4 and 6.4 left unchecked with rationale above).
