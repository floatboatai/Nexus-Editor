# @floatboat/nexus-plugin-autosave

Local-first, debounced autosave for [Nexus-Editor](https://github.com/floatboatai/Nexus-Editor).

The plugin listens for document `change` events and, after a quiet period
of `delay` milliseconds, calls `onSave(doc)` with the latest Markdown text.
It tracks a clean / dirty state by comparing the live document to the last
persisted snapshot, so:

- redundant writes are skipped,
- `flush()` only saves when there is something to save,
- a slow or failing `onSave` never races the next edit or crashes the editor.

## Install

```bash
pnpm add @floatboat/nexus-core @floatboat/nexus-plugin-autosave
```

## Usage

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createAutosavePlugin, attachAutosavePlugin } from "@floatboat/nexus-plugin-autosave";

const autosave = createAutosavePlugin({
  // Save 800ms after the user stops typing (default is 800).
  delay: 800,
  // Persist however your host wants — File System API, Electron IPC,
  // a fetch to your backend, etc. May be async.
  onSave: (doc) => window.api.saveFile(doc)
});

const editor = createEditor({
  container: document.getElementById("editor")!,
  initialValue: "# Notes",
  plugins: [autosave]
});

// Nexus-Editor's NexusPlugin contract is declarative, so bind the plugin
// to the concrete editor instance after createEditor returns.
attachAutosavePlugin(autosave, editor);
```

### Explicit save / flush

```ts
// Persist pending changes right now (e.g. on blur or before unload).
const saved = await autosave.flush(); // true if a save ran, false if clean

// Drop a pending save without writing (document stays dirty).
autosave.cancel();

// Inspect state for a status indicator.
const { dirty, pending, saving } = autosave.getState();

// Tear down listeners and timers (the editor also calls this on destroy).
autosave.destroy();
```

## Options

| Option  | Type                          | Default | Description                                                                                       |
| ------- | ----------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `delay` | `number`                      | `800`   | Quiet period in ms before a save fires. Every edit resets the timer, so a fast typist triggers one save per pause. |
| `onSave`| `(doc: string) => void \| Promise<void>` | — | **Required.** Persist the document. A rejection leaves the document dirty; a later edit retries.  |

## API

The returned plugin is both a valid `NexusPlugin` (pass it to `createEditor({ plugins })`)
and a live handle:

- `attachEditor(editor)` — bind to an editor instance (idempotent). Prefer `attachAutosavePlugin`.
- `getState(): { dirty, pending, saving }` — current autosave state.
- `flush(): Promise<boolean>` — save pending changes now; resolves `true` if a save ran.
- `cancel()` — drop a pending save without persisting.
- `destroy()` — detach listeners and clear timers.

## How it works

Timing policy (debounce, flush, cancel) lives in a small pure scheduler
(`src/scheduler.ts`) with no dependency on the editor or DOM, which keeps it
unit-testable with fake timers. The plugin layer owns the autosave policy:
document snapshots, dirty tracking, and the `onSave` boundary.

## License

MIT © floatboat
