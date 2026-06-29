# demo-asset-storage Specification

## Purpose

Persist pasted/dropped image assets to the vault in the electron-demo via a path-confined binary IPC, return a vault-resolvable URL that renders for a note in any directory, and keep core's file-upload Markdown emitter syntactically safe.

## Requirements

### Requirement: Persist pasted/dropped image assets to the vault

The electron-demo SHALL provide an `onAssetUpload` that writes an uploaded image `File` into the vault and returns a URL the editor can render; with no active vault it SHALL return `null`.

#### Scenario: Image file paste/drop is saved and rendered

- **WHEN** an image file is pasted or dropped into the demo editor with a vault open
- **THEN** the bytes SHALL be written under `<vault>/attachments/` and `onAssetUpload` SHALL return a URL that the demo renders as the image

#### Scenario: No vault open

- **WHEN** an image is uploaded with no active/writable vault
- **THEN** `onAssetUpload` SHALL return `null` and no file SHALL be written

#### Scenario: Oversized asset is rejected

- **WHEN** an uploaded asset exceeds the configured byte-size cap
- **THEN** the write SHALL be rejected (`onAssetUpload` returns `null`) and no file SHALL be written

### Requirement: Confine asset writes to the vault

Host asset writes SHALL be confined to the vault's `attachments/` directory and SHALL NOT derive the on-disk path or extension from any untrusted, renderer-supplied name; the main process owns name generation.

#### Scenario: Attacker-controlled filename cannot escape the vault

- **WHEN** the uploaded `File.name` contains path separators, `..`, a NUL, leading dots, or an absolute path (e.g. `../../escape.png`)
- **THEN** the stored file SHALL be written under `<vault>/attachments/` with a host-generated name, and the final resolved path SHALL be asserted (lexical `path.resolve`+`path.relative` prefix check, consistent with the existing vault guard) to stay inside the vault before any write

#### Scenario: Stored name is host-generated with a whitelisted extension

- **WHEN** an image is saved
- **THEN** the main process SHALL generate the filename (timestamp + crypto-strong random) with the extension derived from a whitelist keyed on the MIME passed over IPC (`image/png`/`image/jpeg`/`image/gif`/`image/webp`)
- **AND** a non-raster or non-whitelisted type (e.g. `image/svg+xml`, `text/html`) SHALL be rejected (no file written, `onAssetUpload` returns `null`)

### Requirement: Returned URL renders regardless of the note's directory

The URL returned by the demo `onAssetUpload` SHALL render correctly for a note located in any vault subdirectory, not only the vault root.

#### Scenario: Image renders for a note in a subdirectory

- **WHEN** the active note is in a subdirectory (e.g. `notes/foo.md`) and an image is uploaded
- **THEN** the returned URL (an absolute `nexus-vault://vault/attachments/<name>`) SHALL resolve to the actual saved file (`<vault>/attachments/<name>`) and render — not break as a vault-root-relative path resolved against the note's directory would

### Requirement: Core file-upload insertion is syntactically safe

Enabling `onAssetUpload` activates core's `insertUploadedAssets`; that emitter SHALL Markdown-escape the label (from the untrusted `file.name`) and structurally encode the URL — without scheme-restricting the URL, which is the host's own `onAssetUpload` return — so a crafted filename cannot inject Markdown, for both the image (`![label](url)`) and non-image (`[label](url)`) link forms.

#### Scenario: Crafted filename cannot inject a link

- **WHEN** an uploaded file has a name like `a](javascript:alert(1))[t](javascript:alert(1)).png`
- **THEN** the inserted Markdown SHALL contain no additional link/image and no `javascript:`-scheme destination — the label SHALL be Markdown-escaped (and the URL structurally encoded) before composing the `![label](url)` / `[label](url)` snippet

#### Scenario: Host custom-scheme upload URL survives insertion

- **WHEN** `onAssetUpload` returns a custom-scheme URL (e.g. `nexus-vault://vault/attachments/<name>`)
- **THEN** `insertUploadedAssets` SHALL keep that URL (structural-encode only, no scheme allowlist) so the image renders — it SHALL NOT drop the host's own return
