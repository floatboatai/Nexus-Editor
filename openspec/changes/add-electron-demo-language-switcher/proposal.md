# Change: Add Chinese and English switching to the Electron demo

## Why

The Electron demo currently renders its product chrome and bundled UI in English only. Users need to switch the visible application interface between English and Simplified Chinese without restarting or changing their notes.

## What Changes

- Add an English/Simplified Chinese language setting to the Electron demo and persist it with the existing editor settings.
- Add a compact host-owned translation catalog and use it for visible toolbar, status, settings, panel, search, menu, dialog, tooltip, empty-state, and feedback text.
- Pass localized labels into bundled UI contributions that are visible in the demo, including toolbar, slash-command, search, and word-count surfaces where their existing options support labels.
- Apply a language change immediately while preserving the open vault, active document, editor selection, history, and unsaved content.
- Keep English as the fallback for missing or invalid persisted locale values.

## Non-Goals

- Translating user-authored notes, file or folder names, plugin-provided content, or operating-system dialog chrome.
- Adding a third-party internationalization framework or exposing a new public core-editor locale API; the broader core API remains covered by `add-missing-features`.
- Adding locales other than English and Simplified Chinese.

## Impact

- Affected specs: `electron-demo-localization` (new)
- Affected code: Electron demo renderer settings/chrome/panels plus the minimum bundled-plugin label options needed by currently visible UI
- Dependencies: none
- Compatibility: existing stored settings continue to load and default to English

