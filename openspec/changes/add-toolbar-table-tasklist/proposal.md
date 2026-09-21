# Change: Add GFM table insertion and task-list commands to the toolbar plugin

## Why
The toolbar plugin shipped formatting helpers for lists, headings, and inline marks, but had no first-class support for two of the most common GitHub-Flavored Markdown constructs: tables and task lists. Authors who wanted a GFM table had to hand-type the delimiter row; authors who wanted a checklist had to memorize the `- [ ]` syntax. This change exposes three focused, undo-coherent commands — `insertTable`, `toggleTaskList`, `toggleTaskChecked` — and wires them into the toolbar UI, the slash-command registry, and the package's public exports, so the toolbar offers parity with the GFM features users already expect.

## What Changes
- **ADDED** `insertTable(editor, options?)` to `packages/plugin-toolbar/src/formatting.ts` — inserts a well-formed GFM table (configurable columns/rows, optional header row) as one atomic `replaceRange` transaction; caret lands inside the first body cell; a non-empty selection is replaced
- **ADDED** `toggleTaskList(editor)` — converts the selection's lines to `- [ ]` task items, converting plain text, ordered/unordered bullets in one pass; when every intersecting line is already a task item the markers are removed (toggle off); single atomic transaction
- **ADDED** `toggleTaskChecked(editor)` — flips `- [ ]`↔`- [x]` per line; leaves non-task lines untouched; no-op returning `false` when no task items intersect the selection; single atomic transaction
- **MODIFIED** `packages/plugin-toolbar/src/index.ts` — re-export the three new commands
- **MODIFIED** `packages/plugin-toolbar/src/toolbar-commands.ts` — register `table`, `task-list`, `task-toggle` slash commands
- **MODIFIED** `packages/plugin-toolbar/src/toolbar-ui.ts` — add `table`, `task-list`, `task-toggle` buttons to the default toolbar groups
- **MODIFIED** `packages/plugin-toolbar/src/icons.ts` — add `iconTable`, `iconTaskList`, `iconTaskToggle`

## Impact
- Affected specs: plugin-toolbar
- Affected code: `packages/plugin-toolbar/src/formatting.ts`, `index.ts`, `toolbar-commands.ts`, `toolbar-ui.ts`, `icons.ts`
- **No breaking changes** to existing API