import { createEditor, type EditorAPI } from "@floatboat/nexus-core";
import {
  createCollaborationPlugin,
  seedCollaborationDocument,
} from "@floatboat/nexus-plugin-collab";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import * as Y from "yjs";

type Bytes = number[];

declare global {
  interface Window {
    __nexusCollabSmoke?: {
      prepare(role: "primary" | "secondary", initialUpdate?: Bytes): Promise<Record<string, unknown>>;
      stateUpdate(): Bytes;
      drainDocumentUpdates(): Bytes[];
      applyDocumentUpdates(updates: Bytes[]): void;
      drainAwarenessUpdates(): Bytes[];
      applyAwarenessUpdates(updates: Bytes[]): void;
      edit(from: number, to: number, insert: string): void;
      select(anchor: number, head?: number): void;
      snapshot(): Record<string, unknown>;
      cleanup(): Record<string, unknown>;
    };
  }
}

const providerOrigin = Object.freeze({ provider: "electron-collab-smoke" });
let editor: EditorAPI | null = null;
let doc: Y.Doc | null = null;
let awareness: Awareness | null = null;
let documentUpdates: Bytes[] = [];
let awarenessUpdates: Bytes[] = [];

function requireDoc(): Y.Doc {
  if (!doc) throw new Error("Collaboration smoke document is not prepared");
  return doc;
}

function requireEditor(): EditorAPI {
  if (!editor) throw new Error("Collaboration smoke editor is not prepared");
  return editor;
}

function requireAwareness(): Awareness {
  if (!awareness) throw new Error("Collaboration smoke awareness is not prepared");
  return awareness;
}

function snapshot(): Record<string, unknown> {
  const currentEditor = requireEditor();
  const currentDoc = requireDoc();
  return {
    markdown: currentEditor.getDocument(),
    sharedMarkdown: currentDoc.getText("content").toString(),
    visibleText: document.querySelector(".cm-content")?.textContent ?? null,
    remoteCarets: document.querySelectorAll(".nexus-collab-caret").length,
    remoteSelections: document.querySelectorAll(".nexus-collab-selection").length,
    labels: Array.from(document.querySelectorAll(".nexus-collab-caret-label"), (node) => node.textContent),
  };
}

window.__nexusCollabSmoke = {
  async prepare(role, initialUpdate) {
    editor?.destroy();
    awareness?.destroy();
    document.body.replaceChildren();
    documentUpdates = [];
    awarenessUpdates = [];

    doc = new Y.Doc();
    if (initialUpdate) Y.applyUpdate(doc, Uint8Array.from(initialUpdate), providerOrigin);
    doc.on("update", (update, origin) => {
      if (origin !== providerOrigin) documentUpdates.push(Array.from(update));
    });
    if (!initialUpdate) seedCollaborationDocument(doc, "# Collaborative note\n\nShared");

    awareness = new Awareness(doc);
    awareness.on("update", ({ added, updated, removed }: {
      added: number[];
      updated: number[];
      removed: number[];
    }, origin: unknown) => {
      if (origin === providerOrigin) return;
      awarenessUpdates.push(Array.from(encodeAwarenessUpdate(
        requireAwareness(),
        [...added, ...updated, ...removed],
      )));
    });

    const mount = document.createElement("main");
    mount.dataset.collaborationRole = role;
    document.body.appendChild(mount);
    document.title = `Nexus collaboration ${role}`;
    editor = createEditor({
      container: mount,
      initialValue: "must be replaced by shared state",
      plugins: [createCollaborationPlugin({
        doc,
        awareness,
        captureTimeout: 0,
        user: role === "primary"
          ? { id: "alice", name: "Alice", color: "#2563eb" }
          : { id: "bob", name: "Bob", color: "#dc2626" },
      })],
    });
    await Promise.resolve();
    await Promise.resolve();
    return { role, ...snapshot() };
  },

  stateUpdate() {
    return Array.from(Y.encodeStateAsUpdate(requireDoc()));
  },

  drainDocumentUpdates() {
    return documentUpdates.splice(0);
  },

  applyDocumentUpdates(updates) {
    for (const update of updates) {
      Y.applyUpdate(requireDoc(), Uint8Array.from(update), providerOrigin);
    }
  },

  drainAwarenessUpdates() {
    return awarenessUpdates.splice(0);
  },

  applyAwarenessUpdates(updates) {
    for (const update of updates) {
      applyAwarenessUpdate(requireAwareness(), Uint8Array.from(update), providerOrigin);
    }
  },

  edit(from, to, insert) {
    requireEditor().replaceRange(from, to, insert);
  },

  select(anchor, head) {
    requireEditor().setSelection(anchor, head);
  },

  snapshot,

  cleanup() {
    editor?.destroy();
    editor = null;
    awareness?.destroy();
    awareness = null;
    doc?.destroy();
    doc = null;
    return {
      editorRemoved: document.querySelector(".cm-editor") === null,
      collaborationDomRemoved: document.querySelector(".nexus-collab-caret") === null,
    };
  },
};
