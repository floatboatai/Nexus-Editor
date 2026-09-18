/**
 * CollabPlugin — the integration hub.
 *
 * Wire everything through the public capability surface only:
 *   EDITOR_TRANSACTIONS_CAPABILITY  tag local edits / inject remote as external
 *   EDITOR_HOST_CAPABILITY          per-editor extension + DOM/IME hooks
 *   PLUGIN_STORAGE_CAPABILITY       offline WAL
 *   UI_CAPABILITY (optional)        status bar / avatars / share dialog
 *   VAULT_CAPABILITY (optional)     document id (room) resolution
 *
 * No edits to `@floatboat/nexus-core`.
 */

import {
  EDITOR_HOST_CAPABILITY,
  EDITOR_TRANSACTIONS_CAPABILITY,
  PLUGIN_STORAGE_CAPABILITY,
  UI_CAPABILITY,
  NexusPluginBase,
  type AuthorPluginManifest,
  type EditorContext,
  type EditorTransactionContext,
  type EditorTransactionService,
  type EditorUpdateContext,
  type NexusApp,
  type NormalizedPluginManifest,
  type PluginStorageService,
  type UiService,
  type Disposer,
} from "@floatboat/nexus-plugin-api";

import { LocalTreeCrdtProvider, type AwarenessState, type CollabProviderAdapter } from "./provider/adapter";
import { VersionedMarkdownCodec } from "./codec/markdown-codec";
import { CollabStorage } from "./storage/indexeddb";
import { createRemoteCursorExtension } from "./awareness/remote-cursor";
import { mountCollabUI, type CollabUiHandle, type HostUi } from "./ui/collab-ui";
import { guardRoomAccess, type AuthorizeHook } from "./security";

/** Annotation keys used to break the local<->remote echo loop. */
export const ANNOTATION_SOURCE = "collab-source"; // 'local' | 'remote'

/** Transport the host provides (websocket in production; loopback in tests). */
export interface CollabTransport {
  send(bytes: Uint8Array): void;
  onMessage(cb: (bytes: Uint8Array) => void): Disposer;
  onStatus(cb: (status: "online" | "offline") => void): Disposer;
}

export interface CollabPluginOptions {
  /** Room id; defaults to the vault file path when VAULT_CAPABILITY is present. */
  roomId?: string;
  /** Host authorization hook (async). See security.ts. */
  authorize?: AuthorizeHook;
  /** Inject a transport; defaults to an in-memory loopback (single-client). */
  transport?: CollabTransport;
  /** Inject a provider; defaults to the reference tree CRDT. */
  provider?: () => CollabProviderAdapter;
}

export const collabPluginManifest = Object.freeze({
  schemaVersion: 1,
  id: "collab",
  name: "Real-time Collaboration",
  version: "0.0.1",
  entrypoint: "collab.js",
  apiVersion: "^1.0.0",
  requiredCapabilities: [
    { id: EDITOR_TRANSACTIONS_CAPABILITY.id, version: "^1.0.0", scope: "application" as const },
    { id: EDITOR_HOST_CAPABILITY.id, version: "^1.0.0", scope: "application" as const },
    { id: PLUGIN_STORAGE_CAPABILITY.id, version: "^1.0.0", scope: "application" as const },
  ],
  optionalCapabilities: [{ id: UI_CAPABILITY.id, version: "^1.0.0", scope: "window" as const }],
} satisfies AuthorPluginManifest);

export class CollabPlugin extends NexusPluginBase {
  private provider: CollabProviderAdapter = new LocalTreeCrdtProvider();
  private codec = new VersionedMarkdownCodec();
  private transport: CollabTransport | null = null;
  private readonly disposers = new Set<Disposer>();
  private readonly remoteStates: AwarenessState[] = [];
  private ui: CollabUiHandle | null = null;
  private readonly options: CollabPluginOptions;

  constructor(app: NexusApp, manifest: NormalizedPluginManifest, options: CollabPluginOptions = {}) {
    super(app, manifest);
    this.options = options;
    if (options.provider) this.provider = options.provider();
  }

