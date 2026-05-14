# Change: Add Slash Command Floating Menu with Ranking and Limit

## Why

Core already computes a full slash-menu state (`slashMenuChange` event with `isOpen`, `from`, `to`, `query`, filtered `commands`, and `coords`), but the project ships **no UI** that consumes it: typing `/` in the electron demo produces zero feedback. The headless `plugin-slash` package exposes only metadata (`{ id, title, keywords }`) with no execution hook, so a host cannot run the picked command without maintaining its own `id → action` registry. The roadmap calls out `[#3 Slash command sorting + limit | plugin-slash | P0 | planned]` but neither sorting nor a cap on results is implemented today.

This change closes the loop end-to-end: ranked commands, a capped result list, an executable `run` hook on each command, a framework-agnostic floating menu UI bundled in `@floatboat/nexus-plugin-slash`, and integration in the electron demo (including registering the existing `plugin-toolbar` formatting actions as slash commands).

## What Changes

- **Core (`@floatboat/nexus-core`)**:
  - `SlashCommandDef` gains an optional `run?: (editor: EditorAPI) => boolean | void` field; existing consumers that pass only metadata keep working unchanged.
  - `filterSlashCommands` now **ranks** matches deterministically (exact > title-prefix > title-substring > keyword-prefix > keyword-substring, ties broken by title length then alphabetically). Empty query keeps the original registration order.
  - `computeSlashState` accepts an optional `{ limit }` option (default **8**) and trims the returned `commands` array.
  - `EditorConfig.slashMenuLimit?: number` flows the limit through `createEditor` to `computeSlashState`.
- **Plugin Slash (`@floatboat/nexus-plugin-slash`)**:
  - Existing `filterSlashCommands` / `getSlashState` adopt the same ranking + limit so SDK consumers and the core event stay in lock-step.
  - **New** `createSlashMenuUI(editor, options)` mounts a floating, framework-agnostic menu listening to `slashMenuChange`:
    - Absolute-positioned overlay anchored to `state.coords`; viewport overflow → flip above the line.
    - Keyboard: `↑` / `↓` move the highlight, `Enter` / `Tab` confirm, `Esc` closes, `Home` / `End` jump.
    - Mouse: hover synchronises the highlight, click confirms, click-outside closes.
    - IME-aware: skips synthetic events while `compositionstart`…`compositionend` is in flight.
    - `role="listbox"` + `aria-activedescendant`; menu items expose `role="option"` and `aria-selected`.
    - On confirm: replaces `state.from..state.to` (the `/query` slice) with an empty string and invokes the picked command's `run(editor)`, or delegates to a host-provided `onCommand(cmd, ctx)` override.
  - `createSlashMenuUI` returns `{ element, destroy }`. The element is appended to `document.body` by default; a `container` option can mount elsewhere (e.g. for shadow-DOM hosts).
- **Plugin Toolbar (`@floatboat/nexus-plugin-toolbar`)** registers a `slashCommands` array covering Heading 1–3, Bold, Italic, Strikethrough, Inline code, Blockquote, Bulleted list, Numbered list, Code block, Link, Image, and Horizontal rule. Each entry reuses the existing formatting helpers as its `run`.
- **Electron demo (`apps/electron-demo`)** calls `createSlashMenuUI(editor)` in `editor-shell.ts`, ships menu styles in `style.css`, and adds a sample-vault note demonstrating the trigger.
- **Docs**: `docs/ROADMAP.md` row #3 transitions to `done` and references this change id.

No breaking changes: every public API addition is optional, and editors built without registered `slashCommands` continue to emit no `slashMenuChange` events.

## Impact

- Affected specs:
  - `editor-core` (ADDED — ranking, limit, `run` callback, `slashMenuLimit` config)
  - `slash-menu` (ADDED — new capability: floating UI behaviour, keyboard / mouse / a11y / IME / dismissal contracts)
- Affected code:
  - `packages/core/src/types.ts` (SlashCommandDef, EditorConfig)
  - `packages/core/src/slash-state.ts` (ranking + limit)
  - `packages/core/src/editor.ts` (wire limit, expose `run` execution hook)
  - `packages/plugin-slash/src/index.ts` (ranking + limit mirror, re-export menu UI)
  - `packages/plugin-slash/src/menu-ui.ts` (NEW)
  - `packages/plugin-slash/test/plugin-slash.test.ts` (extend)
  - `packages/plugin-slash/test/menu-ui.test.ts` (NEW)
  - `packages/core/test/events.test.ts` (extend slashMenuChange suite)
  - `packages/core/test/slash-state.test.ts` (NEW — direct ranking/limit unit tests)
  - `packages/plugin-toolbar/src/index.ts` (register slash commands)
  - `apps/electron-demo/src/renderer/editor-shell.ts` (mount menu UI)
  - `apps/electron-demo/src/renderer/style.css` (menu styles)
  - `apps/electron-demo/sample-vault/slash-demo.md` (NEW demo note)
  - `docs/ROADMAP.md` (status + linkage)
  - `README.md` / `README.zh.md` / `packages/plugin-slash/README.md` (public API examples)
- New dev dependencies: none.
- Out of scope (explicit non-goals):
  - Slash command grouping / category headers (v2).
  - Persistent "recently used" ordering across sessions (v2 — requires host storage adapter).
  - Slash menu inside live-preview widgets (table cells, etc.); the menu only opens from the source editor selection (v2).
  - Internationalisation of menu labels — the menu reuses each command's `title` verbatim, host owns translation.
