# Storage Interface Spec

## ADDED Requirements

### Requirement: Host-Owned Storage Adapter Contract

The system SHALL define a storage adapter contract for note/vault operations without requiring Nexus core to perform IO or authenticate to cloud services.

#### Scenario: Host supplies adapter
- **WHEN** a host wants to use a local, browser, or cloud-backed note store
- **THEN** it SHALL provide an adapter implementing the storage interface
- **AND** Nexus SHALL interact with the note store through that adapter contract

#### Scenario: Core remains IO-free
- **WHEN** the storage interface is introduced
- **THEN** `@floatboat/nexus-core` SHALL NOT import Node filesystem, Electron, browser storage, or cloud provider SDKs for concrete IO
- **AND** single-document editor usage SHALL continue to work without storage configuration

### Requirement: Provider-Neutral Resource References

The storage interface SHALL identify files and folders through provider-neutral refs that can represent both local filesystem paths and opaque cloud IDs.

#### Scenario: Local filesystem ref
- **WHEN** a local filesystem adapter returns a file
- **THEN** the returned ref MAY include a path-like display value
- **AND** the adapter SHALL still validate operations against its configured vault root

#### Scenario: Cloud provider ref
- **WHEN** a cloud adapter returns a file whose provider uses opaque IDs
- **THEN** the returned ref SHALL be able to carry that opaque ID
- **AND** UI display paths SHALL NOT be treated as the only stable identity

### Requirement: Basic Vault Operations

The storage adapter SHALL support the basic note vault operations needed by existing Nexus vault workflows: list, read, write, create file, create folder, rename, and delete.

#### Scenario: List note tree
- **WHEN** the host lists a vault
- **THEN** the adapter SHALL return file and folder nodes with stable refs, names, node kind, and optional children

#### Scenario: Read file content
- **WHEN** the host reads a file ref
- **THEN** the adapter SHALL return the current text content
- **AND** it MAY return provider revision metadata for later optimistic writes

#### Scenario: Write file content
- **WHEN** the host writes text content to a file ref
- **THEN** the adapter SHALL persist the content or return a typed error
- **AND** it SHALL return updated ref/revision metadata when available

#### Scenario: Mutate tree
- **WHEN** the host creates, renames, or deletes a file or folder
- **THEN** the adapter SHALL perform the mutation or return a typed error
- **AND** the adapter SHALL NOT silently mutate a different resource

### Requirement: Capabilities

The storage interface SHALL expose backend capabilities so hosts can disable UI actions that a provider does not support.

#### Scenario: Watch unsupported
- **WHEN** a provider cannot stream external changes
- **THEN** its capabilities SHALL mark watch support as unavailable
- **AND** the host SHALL be able to fall back to manual refresh

#### Scenario: Trash unsupported
- **WHEN** a provider cannot send deleted resources to trash
- **THEN** its capabilities SHALL mark trash support as unavailable
- **AND** delete behavior SHALL be explicit rather than silently hard-deleting

### Requirement: Typed Error Semantics

The storage adapter SHALL return typed errors for common storage failures.

#### Scenario: Auth required
- **WHEN** a cloud provider requires login or token refresh
- **THEN** the adapter SHALL report an auth-required error
- **AND** the host SHALL own the UI flow for re-authentication

#### Scenario: Permission denied
- **WHEN** the current user cannot read or write a resource
- **THEN** the adapter SHALL report a permission-denied error

#### Scenario: Conflict detected
- **WHEN** a write uses a stale revision/etag
- **THEN** the adapter SHALL report a conflict error
- **AND** it SHALL NOT overwrite remote content silently

#### Scenario: Offline
- **WHEN** a backend is unavailable because the client is offline
- **THEN** the adapter SHALL report offline state or an offline error according to its capabilities

### Requirement: Optional Change Notifications

The storage adapter SHALL support optional change notifications for backends that can watch or subscribe to external mutations.

#### Scenario: External file changed
- **WHEN** an external process or remote client changes a watched note
- **THEN** a watch-capable adapter SHALL emit a change event identifying the affected ref and change kind

#### Scenario: Unsubscribe from watch
- **WHEN** the host calls the unsubscribe function returned by watch
- **THEN** the adapter SHALL stop delivering change events to that listener

### Requirement: Existing Electron Vault Compatibility

The storage interface SHALL be expressive enough to model the existing electron-demo vault workflow.

#### Scenario: Existing local vault operations map to adapter methods
- **WHEN** the existing electron-demo vault lists, reads, writes, creates, renames, deletes, and watches local markdown files
- **THEN** each operation SHALL have an equivalent storage adapter method or documented helper

#### Scenario: Path escape guard preserved
- **WHEN** a local filesystem adapter receives a ref or target path that resolves outside the active vault root
- **THEN** the adapter SHALL reject the operation
- **AND** no file outside the vault SHALL be read or mutated
