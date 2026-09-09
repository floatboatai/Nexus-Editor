## Context

Visible strings are currently embedded across the Electron renderer and several bundled UI contributions. The demo already persists editor settings in `localStorage`, and the existing `add-missing-features` proposal separately covers a reusable core-editor locale API.

## Goals / Non-Goals

- Goals: switch all currently visible product-owned text between English and Simplified Chinese, persist the choice, update without restart, and preserve editing state.
- Non-Goals: introduce a general i18n framework, translate user data or arbitrary third-party plugins, or duplicate the proposed core-editor locale API.

## Decisions

- Add `locale: "en" | "zh-CN"` to the existing Electron `EditorSettings`; normalize unknown stored values to `"en"`.
- Use one typed translation catalog and a small lookup/formatting function owned by the Electron demo. No dependency or asynchronous locale loading is needed for two bundled locales.
- Put the selector in the existing Settings surface and refresh host-owned labels in place. Components that render dynamic text receive locale access or localized label options instead of reading global DOM text.
- Reuse existing plugin label/configuration hooks. Add only the smallest label option where a currently enabled bundled UI has hard-coded visible English.
- Set the document `lang` attribute when the locale changes for assistive technology.

## Risks / Trade-offs

- A fixed catalog requires new visible strings to be added manually. A focused test will fail when key surfaces fall back unexpectedly.
- Some operating-system-provided dialog chrome remains controlled by Electron/Windows and is outside renderer localization.

## Migration Plan

Existing settings are merged with defaults, so installations without `locale` start in English. No data migration or rollback step is required.

