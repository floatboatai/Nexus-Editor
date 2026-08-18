# @floatboat/nexus-plugin-autosave

Debounced auto-save for Nexus-Editor. Persist the editor's Markdown
source to your own store (localStorage, a backend, IndexedDB, …)
once edits settle, instead of re-implementing the `onChange` debounce
the core README warns about.

## Install

```bash
pnpm add @floatboat/nexus-plugin-autosave
```

## Usage

```ts
import { createEditor } from "@floatboat/nexus-core";
import {
  createAutoSavePlugin,
  attachAutoSavePlugin
} from "@floatboat/nexus-plugin-autosave";

const autosave = createAutoSavePlugin({
  // `delay` defaults to 1000ms; set to 0 to save on every change.
  delay: 800,
  onSave: (markdown) => {
    localStorage.setItem("draft", markdown);
  }
});

const editor = createEditor({
  container,
  initialValue: "# Hello",
  plugins: [autosave]
});
attachAutoSavePlugin(autosave, editor);

// Persist immediately (e.g. on `beforeunload`):
window.addEventListener("beforeunload", () => autosave.flush());
// Stop saving (e.g. on unmount):
autosave.destroy();
```

## API

`createAutoSavePlugin(options)` returns a value that is **both** a
Nexus plugin (pass it to `createEditor({ plugins })`) **and** a handle:

| Member | Description |
|---|---|
| `onSave(markdown)` | Required. Called with the latest source after the debounce window. A rejected promise is swallowed. |
| `delay?` | Quiet period in ms before `onSave` runs. Default `1000`. `0` saves on every change. |
| `flush()` | Force an immediate save of the current document and cancel the pending timer. |
| `destroy()` | Stop listening and cancel any pending save. |

## License

MIT
