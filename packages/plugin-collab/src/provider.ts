import * as Y from "yjs";
import { type Awareness } from "y-protocols/awareness";

/**
 * Connects two Y.Doc instances in memory so that every change made
 * in one document is immediately applied to the other without conflicts.
 * Ideal for unit testing, offline testing, and multi-pane views.
 */
export function linkDocs(docA: Y.Doc, docB: Y.Doc): () => void {
  const onUpdateA = (update: Uint8Array, origin: any) => {
    if (origin !== docB) {
      Y.applyUpdate(docB, update, docA);
    }
  };
  const onUpdateB = (update: Uint8Array, origin: any) => {
    if (origin !== docA) {
      Y.applyUpdate(docA, update, docB);
    }
  };

  docA.on("update", onUpdateA);
  docB.on("update", onUpdateB);

  // Perform initial mutual sync
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), docA);
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), docB);

  return () => {
    docA.off("update", onUpdateA);
    docB.off("update", onUpdateB);
  };
}

/**
 * In-memory / BroadcastChannel local synchronization provider.
 * Broadcasts document updates across local windows/tabs sharing the same room.
 */
export class LocalBroadcastProvider {
  private channel: BroadcastChannel | null = null;
  private readonly onDocUpdate: (update: Uint8Array, origin: any) => void;

  constructor(
    readonly room: string,
    readonly doc: Y.Doc,
    readonly awareness?: Awareness
  ) {
    this.onDocUpdate = (update: Uint8Array, origin: any) => {
      if (origin !== this && this.channel) {
        this.channel.postMessage({ type: "update", update: Array.from(update) });
      }
    };

    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(`nexus-collab-${room}`);
      this.channel.onmessage = (event: MessageEvent) => {
        const data = event.data;
        if (data?.type === "update" && Array.isArray(data.update)) {
          Y.applyUpdate(this.doc, new Uint8Array(data.update), this);
        }
      };
      doc.on("update", this.onDocUpdate);
    }
  }

  destroy(): void {
    if (this.channel) {
      this.doc.off("update", this.onDocUpdate);
      this.channel.close();
      this.channel = null;
    }
  }
}
