import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { createCollaborativeEditor } from "../src/index";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing example element: ${id}`);
  return found as T;
}

const docs = [new Y.Doc(), new Y.Doc()];
docs[0].getText("markdown").insert(0, "# Write together\n\nThis is **shared Markdown**.\n\n- Edit either pane\n- Try independent undo\n- Disconnect and merge offline work\n\n| Writer | Status |\n| --- | --- |\n| Alice | Ready |\n| Bob | Ready |\n");
Y.applyUpdate(docs[1], Y.encodeStateAsUpdate(docs[0]));
const awareness = docs.map((doc) => new Awareness(doc));
const transportOrigin = Symbol("example-transport");
let connected = true;
let disposed = false;

function updateStatus(): void {
  const equal = docs[0].getText("markdown").toString() === docs[1].getText("markdown").toString();
  element("status").textContent = `${connected ? "Connected" : "Offline"} · documents ${equal ? "agree" : "differ"}`;
}

docs.forEach((doc, index) => {
  const other = 1 - index;
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (connected && origin !== transportOrigin) Y.applyUpdate(docs[other], update, transportOrigin);
    updateStatus();
  });
  awareness[index].on("update", ({ added, updated, removed }: {
    added: number[]; updated: number[]; removed: number[];
  }, origin: unknown) => {
    if (!connected || origin === transportOrigin) return;
    applyAwarenessUpdate(
      awareness[other], encodeAwarenessUpdate(awareness[index], [...added, ...updated, ...removed]), transportOrigin,
    );
  });
});

const editors = ["alice", "bob"].map((name, index) => {
  awareness[index].setLocalStateField("user", {
    name: index === 0 ? "Alice" : "Bob", color: index === 0 ? "#4f46e5" : "#0f766e",
  });
  const editor = createCollaborativeEditor({
    container: element(name), text: docs[index].getText("markdown"), awareness: awareness[index],
    livePreview: true,
  });
  element(`${name}-undo`).addEventListener("click", () => editor.undo());
  element(`${name}-redo`).addEventListener("click", () => editor.redo());
  return editor;
});

element("connection").addEventListener("click", () => {
  connected = !connected;
  if (connected) {
    docs.forEach((source, index) => {
      const target = docs[1 - index];
      Y.applyUpdate(target, Y.encodeStateAsUpdate(source, Y.encodeStateVector(target)), transportOrigin);
      applyAwarenessUpdate(awareness[1 - index], encodeAwarenessUpdate(awareness[index], [source.clientID]), transportOrigin);
    });
  }
  element("connection").textContent = connected ? "Pause connection" : "Reconnect and merge";
  element("connection").setAttribute("aria-pressed", String(!connected));
  updateStatus();
});

function dispose(): void {
  if (disposed) return;
  disposed = true;
  editors.forEach((editor) => editor.destroy());
  awareness.forEach((state) => state.destroy());
  docs.forEach((doc) => doc.destroy());
}

window.addEventListener("pagehide", dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
