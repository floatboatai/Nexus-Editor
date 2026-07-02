# Change: Add OpenAI-Compatible AI Assistant Plugin

## Why

Nexus-Editor has a mature plugin surface for editing, search, slash commands, and document-aware utilities. AI-assisted editing is a natural next capability, but it should not hard-code provider credentials or let a model mutate documents without user review.

## What Changes

- Add `@floatboat/nexus-plugin-ai-assistant`.
- Provide an OpenAI-compatible Chat Completions provider using function tools.
- Add a bounded multi-round tool loop so the assistant can read, search, and inspect the current document before proposing edits.
- Expose editor tools for reading the document, reading the selection, searching text, setting selection, reading the table of contents, and proposing write operations.
- Keep write tools safe by creating pending operations that require user Apply / Discard.
- Add a vanilla-DOM AI assistant sidebar panel.
- Integrate the panel into the Electron demo with user-supplied API key, base URL, and model fields.
- Keep API keys in memory only; no default localStorage or disk persistence.

## Impact

- Affected specs: `plugins`
- Affected code:
  - `packages/plugin-ai-assistant/**`
  - workspace aliases and build script
  - `apps/electron-demo` integration
- No breaking changes.
- No new runtime dependency beyond `@floatboat/nexus-core`.
