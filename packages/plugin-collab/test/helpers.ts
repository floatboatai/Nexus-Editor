import { EditorView, ViewPlugin } from "@codemirror/view";
import * as Y from "yjs";

import { createCollaborativeEditor, type CollaborativeEditorConfig } from "../src/index";

export function mount(text: Y.Text, options: Partial<CollaborativeEditorConfig> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let view!: EditorView;
  const editor = createCollaborativeEditor({
    container,
    text,
    ...options,
    plugins: [
      ...(options.plugins ?? []),
      { name: "test-view", cmExtensions: [ViewPlugin.define((instance) => { view = instance; return {}; })] },
    ],
  });
  return { editor, view, container, destroy() { editor.destroy(); container.remove(); } };
}

/** Real Yjs replicas; the test controls when and in which order messages arrive. */
export class Network {
  readonly docs: Y.Doc[];
  readonly messages: { sender: number; update: Uint8Array }[] = [];
  private readonly origin = Symbol("test-network");

  constructor(count: number, initial = "") {
    this.docs = Array.from({ length: count }, () => new Y.Doc());
    this.docs[0].getText("markdown").insert(0, initial);
    const seed = Y.encodeStateAsUpdate(this.docs[0]);
    for (const doc of this.docs.slice(1)) Y.applyUpdate(doc, seed);
    this.docs.forEach((doc, sender) => doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== this.origin) this.messages.push({ sender, update });
    }));
  }

  text(index: number): Y.Text { return this.docs[index].getText("markdown"); }

  flush(reverse = false, duplicate = false): void {
    const messages = this.messages.splice(0);
    if (reverse) messages.reverse();
    for (const message of messages) {
      this.docs.forEach((doc, index) => {
        if (index === message.sender) return;
        Y.applyUpdate(doc, message.update, this.origin);
        if (duplicate) Y.applyUpdate(doc, message.update, this.origin);
      });
    }
  }

  reconnect(): void {
    for (const source of this.docs) {
      for (const target of this.docs) {
        if (source === target) continue;
        Y.applyUpdate(target, Y.encodeStateAsUpdate(source, Y.encodeStateVector(target)), this.origin);
      }
    }
    this.messages.length = 0;
  }

  destroy(): void { this.docs.forEach((doc) => doc.destroy()); }
}
