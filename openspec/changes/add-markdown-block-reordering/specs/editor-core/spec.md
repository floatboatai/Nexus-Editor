## ADDED Requirements

### Requirement: Prepare pending widget input before block movement

Core SHALL expose `prepareBlockMove(view): boolean` for synchronous preparation of pending table input. Callers SHALL invoke it before blurring widgets and SHALL read movement positions from the resulting current state. It SHALL return true only after relevant pending input has been accepted exactly and movement-blocking widget interactions have ended.

#### Scenario: Pending table input is accepted
- **WHEN** a table cell contains pending text and the host accepts the exact update
- **THEN** preparation SHALL commit that text through the normal transaction pipeline
- **AND** release editing locks so a subsequent movement uses the committed table source

#### Scenario: Host rejects or changes the pending input
- **WHEN** the host rejects a table update or replaces it with different content
- **THEN** preparation SHALL return false
- **AND** the unaccepted pending input SHALL remain available in its widget
- **AND** the caller SHALL NOT move old table source

#### Scenario: Equivalent transaction replacement
- **WHEN** the host replaces the transaction while preserving the exact requested table content
- **THEN** preparation SHALL treat the input as accepted
- **AND** equivalent transaction wrapping SHALL NOT unnecessarily block movement

#### Scenario: Composition, active gesture, or stale source
- **WHEN** a table session has active composition, an unfinished mouse interaction, or stale source positions
- **THEN** preparation SHALL return false before using those positions to commit input
- **AND** the pending input SHALL remain available for completion or resolution

#### Scenario: Independent editor views
- **WHEN** one editor has a blocked table session and another editor has no blocking session
- **THEN** preparing the second editor SHALL NOT read or change the first editor's pending input

### Requirement: Preserve history metadata through transaction processing

Core SHALL retain history isolation and history-inclusion annotations when reconstructing an existing CodeMirror transaction through its transaction pipeline.

#### Scenario: An isolated movement passes through host hooks
- **WHEN** the transaction pipeline reconstructs an isolated block movement
- **THEN** the resulting transaction SHALL retain its history boundary
- **AND** adjacent typing or movement SHALL NOT be merged into that undo event
