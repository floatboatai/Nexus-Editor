# Change: Add zero-dependency localization (i18n) for editor and host UI

## Why

The editor, its plugin UIs, and the Electron demo's host chrome were all
English-only. CJK users are a stated audience (the demo ships a Chinese
sample vault), yet there was no way to switch the interface language.

A first attempt only localized the editor-internal UI (toolbar, slash
menu, search panel, math widget, wordcount bar). The demo's Settings
Language select then "appeared to do nothing": the top toolbar, settings
panel, search bar, outline, vault, backlinks, and status line were still
hardcoded English. This change makes the *whole* visible surface
switchable and resolves the two-layer gap.

## What Changes

- **Core locale store** — `NexusLocale` remains the single flat,
  strongly-typed interface for every user-visible editor/plugin string,
  with `enLocale` / `zhLocale` and `resolveLocale(partial)` (shallow
  merge over English). Adds a module-level current-language store:
  `getLocale()` / `setLocale(partial)` / `setLocaleCode(code)` /
  `detectLocaleCode()` / `LOCALES`, plus the `NexusLocaleCode` union.
- **`createEditor` seeds the store** — passing `locale` to `createEditor`
  now also seeds the shared store, so plugin factories that run before
  `createEditor` returns resolve the same strings.
- **Plugin localization** — toolbar (`createToolbarPlugin` /
  `createToolbarUI` / `createToolbarSlashCommands`), slash menu
  (`createSlashMenuUI`), math (`createMathPlugin`), search and wordcount
  (`labelsFromLocale`) all read `getLocale()` at construction and accept
  an explicit `locale` / `labels` override.
- **Host chrome localization (Electron demo)** — new `DemoStrings` table
  in `apps/electron-demo/src/renderer/strings.ts` (`setDemoLanguage` /
  `uiStrings`) covers the toolbar, settings panel, search bar, outline,
  vault, backlinks, status line, and image widget. The Settings Language
  select persists `language` to `EditorSettings` and reloads the app to
  apply (localization is construction-time).
- **Tests** — core locale store + en/zh parity; toolbar zh slash
  commands + tooltips; slash-menu zh empty state/aria; editor-shell zh
  toolbar aria-label; settings-language persist/round-trip; new
  `demo-chrome-locale.test.ts` (5 cases).

No breaking changes: `enLocale` / `resolveLocale` / `NexusLocale` exports
are preserved, and `toolbarSlashCommands` is kept as a pre-resolved
English default for existing callers.

## Impact

- Affected specs:
  - `localization` (NEW capability) — core locale store contract,
    construction-time seeding, plugin UI resolution, host chrome
    switching.
- Affected code:
  - `packages/core/src/locale.ts`, `packages/core/src/index.ts`,
    `packages/core/src/editor.ts`, `packages/core/test/locale.test.ts`.
  - `packages/plugin-toolbar/src/{index,runtime-plugin,toolbar-commands,
    toolbar-ui}.ts`, `packages/plugin-slash/src/menu-ui.ts`,
    `packages/plugin-math/src/index.ts`, `packages/plugin-search/src/
    index.ts`, `packages/plugin-wordcount/src/status-bar.ts` + their
    tests.
  - `apps/electron-demo/src/renderer/{app,editor-shell,settings,
    search-bar,outline-panel,vault-panel,backlinks-panel}.ts` and new
    `strings.ts`; demo tests.
- READMEs updated where the package documents its public API:
  `packages/core/README.md`, `packages/plugin-slash/README.md`,
  `packages/plugin-wordcount/README.md`.
- New external dependencies: **none** (hand-rolled i18n; `navigator`
  language detection only).