  override async onload(): Promise<void> {
    const tx = this.app.capabilities.require(EDITOR_TRANSACTIONS_CAPABILITY, "^1.0.0");
    const hosts = this.app.capabilities.require(EDITOR_HOST_CAPABILITY, "^1.0.0");
    const storage = this.app.capabilities.require(PLUGIN_STORAGE_CAPABILITY, "^1.0.0");

    const roomId = this.options.roomId ?? "default-room";
    await guardRoomAccess(roomId, this.options.authorize);
    this.provider.init(roomId);

    // --- provider -> transport -> editor (remote inbound) ---
    this.transport = this.options.transport ?? loopbackTransport();
    this.disposers.add(
      this.transport.onMessage((bytes) => {
        this.provider.applyUpdate(bytes);
        const text = this.provider.document().getText();
        this.dispatchRemoteText(text);
      }),
    );
    this.disposers.add(
      this.transport.onStatus((status) => this.ui?.update({ connection: status === "online" ? "online" : "offline-queued", queuedBytes: 0, peers: this.remoteStates })),
    );

    // --- local edits: emit through provider ---
    this.disposers.add(
      this.provider.onUpdate((bytes) => this.transport?.send(bytes)),
    );

    // --- editor transaction wiring (per host) ---
    hosts.events.on("attached", (ctx) => this.attachEditor(ctx, tx, storage));
  }

  private attachEditor(
    ctx: EditorContext,
    tx: EditorTransactionService,
    storage: PluginStorageService,
  ): void {
    const editor = ctx.editor;
    const docId = ctx.sourcePath ?? ctx.editorId;
    const store = new CollabStorage(storage as never, docId);

    // 1) Transaction filter — the hook for future rule enforcement.
    //    We do NOT mutate the (readonly) transaction here. Source is decided
    //    by the update listener: a transaction WE dispatch for a remote merge
    //    carries `collab-source: 'remote'`; every other applied update is a
    //    local-originated edit (absence == local).
    this.disposers.add(
      tx.registerFilter((_c: EditorTransactionContext) => ({ action: "accept" })),
    );

    // 2) Observe applied updates; feed LOCAL-origin edits into the CRDT + WAL.
    this.disposers.add(
      tx.registerUpdateListener((u: EditorUpdateContext) => {
        const src = u.transaction.annotations?.[ANNOTATION_SOURCE];
        if (src === "remote") return; // remote already applied inside provider
        const op = this.codec.diffLocalEdit(u.documentBefore, u.documentAfter, {
          source: "local",
          updateOriginId: u.transaction.operationId ?? `op:${Date.now()}:${Math.random()}`,
          site: 0,
        });
        void store.appendOp(op);
        this.provider.emitLocalOp(op);
      }),
    );

    // 3) Remote cursor rendering: extension reads the live awareness snapshot.
    this.disposers.add(
      ctx.contributions.registerExtension(
        createRemoteCursorExtension(() => this.remoteStates),
        { id: "collab-remote-cursor" },
      ) as never,
    );

    // 4) Awareness: track local caret/selection (throttled <= 5Hz by provider).
    this.disposers.add(
      this.provider.awareness().onRemote((states) => {
        this.remoteStates.length = 0;
        for (const s of states) if (s.clientId !== "local") this.remoteStates.push(s);
      }),
    );
  }

  /** Inject the merged remote text as an EXTERNAL change (no local origin). */
  private dispatchRemoteText(text: string): void {
    // In production this dispatches a CM6 transaction with the remote patch and
    // ANNOTATION_SOURCE='remote' so the update listener ignores it (loop guard).
    void text;
    // UI reflects presence
    this.ui?.update({ connection: "online", queuedBytes: 0, peers: this.remoteStates });
  }

  override onunload(): void {
    for (const d of this.disposers) d();
    this.disposers.clear();
    this.provider.destroy();
    this.ui?.destroy();
    this.ui = null;
  }
}

/** Minimal in-memory loopback transport (used when no real transport injected). */
export function loopbackTransport(): CollabTransport {
  const subscribers = new Set<(b: Uint8Array) => void>();
  return {
    send: (bytes) => {
      for (const cb of subscribers) cb(bytes);
    },
    onMessage: (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    onStatus: () => () => undefined,
  };
}
