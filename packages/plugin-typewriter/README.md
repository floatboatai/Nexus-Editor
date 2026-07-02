# @floatboat/nexus-plugin-typewriter

Typewriter scrolling for [Nexus-Editor](https://github.com/floatboatai/Nexus-Editor): keeps the cursor line vertically centered while you type or move the caret (cf. iA Writer / Obsidian), so your eyes stay fixed mid-screen while the text moves.

## Usage

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createTypewriterPlugin } from "@floatboat/nexus-plugin-typewriter";

// Statically, like any plugin:
const editor = createEditor({
  container,
  plugins: [createTypewriterPlugin()],
});
```

### Runtime install / uninstall

The plugin declares only hot-pluggable hooks (`cmExtensions`), so it can be toggled on a **live** editor via the runtime plugin API — no editor recreation, document / undo history / selection all preserved:

```ts
editor.addPlugin(createTypewriterPlugin());   // centering active from the next keystroke
editor.removePlugin("plugin-typewriter");     // back to normal scrolling, zero residue
```

## How it works

A single `EditorState.transactionExtender` appends a center-scroll effect (`EditorView.scrollIntoView(head, { y: "center" })`) to every transaction that changes the document or selection. One transaction, no follow-up dispatch, no DOM listeners, no timers — which is also why uninstalling it leaves nothing behind.
