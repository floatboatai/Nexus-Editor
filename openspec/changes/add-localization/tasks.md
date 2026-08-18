# Implementation Tasks

## 1. Core locale store

- [x] 1.1 Extend `NexusLocale` (flat interface) with toolbar / slash /
  math / search / wordcount strings in `packages/core/src/locale.ts`;
  add `enLocale`, `zhLocale`, `resolveLocale`, `LOCALES`,
  `getLocale`, `setLocale`, `setLocaleCode`, `detectLocaleCode`,
  `NexusLocaleCode`.
- [x] 1.2 Export the new symbols from `packages/core/src/index.ts`.
- [x] 1.3 `createEditor({ locale })` seeds the shared store in
  `packages/core/src/editor.ts`; read `getLocale()` thereafter.
- [x] 1.4 Add store + parity tests in
  `packages/core/test/locale.test.ts`.

## 2. Plugin localization

- [x] 2.1 Toolbar: `createToolbarPlugin`/`createToolbarUI` accept
  `locale`; `createToolbarSlashCommands(locale)`; runtime plugin uses
  `getLocale()`. Tests in `plugin-toolbar.test.ts`.
- [x] 2.2 Slash menu: `createSlashMenuUI({ locale })`; aria + empty
  state localized. Tests in `menu-ui.test.ts`.
- [x] 2.3 Math: `createMathPlugin(locale?)` localizes the edit-formula
  button.
- [x] 2.4 Search / wordcount: `labelsFromLocale(locale)` label maps;
  `getLocale()` fallback; explicit `labels` override wins.

## 3. Electron demo host chrome

- [x] 3.1 New `strings.ts` with `DemoStrings` en/zh + `setDemoLanguage`
  / `uiStrings`.
- [x] 3.2 Boot seeds `setDemoLanguage(settings.language)` before chrome
  is built.
- [x] 3.3 Localize toolbar, settings panel, search bar, outline, vault,
  backlinks, status line, and image widget.
- [x] 3.4 Settings Language select persists `language`; changing it
  reloads the app (`applyLanguageIfChanged`).
- [x] 3.5 Runtime settings tab (`createProductSettingTab`) labels
  localized.

## 4. Tests + docs

- [x] 4.1 `settings-language.test.ts` (persist / round-trip).
- [x] 4.2 `editor-shell.test.ts` zh toolbar aria-label case.
- [x] 4.3 `demo-chrome-locale.test.ts` (5 cases).
- [x] 4.4 Update READMEs for public-API changes (core, plugin-slash,
  plugin-wordcount).
