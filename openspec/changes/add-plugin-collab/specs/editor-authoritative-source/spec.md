## ADDED Requirements

### Requirement: Authoritative source registration is exclusive and owner-scoped

Core MUST allow at most one authoritative source registration per Editor. Registration MUST bind a stable owner id and history controller, MUST expose readiness and idempotent disposal, and MUST activate external-document behavior before readiness resolves. A competing registration MUST fail atomically without changing the existing source, history controller, or Editor behavior.

#### Scenario: First source becomes ready

- **WHEN** an owner registers an authoritative source on an Editor with no active source
- **THEN** the registration MUST resolve ready only after authoritative dispatch, history routing, and external-document behavior are active
- **AND** the owner MUST be visible in subsequent authoritative update contexts

#### Scenario: Competing source is rejected

- **GIVEN** one authoritative source is active
- **WHEN** another owner attempts to register a source on the same Editor
- **THEN** the second registration MUST fail without disposing, replacing, or partially reconfiguring the first source

#### Scenario: Source disposal restores default behavior

- **WHEN** the active source registration is disposed more than once
- **THEN** its resources MUST be released exactly once
- **AND** ordinary proposal, history, and table behavior MUST be restored after disposal completes

### Requirement: Local Proposals retain policy filtering

Transactions originating from ordinary CodeMirror dispatch, `EditorAPI.dispatchTransaction()`, or `EditorAPI.dispatchTransactions()` MUST be classified as Local Proposals. They MUST run filters in stable order, MUST commit nothing when rejected, and MUST commit only the final replacement when transformed. Update listeners MUST observe only the final committed result.

#### Scenario: Rejected proposal changes nothing

- **WHEN** a filter rejects a Local Proposal
- **THEN** EditorState, AST, change events, and any external document listener MUST remain unchanged
- **AND** the dispatch result MUST identify the rejecting owner and reason

#### Scenario: Replaced proposal publishes only the replacement

- **WHEN** a filter replaces a Local Proposal
- **THEN** Core MUST atomically commit only the final replacement transaction
- **AND** update listeners MUST observe one proposal update with the inherited origin chain

### Requirement: Authoritative Updates cannot be semantically rewritten

Only the active authoritative source registration MAY dispatch an Authoritative Update. Core MUST apply that transaction or batch with Local Proposal reject/replace filters bypassed, while still updating EditorState, AST, selection, change events, and update listeners as one atomic commit. An Authoritative Update MUST NOT silently fall back to the proposal path.

#### Scenario: Rejecting filter cannot block authority

- **GIVEN** a filter that rejects every Local Proposal
- **WHEN** the active source dispatches a valid Authoritative Update
- **THEN** Core MUST NOT call the rejecting filter
- **AND** the Editor, AST, events, and update listeners MUST reflect the authoritative result

#### Scenario: Authoritative batch is atomic

- **WHEN** the active source dispatches a sequential batch of changes and selection updates
- **THEN** observers MUST see one committed authoritative update
- **AND** no observer may see an intermediate document state

#### Scenario: Invalid source cannot downgrade to proposal

- **WHEN** a disposed, not-ready, or non-active source attempts authoritative dispatch
- **THEN** Core MUST return a stable structured failure without changing the Editor
- **AND** MUST NOT retry the transaction as a Local Proposal

### Requirement: Authority provenance is observable after commit

Every transaction/update context MUST identify its authority as `proposal` or `authoritative`. A committed Authoritative Update MUST also carry the active source owner id. Origin strings or CodeMirror annotations supplied by ordinary callers MUST NOT grant authoritative status.

#### Scenario: Listener distinguishes local and authoritative commits

- **WHEN** one Local Proposal and one Authoritative Update commit
- **THEN** an update listener MUST receive `proposal` for the first and `authoritative` plus source owner id for the second

#### Scenario: Magic origin cannot escalate authority

- **WHEN** an ordinary caller dispatches a transaction whose origin resembles an authoritative owner
- **THEN** Core MUST still classify and filter it as a Local Proposal

### Requirement: One history controller owns every Undo and Redo entry point

While an authoritative source is active, its history controller MUST receive `EditorAPI.undo()`, `EditorAPI.redo()`, configured history key bindings, `beforeinput` history events, and Host commands that call the Editor interface. Its boolean result MUST report whether the external history changed, but MUST NOT permit an active-source command to fall through to CodeMirror history. When no source is active these paths MUST preserve existing CodeMirror/plugin-history behavior. Disposal MUST NOT expose external-model history entries to the default history.

#### Scenario: Keyboard and Editor interface use the same controller

- **WHEN** an authoritative source is active and the user invokes undo once through a key binding and once through `EditorAPI.undo()`
- **THEN** both invocations MUST call the same registered history controller in order
- **AND** neither invocation may call CodeMirror history directly

#### Scenario: Empty external history does not mutate the projection history

- **WHEN** the active controller returns false for a `beforeinput(historyUndo)` event
- **THEN** Core MUST prevent the browser default and MUST NOT invoke CodeMirror history
- **AND** the Editor interface result MUST report that no external history entry changed
- **AND** unrelated input events MUST remain unaffected

#### Scenario: Disposal restores default history

- **WHEN** the authoritative source is disposed
- **THEN** subsequent Undo/Redo MUST use the existing default history path
- **AND** MUST NOT undo changes that exist only in the former external history

### Requirement: External-document mode prevents DOM-only document text

While an authoritative source is active, no editable Widget MAY retain document text solely in DOM until blur. The current live-preview table MUST route cell text editing to the corresponding Markdown source transaction path rather than contentEditable draft ownership. Before applying an Authoritative Update, Core MUST cancel any active non-text Widget gesture without committing partial DOM state.

#### Scenario: Table cell text edits through Markdown source

- **WHEN** a user activates a live-preview table cell while an authoritative source is active
- **THEN** Core MUST reveal or focus the corresponding Markdown source editing position
- **AND** every text change MUST enter EditorState as a Local Proposal rather than remain only in the table DOM

#### Scenario: Remote update interrupts a grip gesture safely

- **GIVEN** a table row, column, range, or resize pointer gesture is active
- **WHEN** an Authoritative Update must be applied
- **THEN** Core MUST cancel and release the gesture without committing a partial structural edit
- **AND** the authoritative document MUST be projected after the interaction lock is released

#### Scenario: IME text is not lost

- **WHEN** an Authoritative Update arrives during an Editor IME composition in external-document mode
- **THEN** the final Editor content MUST contain the correctly ordered local composition and authoritative changes
- **AND** no composition text may be duplicated, truncated, or left only in DOM

### Requirement: Authoritative lifecycle failures are explicit and bounded

Core MUST preserve its recursion bound and listener error isolation for Authoritative Updates. Destroying an Editor MUST release the active source and history controller exactly once. A failed authoritative apply MUST return a structured result so the caller can quarantine or recover; Core MUST NOT continue under a false success state.

#### Scenario: Recursion is bounded

- **WHEN** an authoritative update listener recursively dispatches until the configured limit
- **THEN** the next dispatch MUST return the stable recursion-limit result
- **AND** Core MUST remain usable for later non-recursive work

#### Scenario: Listener failure does not undo a committed authority update

- **WHEN** one update listener throws after an Authoritative Update commits
- **THEN** Core MUST continue notifying independent listeners
- **AND** MUST preserve the already committed authoritative document

#### Scenario: Editor destruction invalidates the source

- **WHEN** an Editor with an active source is destroyed
- **THEN** source and history resources MUST be released exactly once
- **AND** later source dispatch MUST return an Editor-destroyed or disposed-source failure without side effects
