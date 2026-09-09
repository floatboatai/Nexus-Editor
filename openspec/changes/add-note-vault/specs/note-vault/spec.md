## ADDED Requirements

### Requirement: Vault Selection

The electron demo SHALL allow the user to designate a filesystem directory as the active "vault", which becomes the scope for file browsing and editing.

#### Scenario: User picks a folder as the vault
- **WHEN** the user clicks the "Vault" toolbar button and chooses a directory in the OS picker
- **THEN** the chosen absolute path becomes the active `vaultPath`
- **AND** the vault panel is populated with the tree of markdown files inside it
- **AND** the chosen path is persisted as the last vault

#### Scenario: User cancels the picker
- **WHEN** the user cancels the OS directory dialog
- **THEN** the current vault (if any) remains unchanged
- **AND** no persistence write occurs

### Requirement: Vault File Listing

The electron demo SHALL list only markdown-type files (`.md`, `.markdown`, `.txt`) from the vault, recursively, with hidden directories and common non-note folders excluded.

#### Scenario: Non-markdown files are hidden
- **WHEN** the vault contains `note.md`, `image.png`, and `data.json`
- **THEN** only `note.md` appears in the tree

#### Scenario: Hidden and non-note folders are skipped
- **WHEN** the vault contains `.git/`, `node_modules/`, and a regular folder `Daily/`
- **THEN** `.git/` and `node_modules/` are not traversed and do not appear in the tree
- **AND** `Daily/` is traversed normally

#### Scenario: Empty parent directories are pruned
- **WHEN** a subdirectory contains no markdown descendants at any depth
- **THEN** that subdirectory is not rendered in the tree

### Requirement: File Switching with Dirty Guard

The electron demo SHALL load the selected file into the editor when a tree node is activated, and SHALL warn before discarding unsaved changes.

#### Scenario: Clean switch
- **WHEN** the user clicks a file in the tree
- **AND** the current document is not dirty
- **THEN** the editor loads the clicked file's content
- **AND** the status line updates to show the new path
- **AND** the clicked node is marked active in the tree

#### Scenario: Dirty switch confirmed
- **WHEN** the user clicks a different file and the current document is dirty
- **AND** the user confirms the discard prompt
- **THEN** the editor loads the new file's content
- **AND** the previous unsaved changes are discarded

#### Scenario: Dirty switch cancelled
- **WHEN** the user clicks a different file and the current document is dirty
- **AND** the user declines the discard prompt
- **THEN** the editor state remains unchanged
- **AND** the active file in the tree stays the same

### Requirement: Create File and Folder

The electron demo SHALL allow the user to create new markdown files and folders inside the vault from the vault panel.

#### Scenario: New file with auto extension
- **WHEN** the user triggers "New file" with the name `ideas`
- **THEN** a file `ideas.md` is created in the target parent directory
- **AND** the tree refreshes to show the new node
- **AND** the new file is opened in the editor

#### Scenario: New file with name conflict
- **WHEN** the user creates a file whose resolved filename already exists
- **THEN** the name is suffixed `-1`, `-2`, ... until unique
- **AND** no existing file is overwritten

#### Scenario: New folder
- **WHEN** the user triggers "New folder" with the name `Drafts`
- **THEN** a directory `Drafts/` is created in the target parent directory
- **AND** the tree refreshes to show the folder

### Requirement: Rename

The electron demo SHALL allow renaming files and folders within the vault.

#### Scenario: Rename a file
- **WHEN** the user renames `note.md` to `meeting.md`
- **THEN** the file on disk is renamed
- **AND** the tree updates
- **AND** if the renamed file was the active file, the editor's tracked path updates accordingly

#### Scenario: Rename conflict rejected
- **WHEN** the user renames a node to a name that already exists in the same parent
- **THEN** the rename is rejected with an error surfaced in the status line
- **AND** the filesystem is not mutated

### Requirement: Delete to Trash

The electron demo SHALL send deleted vault items to the OS trash rather than hard-deleting them.

#### Scenario: Delete a file
- **WHEN** the user deletes `note.md` via the context menu
- **THEN** the file is moved to the OS trash via `shell.trashItem`
- **AND** the tree refreshes without the deleted node
- **AND** if the deleted file was active, the editor is reset to an empty untitled document

#### Scenario: Trash API failure
- **WHEN** `shell.trashItem` rejects
- **THEN** the error is surfaced in the status line
- **AND** the file is NOT hard-deleted as a silent fallback

### Requirement: Reveal in File Manager

The electron demo SHALL provide a localized vault context-menu action that asks the operating system file manager to reveal the selected file or folder without changing the active editor document.

#### Scenario: Reveal a vault file
- **WHEN** the user selects "Show in File Explorer" from a vault file's context menu
- **THEN** the host opens the file's containing folder and reveals the selected file
- **AND** the editor document and dirty state remain unchanged

#### Scenario: Reject a path outside the active vault
- **WHEN** a reveal request targets a path outside the authorized vault session
- **THEN** the host rejects the request
- **AND** the operating system file manager is not opened

### Requirement: External Change Watching

The electron demo SHALL watch the active vault directory and refresh the tree when files are added, renamed, or removed by external tools.

#### Scenario: External file added
- **WHEN** another process creates a new `.md` file inside the vault
- **THEN** within 300 ms the vault panel tree includes the new file

#### Scenario: Active file removed externally
- **WHEN** the currently active file is removed from disk by an external process
- **THEN** the status line shows a warning
- **AND** the editor content is preserved so the user can "Save As" to recover

### Requirement: Path Safety

All vault filesystem IPC handlers SHALL validate that every target path resolves to a location inside the active vault and SHALL reject any request whose resolved path escapes the vault root.

#### Scenario: Path-escape attempt rejected
- **WHEN** a handler receives a target path that resolves outside the vault (e.g. a `../../` traversal)
- **THEN** the handler throws an error
- **AND** no filesystem mutation or read occurs

### Requirement: Persistence and Auto-Restore

The electron demo SHALL persist the last opened vault path and restore it on the next launch.

#### Scenario: Auto-restore on launch
- **WHEN** the app starts and `vault.json` contains a still-existing `lastVault` path
- **THEN** that vault is opened automatically
- **AND** its tree is rendered without user action

#### Scenario: Persisted vault no longer exists
- **WHEN** the stored `lastVault` path no longer exists on disk
- **THEN** the app starts with no vault open
- **AND** the stale entry is cleared from `vault.json`

### Requirement: Backwards Compatibility

The existing single-file Open / Save / Save As toolbar actions SHALL continue to function when no vault is open and SHALL also function when a vault is open (operating on files inside or outside the vault).

#### Scenario: Open single file without a vault
- **WHEN** no vault is open
- **AND** the user clicks "Open" and picks a file
- **THEN** the file loads into the editor
- **AND** "Save" writes back to that file path
