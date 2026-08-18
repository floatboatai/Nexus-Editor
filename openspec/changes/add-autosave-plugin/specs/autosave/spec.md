## ADDED Requirements

### Requirement: Debounced Auto-Save
The system SHALL provide a `createAutoSavePlugin` that persists the editor's
Markdown source to a host-provided sink after edits settle.

#### Scenario: Edits settle then save
- **WHEN** the document changes and then stays unchanged for `delay` ms
- **THEN** `onSave` is called once with the latest Markdown source

#### Scenario: Burst edits collapse
- **WHEN** multiple edits occur within one `delay` window
- **THEN** only a single `onSave` fires after the window

#### Scenario: Manual flush
- **WHEN** `flush()` is called while a save is pending
- **THEN** `onSave` runs immediately and the pending timer is cancelled

#### Scenario: Teardown
- **WHEN** `destroy()` is called
- **THEN** no further `onSave` fires, even on later edits
