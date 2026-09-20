## ADDED Requirements

### Requirement: Standard and Obsidian image references render in Vault live preview

The Electron demo SHALL render both standard Markdown image references and Obsidian-style image embeds when the active document belongs to an opened Vault, without rewriting the authored source.

#### Scenario: Standard relative Markdown image

- **WHEN** a Vault note contains `![Logo](assets/logo.png)`
- **AND** `assets/logo.png` exists relative to the note's directory
- **THEN** live preview SHALL render the image
- **AND** the document source SHALL remain `![Logo](assets/logo.png)`

#### Scenario: Obsidian image embed

- **WHEN** a Vault note contains `![[assets/logo.png]]`
- **AND** `assets/logo.png` exists relative to the note's directory
- **THEN** live preview SHALL render the image
- **AND** the `![[...]]` source SHALL remain editable and unchanged

#### Scenario: External image URL

- **WHEN** a note contains `![Remote](https://example.com/logo.png)`
- **THEN** live preview SHALL continue to load the external URL
- **AND** the URL SHALL NOT be treated as a Vault-relative path

### Requirement: Image paths SHALL be resolved relative to the active note and contained by the Vault

The host SHALL resolve local image references relative to the active Markdown file, normalize path separators, and reject targets that resolve outside the active Vault.

#### Scenario: Nested note resolves a sibling attachment

- **GIVEN** the active note is `notes/today.md`
- **WHEN** it references `../assets/photo.png`
- **AND** the resolved path is inside the Vault
- **THEN** the host SHALL request the Vault resource for `assets/photo.png`

#### Scenario: Traversal outside the Vault is rejected

- **WHEN** an image reference resolves outside the active Vault
- **THEN** the host SHALL NOT create a resource URL
- **AND** the renderer SHALL show the missing or blocked-image fallback

#### Scenario: Unsupported local scheme is rejected

- **WHEN** an image reference uses `file://`, `javascript:`, or another unsupported scheme
- **THEN** the host SHALL reject it without reading a local file

### Requirement: Local image resources SHALL use revocable scoped URLs

Vault-local images SHALL be loaded through the existing scoped resource mechanism. The renderer SHALL NOT receive or place an absolute filesystem path in an image source, and every resource registration SHALL be revocable.

#### Scenario: Resource URL hides the filesystem path

- **WHEN** a valid Vault image is rendered
- **THEN** the image source SHALL be an opaque host resource URL
- **AND** the source SHALL NOT contain the Vault's absolute filesystem path

#### Scenario: Stale image load is discarded

- **WHEN** an image resource request completes after the active document or Vault has changed
- **THEN** the stale result SHALL NOT be assigned to the new document
- **AND** its registration SHALL be revoked

#### Scenario: Widget destruction revokes access

- **WHEN** an image widget is removed or the editor is destroyed
- **THEN** its resource registration SHALL be revoked exactly once
- **AND** the previous resource URL SHALL no longer return the image bytes

### Requirement: Image failures SHALL be visible and non-fatal

An unavailable, malformed, or blocked image SHALL not break Markdown editing or the remaining live preview widgets.

#### Scenario: Missing image fallback

- **WHEN** a valid local reference has no corresponding file
- **THEN** the renderer SHALL show a user-visible missing-image state
- **AND** the editor SHALL remain editable
