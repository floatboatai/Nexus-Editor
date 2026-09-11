# @floatboat/nexus-plugin-collab

Provider-neutral, Yjs-first realtime collaboration for Nexus Editor. The plugin binds one editor to a `Y.Text`; the host owns transport, room lifecycle, authentication, persistence, encryption, and access control.

## Install

```bash
pnpm add @floatboat/nexus-plugin-collab yjs y-protocols
```

## Use

```ts
import { createEditor } from "@floatboat/nexus-core";
import {
  createCollaborationPlugin,
  seedCollaborationDocument,
} from "@floatboat/nexus-plugin-collab";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

const doc = new Y.Doc();
const awareness = new Awareness(doc);

// Only the room owner/bootstrap path should seed. Joining clients must not.
seedCollaborationDocument(doc, "# Shared note");

const editor = createEditor({
  container: document.querySelector("#editor")!,
  plugins: [
    createCollaborationPlugin({
      doc,
      awareness,
      user: { id: "user-42", name: "Ada", color: "#7c3aed" },
    }),
  ],
});

// Connect `doc` and optionally `awareness` with any Yjs-compatible provider.
// The provider is deliberately created outside this plugin.
```

The default shared type is `doc.getText("content")`. Pass `field` to use another name. Existing shared text is authoritative: after plugin startup, it replaces `initialValue` once and subsequent traffic is applied as incremental editor transactions.

## Provider contract

A provider needs only to exchange Yjs document updates. Presence is optional and uses a caller-supplied `Awareness` instance. WebSocket, WebRTC, IPC, test buses, offline persistence, or a custom backend can all be used without changing the editor plugin.

The plugin never receives a URL, token, room identifier, or provider instance. It therefore cannot authenticate users or enforce document permissions; those are host/provider responsibilities. Treat awareness names and colors as untrusted presentation data.

## Undo and presence

- `Mod-Z`, `Mod-Shift-Z`, and `Mod-Y` use a per-binding `Y.UndoManager` by default.
- Only edits created by this local editor are tracked. Remote-only edits are never removed by local undo.
- Set `historyKeymap: false` if the host installs its own collaboration history shortcuts.
- Presence is stored under the `nexusCollaboration` awareness field with user metadata and JSON-safe encoded Yjs relative positions.
- `Awareness` and `Y.Doc` are host-owned. Destroying the editor removes observers and local collaboration presence but does not destroy either object.

## Initialization rule

Do not have every peer insert its local `initialValue`: simultaneous insertion would duplicate content. Seed once before peers join, restore the shared `Y.Doc` from persistence, or let the provider deliver the room state. `seedCollaborationDocument` only writes when the selected `Y.Text` is empty and reports whether it seeded.
