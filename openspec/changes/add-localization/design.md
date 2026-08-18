## Context

The editor is CodeMirror 6-based; plugin UIs (toolbar, slash menu,
search, math, wordcount) and the Electron demo's host chrome are all
vanilla DOM. There was no i18n layer. A hand-rolled, zero-dependency
store was chosen over i18next to keep the bundle lean and keep every
string statically type-checked against one flat interface.

Two independent facts shape the design:

1. **Construction-time resolution.** Plugin UI is built inside
   factories that run *before* `createEditor` returns, and localization
   is read at construction (widget text, aria-labels, placeholders are
   baked into the DOM). There is no live re-render, so language
   switching is applied by reloading the app.
2. **Two layers, two stores.** The editor/plugin strings are one
   concern (`NexusLocale` in core); the demo's own chrome (toolbar,
   settings, panels, status line) is host scaffolding and must not be
   mixed into the editor locale. It gets its own `DemoStrings` table.

## Goals / Non-Goals

- **Goals**
  - Single flat `NexusLocale` interface; en/zh guaranteed complete by
    TypeScript.
  - Module-level store so plugin factories and `createEditor` agree on
    the language without threading a locale through every call.
  - Optional per-factory `locale` / `labels` override for hosts that
    want explicit control.
  - Demo chrome fully switchable, with a persisted Settings select.
  - Zero new dependencies.
- **Non-Goals**
  - Live (no-reload) language switching — runtime re-render of every
    widget is a much larger follow-up.
  - Translation of arbitrary user content; only the UI surface is
    localized.
  - Plural/ICU message formatting (`Intl.PluralRules` etc.) — templates
    with `{placeholder}` substitution suffice for current strings.

## Decisions

### Decision 1: Module-level locale store, seeded by `createEditor`

`getLocale()` / `setLocale()` live at module scope in
`packages/core/src/locale.ts`. `createEditor({ locale })` calls
`setLocale(locale)` then reads `getLocale()`, so plugin factories that
run before `createEditor` returns (they are constructed with the
result) already see the right language.

**Alternatives considered:**

- *Thread the locale through every factory and config object.* Works
  but verbose and easy to miss a call site; the module store guarantees
  one source of truth. Rejected for ergonomics.
- *Only `createEditor`-passing.* Impossible: toolbar/slash/search/
  wordcount factories run before the editor is returned, so they can
  never see a locale passed only to `createEditor`. This was the
  original bug the user hit.

### Decision 2: Separate `DemoStrings` for host chrome

The demo keeps its own `apps/electron-demo/src/renderer/strings.ts`
with a `DemoStrings` interface + en/zh + `setDemoLanguage` / `uiStrings`.
Boot calls `setDemoLanguage(settings.language)` before building chrome.

**Why:** the demo chrome is not editor UI — hosts embed the editor and
build their own toolbars. Polluting `NexusLocale` with `appOpen`,
`vaultNewFile`, etc. would force every host to translate scaffolding
they don't own.

### Decision 3: Backward-compatible plugin API

Each plugin factory keeps its existing signature and gains an optional
`locale`/`labels` parameter; `toolbarSlashCommands` remains exported as
`createToolbarSlashCommands(enLocale)` for existing callers.

## Risks / Trade-offs

- **Stale dist masking changes.** Dev and tests resolve workspace
  packages to `src/index.ts` via Vite/vitest aliases, so source changes
  are live; published builds must be regenerated (`pnpm build`).
  Mitigation: full monorepo build is part of CI.
- **Two stores can drift.** `DemoStrings` and `NexusLocale` both have
  en/zh; parity is enforced per-file by TypeScript, not across files.
  Acceptable: the layers are deliberately decoupled.
- **No hot switch.** Reloading the app on language change drops
  in-memory state; unsaved changes are guarded by a confirm dialog.

## Open Questions

- Whether to add a live-switch mechanism (re-render on `setLocale`)
  as a follow-up capability.
