## ADDED Requirements
### Requirement: AI Context Copy
The Electron demo SHALL let users copy an AI-ready context bundle for the active Markdown note without calling an external AI service.

#### Scenario: Copy active note context
- **WHEN** the user activates the AI context toolbar action
- **THEN** the clipboard receives a Markdown bundle containing the active note path, document stats, selected text when present, outline entries, linked mentions, unlinked mentions, and the current Markdown source

#### Scenario: Use vault-relative source labels
- **WHEN** the active note and mention sources are inside the current vault
- **THEN** the copied context uses vault-relative paths instead of absolute file paths
