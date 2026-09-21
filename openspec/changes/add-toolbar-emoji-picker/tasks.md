# Implementation Tasks

## 1. Phase 1 - OpenSpec and Red Tests

- [x] 1.1 Create `openspec/changes/add-toolbar-emoji-picker/proposal.md`.
- [x] 1.2 Create `openspec/changes/add-toolbar-emoji-picker/specs/plugin-toolbar/spec.md`.
- [x] 1.3 Add failing `plugin-toolbar` tests for `insertEmoji` and for the picker's render-insert-close path.
- [x] 1.4 Run the targeted `plugin-toolbar` tests and confirm failures are limited to the unimplemented behaviour.

## 2. Phase 2 - Emoji Set

- [x] 2.1 Add `packages/plugin-toolbar/src/emoji.ts` with `EMOJI_CATEGORIES`.
- [x] 2.2 Keep the set curated — no runtime dependency, no generated Unicode table.
- [x] 2.3 Export `EMOJI_CATEGORIES` and the `EmojiCategory` type from the package entry point.

## 3. Phase 3 - Insert Command

- [x] 3.1 Add `insertEmoji(editor, emoji)` to `packages/plugin-toolbar/src/formatting.ts`.
- [x] 3.2 Insert through `editor.replaceSelection` so the write is a single transaction.
- [x] 3.3 Reject empty input without touching the document.
- [x] 3.4 Export `insertEmoji` from the package entry point.

## 4. Phase 4 - Picker

- [x] 4.1 Add `iconEmoji` to `packages/plugin-toolbar/src/icons.ts`, matching the existing 18-unit / 1.8-stroke set.
- [x] 4.2 Add `showEmojiPicker(editor, anchorBtn, onClose)` rendering one labelled grid per category.
- [x] 4.3 Give every entry its emoji as an accessible name.
- [x] 4.4 Insert on click and close the picker.
- [x] 4.5 Register the picker in `DROPDOWN_IDS` and the button's click handler; add the button to `defaultGroups`.
- [x] 4.6 Keep `packages/core/**` and `packages/plugin-slash/**` unchanged.

## 5. Phase 5 - Verification

- [x] 5.1 Run the targeted `plugin-toolbar` tests and confirm the new red tests pass.
- [x] 5.2 Run the full suite and confirm no regressions.
- [x] 5.3 Run `pnpm typecheck`, `pnpm check:api`, and `pnpm build`.
- [x] 5.4 Verify in the real Electron demo that the picker opens, renders every category, and inserts the clicked emoji at the caret.
