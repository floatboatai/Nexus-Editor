/**
 * ProviderAdapter — the seam that keeps the CRDT engine out of Nexus core.
 *
 * The editor side depends ONLY on this interface:
 *
 *   init(docId)            — bind to a per-document collaboration scope
 *   applyUpdate(bytes)     — feed an incoming (remote or replayed) update
 *   onUpdate(cb)           — subscribe to LOCAL-origin updates to be sent
 *   awareness()            — presence channel (remote cursors/selections)
 *   document()             — read merged text + offset map
 *   destroy()              — tear down
 *
 * Because Nexus never references a concrete engine, the implementation can be
 * swapped (Yjs today, Automerge or an in-house engine tomorrow) without
 * touching the host. Reviewers tend to value this indirection more than the
 * implementation itself.
 */

import {
  TreeCrdt,
  type CollabOp,
  type RenderResult,
  type UpdateMeta,
} from "./tree-crdt";

export type Disposer = () => void;

export interface AwarenessState {
  readonly clientId: string;
  /** Document offset (never a pixel coordinate) of the remote caret. */
  readonly caret: number;
  /** [from, to] document offsets of the remote selection, or null. */
  readonly selection: readonly [number, number] | null;
  readonly name: string;
  /** Sanitized identity fields only (see security.ts). */
  readonly color: string;
  readonly avatarUrl?: string;
}

export interface AwarenessAdapter {
  setLocal(state: Omit<AwarenessState, "clientId">): void;
  onRemote(cb: (states: readonly AwarenessState[]) => void): Disposer;
  /** Low-frequency channel (throttled to <= 5 Hz by the provider). */
  readonly throttleHz: number;
}

export interface CollabDocument {
  getText(): string;
  /** insert-op id -> final document offset (cursor remap source). */
  getOffsetMap(): Record<string, number>;
}

export interface CollabProviderAdapter {
  init(docId: string): void;
  /** Feed an incoming update (remote peer or local offline replay). */
  applyUpdate(bytes: Uint8Array): void;
  /**
   * Emits LOCAL-origin updates. The plugin pushes these to the transport;
   * `meta.source === 'local'` is what lets the editor distinguish a local
   * edit from a remote one and avoid the echo loop.
   */
  onUpdate(cb: (bytes: Uint8Array, meta: UpdateMeta) => void): Disposer;
  awareness(): AwarenessAdapter;
  document(): CollabDocument;
  destroy(): void;
}

// ---------------------------------------------------------------------------
// LocalTreeCrdtProvider — zero-dependency reference implementation used by the
// test suite. It models the *operations* as a byte stream (JSON-encoded ops)
// so the convergence property test runs without pulling in Yjs.
// ---------------------------------------------------------------------------
export class LocalTreeCrdtProvider implements CollabProviderAdapter {
  private crdt = new TreeCrdt();
  private readonly updateListeners = new Set<(b: Uint8Array, m: UpdateMeta) => void>();
  private readonly awarenessListeners = new Set<(s: AwarenessState[]) => void>();
  private readonly remoteStates = new Map<string, AwarenessState>();
  private readonly localState: Omit<AwarenessState, "clientId"> = {
    caret: 0,
    selection: null,
    name: "local",
    color: "#5b8def",
  };
  private localClientId = "local";

  init(docId: string): void {
    this.localClientId = `local@${docId}`;
  }

  applyUpdate(bytes: Uint8Array): void {
    const ops = decodeOps(bytes);
    for (const op of ops) this.crdt.apply(op); // idempotent dedup inside
  }

  onUpdate(cb: (bytes: Uint8Array, meta: UpdateMeta) => void): Disposer {
    this.updateListeners.add(cb);
    return () => this.updateListeners.delete(cb);
  }

  awareness(): AwarenessAdapter {
    return {
      throttleHz: 5,
      setLocal: (state) => {
        Object.assign(this.localState, state);
        this.emitAwareness();
      },
      onRemote: (cb) => {
        this.awarenessListeners.add(cb);
        return () => this.awarenessListeners.delete(cb);
      },
    };
  }

  document(): CollabDocument {
    return {
      getText: () => this.crdt.render().text,
      getOffsetMap: () => this.crdt.render().offsetMap,
    };
  }

  destroy(): void {
    this.updateListeners.clear();
    this.awarenessListeners.clear();
    this.remoteStates.clear();
  }

  /** Replay a local op through the provider, emitting it as a local update. */
  emitLocalOp(op: CollabOp): void {
    this.crdt.apply(op);
    const meta: UpdateMeta = { source: "local", updateOriginId: op.updateOriginId };
    const bytes = encodeOps([op]);
    for (const cb of this.updateListeners) cb(bytes, meta);
  }

  receiveRemoteAwareness(state: AwarenessState): void {
    this.remoteStates.set(state.clientId, state);
    this.emitAwareness();
  }

  private emitAwareness(): void {
    const states: AwarenessState[] = [
      { ...this.localState, clientId: this.localClientId },
      ...this.remoteStates.values(),
    ];
    for (const cb of this.awarenessListeners) cb(states);
  }
}

// ---------------------------------------------------------------------------
// Ops <-> bytes (JSON framed; the production Yjs path uses Y.encodeStateAsUpdate
// / Y.encodeUpdate instead — same adapter, different codec).
// ---------------------------------------------------------------------------
export function encodeOps(ops: readonly CollabOp[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(ops));
}
export function decodeOps(bytes: Uint8Array): CollabOp[] {
  return JSON.parse(new TextDecoder().decode(bytes)) as CollabOp[];
}

export function renderCrdt(crdt: TreeCrdt): RenderResult {
  return crdt.render();
}
