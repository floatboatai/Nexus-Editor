# Collaboration Spec

## ADDED Requirements

### Requirement: Opt-In Collaboration Plugin

The system SHALL provide an opt-in `@floatboat/nexus-plugin-collab` package that can be registered as a Nexus plugin without changing single-user editor behavior when the package is not installed.

#### Scenario: Editor without collaboration remains local
- **WHEN** an editor is created without `createCollabPlugin`
- **THEN** document editing, history, parsing, and live preview SHALL behave as they do today
- **AND** no collaboration dependencies SHALL be loaded by `@floatboat/nexus-core`

#### Scenario: Collaboration plugin registers cleanly
- **WHEN** an editor is created with `createCollabPlugin({ docId, provider })`
- **THEN** the plugin SHALL attach collaboration extensions for that document id
- **AND** the editor SHALL remain editable before and after the provider connects

### Requirement: Host-Owned Provider Boundary

The collaboration package SHALL accept a host-supplied provider object for transport, identity, authentication, and persistence. The package SHALL NOT require a Nexus-hosted server.

#### Scenario: Provider connection lifecycle
- **WHEN** the editor is created with a disconnected provider
- **THEN** the plugin SHALL allow the provider to connect
- **AND** provider status changes SHALL be observable through the public API

#### Scenario: Provider cleanup
- **WHEN** the editor is destroyed
- **THEN** the plugin SHALL unsubscribe all collaboration listeners
- **AND** SHALL disconnect or destroy provider resources according to the provider contract

### Requirement: Concurrent Editing Convergence

Multiple editors joined to the same collaboration document SHALL converge to the same document text after all local and remote updates are delivered.

#### Scenario: Concurrent inserts converge
- **GIVEN** two editors are connected to the same `docId`
- **WHEN** both editors insert text at overlapping positions before receiving the other's update
- **THEN** both editors SHALL eventually contain identical document text
- **AND** neither user's inserted text SHALL be silently dropped

#### Scenario: Remote update does not echo as a new local change
- **GIVEN** an editor receives a remote collaboration update
- **WHEN** that update is applied to the local editor state
- **THEN** the plugin SHALL NOT rebroadcast it as a new local edit

### Requirement: Initial Document Seeding

The collaboration plugin SHALL define deterministic initial document seeding so a host can join an existing shared document without overwriting it.

#### Scenario: Empty shared document can be seeded
- **GIVEN** the shared collaboration document is empty
- **WHEN** the host provides initial editor content
- **THEN** the plugin MAY seed the shared document once with that content

#### Scenario: Existing shared document wins
- **GIVEN** the shared collaboration document already has content
- **WHEN** a new editor joins with local initial content
- **THEN** the shared document content SHALL become the editor content
- **AND** the joiner SHALL NOT overwrite the shared document implicitly

### Requirement: Awareness and Remote Presence

The collaboration plugin SHALL support optional user awareness data and remote selection/cursor rendering without changing the local editor selection.

#### Scenario: Remote cursor is rendered
- **GIVEN** awareness is enabled
- **WHEN** another user moves their cursor
- **THEN** the local editor SHALL render that remote cursor or selection
- **AND** the local user's selection SHALL remain unchanged

#### Scenario: Awareness can be disabled
- **WHEN** the plugin is created without awareness options
- **THEN** document collaboration SHALL still work
- **AND** no remote cursor UI SHALL be rendered

### Requirement: Document Switching

The collaboration plugin SHALL provide a safe lifecycle for leaving one document and joining another.

#### Scenario: Switching document ids tears down old session
- **WHEN** the host switches from `docA` to `docB`
- **THEN** the plugin SHALL leave or destroy the `docA` session
- **AND** subsequent remote updates for `docA` SHALL NOT mutate the editor now joined to `docB`

### Requirement: Error and Reconnect Handling

Provider errors and reconnects SHALL be visible to the host without making the editor read-only by default.

#### Scenario: Provider enters error state
- **WHEN** the provider reports an error
- **THEN** the host SHALL be able to observe the error/status
- **AND** local editing SHALL continue unless the host explicitly disables it

#### Scenario: Reconnect applies queued updates
- **GIVEN** the provider supports offline queuing
- **WHEN** a disconnected editor reconnects
- **THEN** queued local updates SHALL sync to peers
- **AND** the document SHALL converge after delivery
