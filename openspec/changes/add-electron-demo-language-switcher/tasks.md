## 1. Localization foundation

- [x] 1.1 Add the two-locale typed catalog and English fallback behavior.
- [x] 1.2 Persist a normalized locale in the existing Electron editor settings.
- [x] 1.3 Add focused tests for locale normalization, translation lookup, and persistence compatibility.

## 2. Visible Electron UI

- [x] 2.1 Add the language selector to legacy and runtime Settings surfaces.
- [x] 2.2 Localize toolbar, status line, prompts, confirmations, tooltips, and accessibility labels.
- [x] 2.3 Localize Vault, Outline, Backlinks, Search, settings, and image feedback surfaces.
- [x] 2.4 Localize currently enabled bundled toolbar, slash-command, search, and word-count contributions through their existing configuration points or minimal label options.
- [x] 2.5 Apply locale changes immediately without recreating the editor or losing application state.

## 3. Verification

- [x] 3.1 Run affected Electron and bundled-plugin tests.
- [x] 3.2 Build the Electron demo.
- [x] 3.3 Manually switch both directions in Electron and verify visible text, persistence after restart, and preservation of unsaved content.
