# @floatboat/nexus-plugin-collab

Collaborative Markdown editing with Yjs: concurrent offline edits, selective
undo/redo and optional remote cursors. The host owns networking, persistence,
authentication and room selection. No server or network provider is bundled.

## Quick start

```sh
pnpm add @floatboat/nexus-plugin-collab yjs y-protocols
```

```ts
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { createCollaborativeEditor } from "@floatboat/nexus-plugin-collab";

const doc = new Y.Doc();
const text = doc.getText("markdown");
const awareness = new Awareness(doc);
awareness.setLocalStateField("user", { name: "Alice", color: "#4f46e5" });

// Restore persisted Yjs state and connect your provider here. Seed new rooms
// ONCE at their authority, never independently on every joining client.
const editor = createCollaborativeEditor({
  container: document.querySelector<HTMLElement>("#editor")!,
  text,
  awareness,
  livePreview: true,
  onChange(markdown, ast) {
    console.log(markdown, ast);
  },
});

editor.replaceSelection("Hello");
editor.stopCapturing(); // Next edit starts a separate undo group.
editor.undo();          // Only this editor's edits are undone.
editor.redo();

// Detach editors before disposing host-owned resources.
editor.destroy();
awareness.destroy();
doc.destroy();
```

When using a provider with its own awareness instance, pass `provider.awareness`
instead of constructing another instance. Exchange Yjs binary updates, not
Markdown snapshots. A joining replica must restore the same persisted CRDT
history; equal plain-text strings independently inserted into two documents do
not have the same CRDT identity.

## API

`createCollaborativeEditor(config): CollaborativeEditorAPI` accepts the normal
`EditorConfig` except `initialValue`, plus:

| Option | Meaning |
| --- | --- |
| `text: Y.Text` | Required, attached to a live host-owned Y.Doc; plain text only. |
| `awareness?: Awareness` | Optional, from the same document. |
| `captureTimeout?: number` | Local undo grouping interval in milliseconds; default 500, zero disables grouping. |

The returned object is an `EditorAPI` with `stopCapturing()`. Public `undo()` and
`redo()`, Mod-Z / Mod-Shift-Z / Mod-Y, and native `beforeinput` history events all
use the same selective history. Each mounted editor has a unique origin, even
when several editors share a document. Host and peer edits are not tracked.
Selections are stored as CRDT relative positions and survive remote insertions.

## Integration contracts

- **Initialization:** the shared text is authoritative, including an empty room.
  There is no automatic seeding or fallback to local initial content.
- **History:** omit `createHistoryPlugin()` and CodeMirror's `history()` extension.
  Combining positional history with CRDT history throws before attaching resources.
- **Changes:** `onChange` fires for both local and remote edits. Use Yjs/provider
  events to persist binary state; do not feed the callback back into `setDocument`.
- **Replacement:** `setDocument()` deliberately replaces the shared document.
  It is not a way to switch rooms. Destroy the editor and create a new one for
  a different Y.Text. A silent replacement still replicates; `silent` only
  suppresses local change notifications.
- **Frameworks:** mount this factory in a React effect or Vue mounted hook and
  destroy it during cleanup. Do not combine it with a controlled Markdown
  `value` / `v-model` loop. Existing framework wrappers retain their original
  standalone editor factory.
- **Filtering:** local changes pass through normal CodeMirror and Nexus filters.
  Committed remote transactions carry `Transaction.remote` and origin
  `collaboration:remote`; they bypass veto/rewriting filters while still notifying
  change callbacks and transaction observers. Providers enforce authorization
  before applying updates. This annotation is not a security boundary.
- **Live preview:** ordinary preview remains available. Tables intentionally stay
  in Markdown source mode, so every edit is a CRDT transaction. The current cell
  widgets defer edits until blur and are not safe for concurrent remote changes.
  Custom editable widgets must likewise commit edits through document transactions.
- **Unicode:** the initial shared text must contain well-formed Unicode. Local
  edits that split surrogate pairs are normalized to U+FFFD within the same
  transaction, matching Yjs's encoding. CRLF characters are preserved as data.
  Providers and host-side mutations must supply plain text without embeds or
  rich-text attributes; custom transaction rewrites must preserve valid Unicode.
- **Presence:** uses the conventional awareness `user` and `cursor` fields.
  `user.name` is rendered as text (up to 100 characters); `user.color` accepts
  six-digit hex colors. The focused editor owns the local cursor. Destroying it
  clears only that cursor, retaining the host's other awareness fields.
- **Ownership:** destroy editors before destroying their document or awareness.
  The binding removes its listeners and UndoManager; it never destroys host-owned
  resources. Awareness timers and provider connections remain the host's job.

## Try two independent replicas

From the repository root:

```sh
pnpm build
pnpm --filter @floatboat/nexus-plugin-collab demo
```

The example connects two Y.Doc instances through an in-memory transport. Pause
the connection, edit both sides, then reconnect. State-vector synchronization
merges offline changes. Each pane has independent undo/redo. This is a transport
demonstration, not a production network provider.

## Validation

```sh
pnpm test -- packages/plugin-collab/test
pnpm --filter @floatboat/nexus-plugin-collab build
pnpm --filter @floatboat/nexus-plugin-collab check:api
pnpm --filter @floatboat/nexus-plugin-collab build:demo
```

Tests use real CRDT replicas and cover simultaneous edits, overlapping deletions,
state-vector reconnection, duplicate/reordered delivery, four-peer randomized
edit schedules, Unicode boundaries, undo isolation, relative selections, filters,
read-only receivers, table source mode, presence and repeated teardown.

Yjs and y-protocols are MIT-licensed peer dependencies. Keeping them external
avoids duplicate Yjs instances when the host already has a provider. The core
package does not import either dependency.
