# Electron Demo Design

**Date:** 2026-04-15

**Scope:** `apps/electron-demo`

## Context

The repository now has a working headless editor engine in `@nexus/core`, framework bindings for React and Vue, and a small set of official plugins. What it does not yet have is a desktop-hosted runnable application that proves the core package works in an Electron environment with local file IO.

This design covers a first Electron demo that intentionally uses the lowest-level integration path: `@nexus/core` with plain DOM rendering. The purpose is to validate the engine in a desktop shell before adding higher-level renderer abstractions or richer desktop workflows.

## Goals

- Create a runnable Electron demo under `apps/electron-demo`
- Render `@nexus/core` directly in the renderer process without React or Vue
- Support opening a local Markdown file into the editor
- Support saving to the current file and saving to a new file path
- Show the current file path and whether the document is dirty

## Non-Goals

- No React or Vue usage in the demo renderer
- No multi-tab support
- No menu-bar command wiring beyond minimal window bootstrapping
- No image upload bridge or drag-and-drop file ingestion
- No unsaved-changes close confirmation in this phase
- No packaging/distribution workflow beyond local demo execution

## Architecture

The demo will live in `apps/electron-demo` and split into three clear layers:

1. `electron/main.ts`
Creates the BrowserWindow, manages lifecycle, and handles file open/save IPC requests.

2. `electron/preload.ts`
Exposes a narrow bridge into the renderer through `contextBridge`. The bridge only includes desktop-safe file APIs:
- `openFile()`
- `saveFile(path, content)`
- `saveFileAs(content)`

3. `src/renderer/*`
Uses plain DOM and `@nexus/core`. The renderer owns transient UI state such as:
- current file path
- current Markdown content
- dirty flag
- last error message

This keeps Node and filesystem access out of renderer code and avoids coupling the demo to the React/Vue bindings. The editor remains a plain core-engine consumer, which is the main point of the demo.

## Renderer Structure

The renderer should stay small and explicit:

- `src/renderer/app.ts`
  Bootstraps the window UI, creates the toolbar/status DOM, and mounts the editor.

- `src/renderer/editor-shell.ts`
  Owns the `createEditor()` lifecycle and translates editor callbacks into renderer state updates.

- `src/renderer/state.ts`
  Holds small mutable state for file path, current content, dirty status, and error text.

This separation keeps editor creation logic away from Electron bridge calls and makes it easier to later replace the plain DOM shell with a framework binding if needed.

## Data Flow

The demo data flow is intentionally one-way:

1. Electron launches the window and the renderer creates a core editor instance.
2. The renderer initializes the editor with in-memory content.
3. When the user clicks `Open`, the renderer calls `window.nexusDemo.openFile()`.
4. The main process shows a native open dialog, reads the selected file, and returns `{ path, content }`.
5. The renderer writes `content` into the editor, stores `path`, and resets dirty state to `false`.
6. While the user edits, `onChange(doc)` updates in-memory content and flips dirty state to `true`.
7. When the user clicks `Save`:
   - if `path` exists, call `saveFile(path, content)`
   - otherwise call `saveFileAs(content)`
8. On successful save, update `path` if needed and reset dirty state to `false`.

The editor remains the source of truth for document text, while the renderer state mirrors the latest document and file metadata.

## IPC Contract

The preload bridge should expose these signatures:

```ts
interface DemoFileHandle {
  path: string;
  content: string;
}

interface DemoBridge {
  openFile(): Promise<DemoFileHandle | null>;
  saveFile(path: string, content: string): Promise<{ path: string }>;
  saveFileAs(content: string): Promise<{ path: string } | null>;
}
```

Behavior rules:

- `openFile()` returns `null` when the user cancels
- `saveFileAs()` returns `null` when the user cancels
- `saveFile()` throws on failure rather than swallowing the error

This keeps the renderer logic simple and explicit.

## Error Handling

Error handling in this phase should be visible but minimal:

- Open failure: leave current editor content untouched and show an inline error
- Save failure: preserve dirty state and show an inline error
- Save As cancellation: do nothing, keep dirty state unchanged
- Open cancellation: do nothing, keep current state unchanged

No retry loop, no global toast system, and no modal error stack are needed for this demo.

## Security

The Electron window should use standard safe defaults:

- `contextIsolation: true`
- `nodeIntegration: false`
- filesystem access only through preload IPC

The renderer should never import `fs`, `path`, or Electron main-process APIs directly.

## UI Behavior

The UI should be intentionally minimal:

- top toolbar with `Open`, `Save`, and `Save As`
- small status line with current file path and dirty indicator
- editor fills the remaining viewport
- plain, functional styling only

The demo is for validating integration, not for proving a final product visual design.

## Testing Strategy

This phase should add automated coverage at two levels:

1. Renderer/unit tests
- toolbar state transitions
- dirty flag changes after edit
- open/save result handling

2. Electron bridge tests or isolated main/preload tests
- open returns file content
- save writes the provided content
- cancellation returns `null`

The demo does not require full Electron end-to-end window automation in this first phase if isolated tests cover the file bridge and renderer state logic.

## Acceptance Criteria

The phase is complete when all of the following are true:

1. `pnpm` can start an Electron window for `apps/electron-demo`
2. The renderer displays a working `@nexus/core` editor
3. Opening a local Markdown file loads it into the editor
4. Editing changes the dirty indicator to dirty
5. Saving writes back to the current file path
6. Saving without a current path uses `Save As`
7. Saving success resets dirty state
8. The renderer does not directly access Node APIs

## Risks and Trade-offs

- Using plain DOM means some UI code will later be replaced if the demo migrates to React/Vue.
  This is acceptable because the point of the demo is low-level engine validation, not reusable app UI.

- Skipping unsaved-close protection means the demo can lose edits on window close.
  This is acceptable in phase 1 because the current goal is filesystem integration, not full desktop ergonomics.

- Not using Electron Forge or Builder keeps setup lighter but delays packaging concerns.
  This is acceptable because local execution speed is more important than distribution in this phase.
