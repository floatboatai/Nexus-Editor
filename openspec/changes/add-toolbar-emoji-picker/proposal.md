# Change: Add an Emoji Picker to the Toolbar

## Why

Roadmap item **#12 — advanced toolbar (emoji picker / table tools / color picker), `plugin-toolbar`, P2** is planned but unstarted. The color picker half shipped; the table half lands in a sibling change; emoji has no entry point.

Typing an emoji means leaving the keyboard for the OS picker or pasting from elsewhere, which breaks the writing flow. Because the toolbar is already the place a host puts "things I do not want to remember the syntax for", an emoji picker belongs there — and unlike the table, there is no syntax to type at all, so the toolbar is the only reasonable entry point.

## What Changes

- Add `insertEmoji(editor, emoji)`: inserts at the caret, replacing the selection, through a single transaction.
- Add a curated emoji set in a new `packages/plugin-toolbar/src/emoji.ts`, grouped into categories, exported as `EMOJI_CATEGORIES` for hosts that want to build their own picker.
- Add an emoji picker dropdown: one grid per category with a heading, clicking an entry inserts it and closes the picker.
- Add an `iconEmoji` pictographic icon matching the existing icon set.
- Reuse the existing dropdown machinery (`DROPDOWN_STYLES`, `DROPDOWN_IDS`, the outside-click handler, `closeDropdown`) rather than introducing a second overlay path.
- Export `insertEmoji` and `EMOJI_CATEGORIES` from the package entry point.

## Non-Goals

- **No full Unicode emoji dataset, and no new dependency.** A complete table is a large runtime asset; adding one would put a licence review in front of the change (`GOVERNANCE.md §6.3`). The curated list covers the reactions that actually appear in notes. Hosts that need more can build their own picker from `slashMenuChange`-style state or from their own data.
- No search field, skin-tone variants, recently-used tracking, or custom emoji. The set is small enough to scan.
- No emoji shortcode syntax (`:smile:`) or autocomplete in the editor — that is an editor-level concern, not a toolbar one.
- No change to `packages/core/**`, `packages/plugin-slash/**`, or `packages/plugin-toolbar/src/formatting.ts` beyond adding `insertEmoji`.
- No toolbar CSS. The package ships no stylesheet; appearance stays with the host.

## Impact

- Affected specs: `plugin-toolbar`
- Affected code:
  - `packages/plugin-toolbar/src/emoji.ts` (new)
  - `packages/plugin-toolbar/src/formatting.ts` (`insertEmoji`)
  - `packages/plugin-toolbar/src/toolbar-ui.ts` (picker, button wiring)
  - `packages/plugin-toolbar/src/icons.ts` (`iconEmoji`)
  - `packages/plugin-toolbar/src/index.ts` (exports)
  - `packages/plugin-toolbar/test/plugin-toolbar.test.ts`
- Explicitly out of scope:
  - `packages/core/**`
  - `packages/plugin-slash/**`
