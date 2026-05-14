# Editor Core Spec

## ADDED Requirements

### Requirement: provide getSelectedText on EditorAPI

`editor.getSelectedText()` SHALL return the text currently selected in the editor. When the selection is collapsed (anchor === head) it SHALL return an empty string. Reversed selections (head < anchor) SHALL be normalized so the returned string is always the span between the lower and higher position.

#### Scenario: Collapsed selection returns empty string
- **WHEN** `setSelection(5)` is called (collapsed cursor)
- **THEN** `getSelectedText()` SHALL return `""`

#### Scenario: Forward selection returns selected slice
- **WHEN** `setSelection(6, 11)` is called on document `"hello world"`
- **THEN** `getSelectedText()` SHALL return `"world"`

#### Scenario: Reversed selection is normalized
- **WHEN** `setSelection(11, 6)` is called (anchor=11, head=6)
- **THEN** `getSelectedText()` SHALL return `"world"` (same as forward selection)

#### Scenario: Multi-line selection preserves newlines
- **WHEN** `setSelection(0, 17)` is called on document `"line one\nline two\nline three"`
- **THEN** `getSelectedText()` SHALL return `"line one\nline two"` with the embedded newline intact

### Requirement: provide replaceRange on EditorAPI

`editor.replaceRange(from, to, insert, selection?, opts?)` SHALL replace the substring `[from, to)` with `insert` and — optionally — reposition the cursor/selection, **all in a single CM6 transaction**. One transaction SHALL produce exactly one undo entry: a single Ctrl+Z SHALL revert both the text change and the cursor move together.

- `selection` is optional. When omitted, CM6 maps the existing selection through the change using its default position mapping.
- `opts.silent` mirrors `setDocument`: when `true`, the `onChange` event SHALL NOT fire, but `getAst()` SHALL remain consistent for immediate callers.
- `from`, `to`, and `selection` offsets are in pre-edit document coordinates (same space as `getSelection()` returns).
- Callers are responsible for valid offsets; CM6 throws `RangeError` on out-of-bounds values.

#### Scenario: Basic range replacement changes document content
- **WHEN** `replaceRange(6, 11, "earth")` is called on document `"hello world"`
- **THEN** `getDocument()` SHALL return `"hello earth"`

#### Scenario: Selection is repositioned in the same dispatch
- **WHEN** `replaceRange(0, 5, "hi", { anchor: 0, head: 2 })` is called
- **THEN** `getDocument()` SHALL return `"hi world"` AND `getSelection()` SHALL return `{ anchor: 0, head: 2 }`

#### Scenario: Collapsed range inserts without deleting
- **WHEN** `replaceRange(5, 5, ",")` is called on document `"hello world"`
- **THEN** `getDocument()` SHALL return `"hello, world"`

#### Scenario: silent option suppresses onChange but keeps AST consistent
- **WHEN** `replaceRange(0, 5, "# Title", undefined, { silent: true })` is called
- **THEN** the `onChange` handler SHALL NOT be called AND `getAst().type` SHALL equal `"root"`

#### Scenario: replaceRange produces exactly one undo entry
- **WHEN** `replaceRange` is called and then `undo()` is called once
- **THEN** the document SHALL be fully restored to its state before `replaceRange`
- **AND** a second `undo()` SHALL return `false` (no further history entry exists)
