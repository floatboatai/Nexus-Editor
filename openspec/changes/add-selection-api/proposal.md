# Change: Add getSelectedText, replaceRange, and range-aware list toggles

## Why
The EditorAPI lacked a primitive for reading the current selection as a string, and had no atomic way to replace a document range while also repositioning the cursor. Without `replaceRange`, callers had to call `setDocument` then `setSelection` as two separate CM6 transactions — producing two undo entries, which caused Ctrl+Z to leave the document in a half-reverted state. The toolbar list-toggle commands were also selection-unaware: they read only `anchor`, silently collapsing multi-line selections to a single line.

## What Changes
- **ADDED** `getSelectedText(): string` to EditorAPI — returns the selected text, normalizing reversed selections; returns empty string when collapsed
- **ADDED** `replaceRange(from, to, insert, selection?, opts?)` to EditorAPI — replaces `[from, to)` and optionally repositions selection in one CM6 transaction (one undo entry); supports `silent` to mirror `setDocument` semantics
- **MODIFIED** `toggleOrderedList` and `toggleUnorderedList` in plugin-toolbar — now read the full selection range and apply markers to every line in the range; all-marked → remove, any-unmarked → add (mixed → on); column-0 boundary: line at `to` column 0 is excluded; reversed selections are normalized

## Impact
- Affected specs: editor-core, plugin-toolbar
- Affected code: `packages/core/src/types.ts`, `packages/core/src/editor.ts`, `packages/plugin-toolbar/src/formatting.ts`
- **No breaking changes** to existing API
