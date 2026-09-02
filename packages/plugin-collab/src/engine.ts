import type {
  CoreEditorChange,
  CoreEditorUpdateContext,
  EditorAPI,
  EditorAuthoritativeSourceRegistration,
  EditorContributionRegistration,
  SelectionState,
} from "@floatboat/nexus-core";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import * as Y from "yjs";

import { createSchema, getSchema, validateSchema, type CollabSchema } from "./schema";
import {
  CollaborationError,
  type CollabDocumentRef,
  type CollaborationDiagnostic,
  type CollaborationDocumentListener,
  type CollaborationEngine,
  type CollaborationEngineOptions,
  type CollaborationListener,
  type CollaborationPersistence,
  type CollaborationReplicaPort,
  type CollaborativeDocumentHandle,
  type CollaborativeDocumentSnapshot,
  type DocumentId,
  type EditorBindingHandle,
  type LocalPresence,
  type PeerSnapshot,
  type ProviderLease,
  type ProviderState,
  type ReplicaStoreLease,
  type Unsubscribe,
} from "./types";

const RESTORE_ORIGIN = Object.freeze({ kind: "nexus-collab-restore" });
const PROVIDER_ORIGIN = Object.freeze({ kind: "nexus-collab-provider" });
const DEFAULT_COLOR = "#6d5dfc";
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9.,%\s]+\)|[a-z]{1,20})$/i;

function copyBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}

function safeText(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function safeColor(value: unknown): string {
  const color = safeText(value, 40);
  return SAFE_COLOR.test(color) ? color : DEFAULT_COLOR;
}

function safeAvatar(value: unknown): string | undefined {
  const raw = safeText(value, 512);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function refsCompatible(a: CollabDocumentRef, b: CollabDocumentRef): boolean {
  return a.id === b.id && a.hostIdentity === b.hostIdentity;
}

function minimalChange(before: string, after: string): CoreEditorChange | null {
  if (before === after) return null;
  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
  let beforeSuffix = before.length;
  let afterSuffix = after.length;
  while (
    beforeSuffix > prefix &&
    afterSuffix > prefix &&
    before.charCodeAt(beforeSuffix - 1) === after.charCodeAt(afterSuffix - 1)
  ) {
    beforeSuffix--;
    afterSuffix--;
  }
  return { from: prefix, to: beforeSuffix, insert: after.slice(prefix, afterSuffix) };
}

function selectionToRelative(schema: CollabSchema, selection: SelectionState): unknown {
  const range = selection.ranges[selection.mainIndex] ?? selection.ranges[0];
  if (!range) return undefined;
  return {
    anchor: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(schema.text, range.anchor)),
    head: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(schema.text, range.head)),
  };
}

interface StoredPresence {
  userId: string;
  name: string;
  color: string;
  avatarUrl?: string;
  selection?: unknown;
}

function sanitizePresence(value: LocalPresence, selection?: unknown): StoredPresence {
  const userId = safeText(value.userId, 128);
  const name = safeText(value.name, 80);
  if (!userId || !name) throw new TypeError("Presence userId and name are required");
  return {
    userId,
    name,
    color: safeColor(value.color),
    ...(safeAvatar(value.avatarUrl) ? { avatarUrl: safeAvatar(value.avatarUrl) } : {}),
    ...(selection ? { selection } : {}),
  };
}

class ReplicaPort implements CollaborationReplicaPort {
  constructor(
    private readonly doc: Y.Doc,
    private readonly awareness: Awareness,
  ) {}

  encodeStateVector(): Uint8Array {
    return Y.encodeStateVector(this.doc);
  }

  encodeStateAsUpdate(stateVector?: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc, stateVector);
  }

  applyUpdate(update: Uint8Array, origin: unknown = PROVIDER_ORIGIN): void {
    Y.applyUpdate(this.doc, update, origin);
  }

  onUpdate(listener: (update: Uint8Array, origin: unknown) => void): Unsubscribe {
    const wrapped = (update: Uint8Array, origin: unknown) => listener(copyBytes(update), origin);
    this.doc.on("update", wrapped);
    return () => this.doc.off("update", wrapped);
  }

  encodeAwarenessUpdate(clientIds = this.getAwarenessClientIds()): Uint8Array {
    return encodeAwarenessUpdate(this.awareness, [...clientIds]);
  }

  applyAwarenessUpdate(update: Uint8Array, origin: unknown = PROVIDER_ORIGIN): void {
    applyAwarenessUpdate(this.awareness, update, origin);
  }

  onAwarenessUpdate(listener: (update: Uint8Array, origin: unknown) => void): Unsubscribe {
    const wrapped = (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      const clients = [...changes.added, ...changes.updated, ...changes.removed];
      if (clients.length > 0) listener(encodeAwarenessUpdate(this.awareness, clients), origin);
    };
    this.awareness.on("update", wrapped);
    return () => this.awareness.off("update", wrapped);
  }

  getAwarenessClientIds(): readonly number[] {
    return [...this.awareness.getStates().keys()];
  }
}

interface ReplicaState {
  lifecycle: CollaborativeDocumentSnapshot["lifecycle"];
  transport: CollaborativeDocumentSnapshot["transport"];
  sync: CollaborativeDocumentSnapshot["sync"];
  persistence: CollaborationPersistence;
  consistency: CollaborativeDocumentSnapshot["consistency"];
  diagnostic?: CollaborationDiagnostic;
}

class CollaborativeReplica {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  readonly schema = getSchema(this.doc);
  readonly port = new ReplicaPort(this.doc, this.awareness);
  readonly bindings = new Set<EditorBinding>();
  readonly listeners = new Set<CollaborationDocumentListener>();
  readonly presences = new Map<string, StoredPresence>();
  provider: ProviderLease | null = null;
  store: ReplicaStoreLease | null = null;
  storeQueue: Promise<void> = Promise.resolve();
  closed = false;
  state: ReplicaState;
  private stopStoreObservation: Unsubscribe | null = null;
  private stopProviderState: Unsubscribe | null = null;
  private storeFailure: unknown = null;
  private readonly awarenessListener: () => void;

  constructor(
    readonly ref: CollabDocumentRef,
    private readonly engine: CollaborationEngineImpl,
    volatile: boolean,
  ) {
    this.state = {
      lifecycle: "opening",
      transport: "idle",
      sync: "restoring",
      persistence: volatile ? "volatile" : "loading",
      consistency: "catching-up",
    };
    this.awarenessListener = () => this.emit();
    this.awareness.on("change", this.awarenessListener);
  }

  snapshot(): CollaborativeDocumentSnapshot {
    return Object.freeze({
      id: this.ref.id,
      ...this.state,
      peers: Object.freeze(this.peerSnapshots()),
      bindings: this.bindings.size,
    });
  }

  emit(): void {
    const snapshot = this.snapshot();
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch (cause) {
        this.engine.report({
          code: "listener-failed",
          message: `Collaboration document listener failed for ${this.ref.id}`,
          documentId: this.ref.id,
          cause,
        });
      }
    }
    this.engine.emit(snapshot);
  }

  setState(patch: Partial<ReplicaState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  peerSnapshots(): PeerSnapshot[] {
    const peers: PeerSnapshot[] = [];
    for (const [clientId, state] of this.awareness.getStates()) {
      const entries = Array.isArray(state.nexusPresence) ? state.nexusPresence : [];
      for (const raw of entries.slice(0, 32)) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as Record<string, unknown>;
        const userId = safeText(entry.userId, 128);
        const name = safeText(entry.name, 80);
        if (!userId || !name) continue;
        let selection: PeerSnapshot["selection"];
        const relative = entry.selection as { anchor?: unknown; head?: unknown } | undefined;
        if (relative?.anchor && relative.head) {
          try {
            const anchor = Y.createAbsolutePositionFromRelativePosition(
              Y.createRelativePositionFromJSON(
                relative.anchor as Parameters<typeof Y.createRelativePositionFromJSON>[0],
              ),
              this.doc,
            );
            const head = Y.createAbsolutePositionFromRelativePosition(
              Y.createRelativePositionFromJSON(
                relative.head as Parameters<typeof Y.createRelativePositionFromJSON>[0],
              ),
              this.doc,
            );
            if (anchor?.type === this.schema.text && head?.type === this.schema.text) {
              selection = { anchor: anchor.index, head: head.index };
            }
          } catch {
            selection = undefined;
          }
        }
        const avatarUrl = safeAvatar(entry.avatarUrl);
        peers.push({
          clientId,
          userId,
          name,
          color: safeColor(entry.color),
          ...(avatarUrl ? { avatarUrl } : {}),
          ...(selection ? { selection } : {}),
        });
      }
    }
    return peers;
  }

  publishPresence(bindingId: string, presence: StoredPresence | null): void {
    if (presence) this.presences.set(bindingId, presence);
    else this.presences.delete(bindingId);
    if (this.presences.size === 0) {
      this.awareness.setLocalState(null);
    } else {
      this.awareness.setLocalStateField("nexusPresence", [...this.presences.values()]);
    }
  }

  async initialize(mode: "create" | "open", initialMarkdown?: string): Promise<void> {
    try {
      if (this.engine.storeMode === "durable") {
        try {
          const store = this.engine.options.store;
          if (!("open" in store)) throw new Error("Durable Store configuration is invalid");
          const lease = await store.open(this.ref.id);
          this.store = lease;
          const restored = await lease.load();
          for (const update of restored.updates) Y.applyUpdate(this.doc, update, RESTORE_ORIGIN);
          validateSchema(this.schema, this.ref);
          this.stopStoreObservation = this.port.onUpdate((update, origin) => {
            if (origin === RESTORE_ORIGIN || this.closed || !this.store) return;
            this.state = { ...this.state, persistence: "pending" };
            this.emit();
            this.storeQueue = this.storeQueue
              .then(() => this.store!.append(update))
              .then(() => {
                if (!this.closed && this.storeFailure === null) this.setState({ persistence: "clean" });
              })
              .catch((cause) => this.failStore(cause));
          });
        } catch (cause) {
          throw new CollaborationError("store-failed", `Could not restore ${this.ref.id}`, cause);
        }
      }

      validateSchema(this.schema, this.ref);
      try {
        this.provider = await this.engine.options.providers.prepare({ document: this.ref, replica: this.port });
        this.stopProviderState = this.provider.subscribe((state) => this.applyProviderState(state));
        this.applyProviderState(this.provider.getState());
        await this.provider.start();
        if (this.closed) {
          throw new CollaborationError("engine-closed", `Collaboration Engine closed while opening ${this.ref.id}`);
        }
        this.applyProviderState(this.provider.getState());
      } catch (cause) {
        if (cause instanceof CollaborationError) throw cause;
        throw new CollaborationError("provider-failed", `Provider could not synchronize ${this.ref.id}`, cause);
      }

      const status = validateSchema(this.schema, this.ref);
      if (mode === "create") {
        if (status === "created") {
          throw new CollaborationError(
            "document-already-exists",
            `Collaborative document ${this.ref.id} already exists`,
          );
        }
        createSchema(this.doc, this.schema, this.ref, initialMarkdown ?? "");
        await this.storeQueue;
        if (this.storeFailure !== null) {
          throw new CollaborationError("store-failed", `Could not persist ${this.ref.id}`, this.storeFailure);
        }
        if (this.store) await this.store.flush();
      } else if (status !== "created") {
        throw new CollaborationError(
          "document-not-found",
          `Collaborative document ${this.ref.id} was not found after initial synchronization`,
        );
      }
      this.setState({
        lifecycle: "open",
        sync: "synced",
        consistency: "healthy",
        persistence: this.engine.storeMode === "volatile" ? "volatile" : "clean",
      });
    } catch (cause) {
      const error = cause instanceof CollaborationError
        ? cause
        : new CollaborationError("provider-failed", `Could not open ${this.ref.id}`, cause);
      this.setState({
        lifecycle: "failed",
        sync: "failed",
        consistency: "quarantined",
        diagnostic: { code: error.code, message: error.message, documentId: this.ref.id, cause },
      });
      await this.close();
      throw error;
    }
  }

  private applyProviderState(provider: ProviderState): void {
    this.setState({
      transport: provider.transport,
      sync: provider.sync,
      ...(provider.diagnostic ? { diagnostic: provider.diagnostic } : {}),
    });
  }

  private failStore(cause: unknown): void {
    this.storeFailure ??= cause;
    const diagnostic = {
      code: "store-failed",
      message: `Replica Store failed for ${this.ref.id}`,
      documentId: this.ref.id,
      cause,
    } satisfies CollaborationDiagnostic;
    this.state = { ...this.state, persistence: "failed", diagnostic };
    this.engine.report(diagnostic);
    this.emit();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.state = { ...this.state, lifecycle: "closing" };
    for (const binding of [...this.bindings]) await binding.detach();
    this.presences.clear();
    this.awareness.setLocalState(null);
    this.stopProviderState?.();
    this.stopProviderState = null;
    await this.provider?.release();
    this.provider = null;
    this.stopStoreObservation?.();
    this.stopStoreObservation = null;
    await this.storeQueue.catch(() => undefined);
    await this.store?.flush().catch((cause) => this.failStore(cause));
    await this.store?.close().catch((cause) => this.failStore(cause));
    this.store = null;
    this.awareness.off("change", this.awarenessListener);
    removeAwarenessStates(this.awareness, [...this.awareness.getStates().keys()], this);
    this.awareness.destroy();
    this.doc.destroy();
    this.state = { ...this.state, lifecycle: "closed" };
  }
}

class EditorBinding implements EditorBindingHandle {
  readonly id: string;
  private state: "ready" | "quarantined" | "detached" = "ready";
  private readonly localOrigin: Readonly<{ kind: "nexus-editor-binding"; id: string }>;
  private readonly undoManager: Y.UndoManager;
  private source: EditorAuthoritativeSourceRegistration | null = null;
  private filter: EditorContributionRegistration | null = null;
  private listener: EditorContributionRegistration | null = null;
  private localPresence: LocalPresence | null = null;
  private presenceFrame: number | null = null;
  private textObserved = false;
  private readonly selectionListener: () => void;
  private readonly focusListener: () => void;
  private readonly blurListener: () => void;
  private readonly textObserver: (event: Y.YTextEvent) => void;

  get detached(): boolean {
    return this.state === "detached";
  }

  private constructor(
    id: string,
    private readonly replica: CollaborativeReplica,
    private readonly editor: EditorAPI,
    private readonly engine: CollaborationEngineImpl,
  ) {
    this.id = id;
    this.localOrigin = Object.freeze({ kind: "nexus-editor-binding", id });
    this.undoManager = new Y.UndoManager(replica.schema.text, {
      trackedOrigins: new Set([this.localOrigin]),
      captureTimeout: 500,
    });
    this.selectionListener = () => this.schedulePresence();
    this.focusListener = () => this.schedulePresence();
    this.blurListener = () => this.replica.publishPresence(this.id, null);
    this.textObserver = (event) => this.onTextChange(event);
  }

  static async attach(
    id: string,
    replica: CollaborativeReplica,
    editor: EditorAPI,
    engine: CollaborationEngineImpl,
    content: "replace-editor" | "require-match",
  ): Promise<EditorBinding> {
    if (engine.bindingFor(editor)) {
      throw new CollaborationError("binding-conflict", "Editor already has an active collaboration binding");
    }
    const sink = editor.getContributionSink();
    if (sink.isInteractionActive()) {
      throw new CollaborationError(
        "interaction-active",
        "Cannot attach collaboration during an active Editor interaction",
      );
    }
    const binding = new EditorBinding(id, replica, editor, engine);
    const markdown = replica.schema.text.toString();
    if (content === "require-match" && editor.getDocument() !== markdown) {
      binding.undoManager.destroy();
      throw new CollaborationError("content-mismatch", "Editor content does not match the collaborative document");
    }
    try {
      binding.filter = sink.registerTransactionFilter(binding.id, () => binding.state === "quarantined"
        ? { action: "reject", reason: "collaboration-quarantined" }
        : { action: "accept" }, { priority: 10_000 });
      binding.source = sink.registerAuthoritativeSource(binding.id, {
        undo: () => binding.runHistory("undo"),
        redo: () => binding.runHistory("redo"),
      });
      await binding.source.ready;
      if (content === "replace-editor" && editor.getDocument() !== markdown) {
        const change = minimalChange(editor.getDocument(), markdown);
        if (change) {
          const result = binding.source.dispatch({ changes: [change], origin: [binding.id, "attach"] });
          if (result.status !== "success") {
            throw new CollaborationError("projection-diverged", "Could not project collaborative content into Editor");
          }
        }
      }
      binding.listener = sink.registerUpdateListener(binding.id, (update) => binding.onEditorUpdate(update));
      replica.schema.text.observe(binding.textObserver);
      binding.textObserved = true;
      replica.bindings.add(binding);
      engine.rememberBinding(editor, binding);
      editor.on("selectionChange", binding.selectionListener);
      editor.on("focus", binding.focusListener);
      editor.on("blur", binding.blurListener);
      replica.emit();
      return binding;
    } catch (cause) {
      await binding.detach().catch(() => undefined);
      throw cause;
    }
  }

  getState(): "ready" | "quarantined" | "detached" {
    return this.state;
  }

  setPresence(presence: LocalPresence | null): void {
    if (this.detached) return;
    this.localPresence = presence;
    this.refreshPresence();
  }

  private refreshPresence(): void {
    if (!this.localPresence || this.detached) {
      this.replica.publishPresence(this.id, null);
      return;
    }
    const selection = selectionToRelative(this.replica.schema, this.editor.getSelections());
    this.replica.publishPresence(this.id, sanitizePresence(this.localPresence, selection));
  }

  private schedulePresence(): void {
    if (this.presenceFrame !== null || this.detached) return;
    this.presenceFrame = requestAnimationFrame(() => {
      this.presenceFrame = null;
      this.refreshPresence();
    });
  }

  private onEditorUpdate(update: CoreEditorUpdateContext): void {
    if (this.state !== "ready" || update.authority !== "proposal") return;
    const changes = [...update.changes].sort((a, b) => b.from - a.from || b.to - a.to);
    this.replica.doc.transact(() => {
      for (const change of changes) {
        if (change.to > change.from) this.replica.schema.text.delete(change.from, change.to - change.from);
        if (change.insert.length > 0) this.replica.schema.text.insert(change.from, change.insert.replace(/\r\n?/g, "\n"));
      }
    }, this.localOrigin);
    this.undoManager.stopCapturing();
    if (this.editor.getDocument() !== this.replica.schema.text.toString()) this.quarantine();
    this.refreshPresence();
  }

  private onTextChange(event: Y.YTextEvent): void {
    if (this.state !== "ready" || event.transaction.origin === this.localOrigin || !this.source) return;
    const next = this.replica.schema.text.toString();
    const change = minimalChange(this.editor.getDocument(), next);
    if (!change) return;
    const result = this.source.dispatch({
      changes: [change],
      origin: [this.id, "yjs"],
    });
    if (result.status !== "success" || this.editor.getDocument() !== next) this.quarantine();
    this.refreshPresence();
  }

  private runHistory(action: "undo" | "redo"): boolean {
    if (this.state !== "ready") return false;
    const stack = action === "undo" ? this.undoManager.undoStack : this.undoManager.redoStack;
    if (stack.length === 0) return false;
    this.undoManager[action]();
    return true;
  }

  private quarantine(): void {
    if (this.state !== "ready") return;
    this.state = "quarantined";
    this.replica.setState({
      consistency: "quarantined",
      diagnostic: {
        code: "projection-diverged",
        message: `Editor projection diverged for ${this.replica.ref.id}`,
        documentId: this.replica.ref.id,
      },
    });
  }

  async detach(): Promise<void> {
    if (this.detached) return;
    this.state = "detached";
    if (this.presenceFrame !== null) cancelAnimationFrame(this.presenceFrame);
    this.presenceFrame = null;
    this.replica.publishPresence(this.id, null);
    this.editor.off("selectionChange", this.selectionListener);
    this.editor.off("focus", this.focusListener);
    this.editor.off("blur", this.blurListener);
    if (this.textObserved) {
      this.replica.schema.text.unobserve(this.textObserver);
      this.textObserved = false;
    }
    await this.listener?.dispose();
    await this.filter?.dispose();
    await this.source?.dispose();
    this.listener = null;
    this.filter = null;
    this.source = null;
    this.undoManager.destroy();
    this.replica.bindings.delete(this);
    this.engine.forgetBinding(this.editor, this);
    this.replica.emit();
  }
}

interface RegistryEntry {
  readonly ref: CollabDocumentRef;
  readonly opening: Promise<CollaborativeReplica>;
  replica?: CollaborativeReplica;
  refs: number;
}

class DocumentHandle implements CollaborativeDocumentHandle {
  private isClosed = false;
  private readonly bindings = new Set<EditorBindingHandle>();

  constructor(
    private readonly engine: CollaborationEngineImpl,
    private readonly entry: RegistryEntry,
    private readonly replica: CollaborativeReplica,
  ) {}

  get id(): DocumentId {
    return this.replica.ref.id;
  }

  get closed(): boolean {
    return this.isClosed || this.replica.closed;
  }

  whenReady(): Promise<void> {
    return this.closed
      ? Promise.reject(new CollaborationError("handle-closed", "Collaborative document handle is closed"))
      : Promise.resolve();
  }

  getMarkdown(): string | undefined {
    return this.closed ? undefined : this.replica.schema.text.toString();
  }

  getState(): CollaborativeDocumentSnapshot {
    if (this.closed) throw new CollaborationError("handle-closed", "Collaborative document handle is closed");
    return this.replica.snapshot();
  }

  subscribe(listener: CollaborationDocumentListener): Unsubscribe {
    if (this.closed) throw new CollaborationError("handle-closed", "Collaborative document handle is closed");
    this.replica.listeners.add(listener);
    try {
      listener(this.replica.snapshot());
    } catch (cause) {
      this.engine.report({
        code: "listener-failed",
        message: `Collaboration document listener failed for ${this.id}`,
        documentId: this.id,
        cause,
      });
    }
    return () => this.replica.listeners.delete(listener);
  }

  async attach(
    editor: EditorAPI,
    options: { readonly content: "replace-editor" | "require-match" },
  ): Promise<EditorBindingHandle> {
    if (this.closed) throw new CollaborationError("handle-closed", "Collaborative document handle is closed");
    const binding = await EditorBinding.attach(
      this.engine.nextBindingId(this.id),
      this.replica,
      editor,
      this.engine,
      options.content,
    );
    this.bindings.add(binding);
    return binding;
  }

  async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    for (const binding of [...this.bindings]) await binding.detach();
    this.bindings.clear();
    await this.engine.release(this.entry, this.replica);
  }
}

class CollaborationEngineImpl implements CollaborationEngine {
  readonly entries = new Map<DocumentId, RegistryEntry>();
  readonly engineListeners = new Set<CollaborationListener>();
  readonly editorBindings = new WeakMap<EditorAPI, EditorBinding>();
  readonly storeMode: "volatile" | "durable";
  private closed = false;
  private bindingSequence = 0;

  constructor(readonly options: CollaborationEngineOptions) {
    if (!options.providers) throw new TypeError("A Collaboration Provider factory is required");
    if (!options.store) throw new TypeError("Store must be supplied, or explicitly set to volatile mode");
    this.storeMode = "mode" in options.store && options.store.mode === "volatile" ? "volatile" : "durable";
  }

  create(
    document: CollabDocumentRef,
    options: { readonly initialMarkdown: string },
  ): Promise<CollaborativeDocumentHandle> {
    return this.acquire(document, "create", options.initialMarkdown);
  }

  open(document: CollabDocumentRef): Promise<CollaborativeDocumentHandle> {
    return this.acquire(document, "open");
  }

  private async acquire(
    ref: CollabDocumentRef,
    mode: "create" | "open",
    initialMarkdown?: string,
  ): Promise<CollaborativeDocumentHandle> {
    if (this.closed) throw new CollaborationError("engine-closed", "Collaboration Engine is closed");
    let entry = this.entries.get(ref.id);
    if (entry) {
      if (!refsCompatible(entry.ref, ref)) {
        throw new CollaborationError("document-identity-mismatch", `Document identity changed for ${ref.id}`);
      }
      if (mode === "create") {
        throw new CollaborationError("document-already-exists", `Collaborative document ${ref.id} already exists`);
      }
    } else {
      const replica = new CollaborativeReplica(ref, this, this.storeMode === "volatile");
      const opening = replica.initialize(mode, initialMarkdown).then(() => replica);
      entry = { ref, opening, replica, refs: 0 };
      this.entries.set(ref.id, entry);
      opening.then(
        (ready) => { entry!.replica = ready; },
        () => { if (this.entries.get(ref.id) === entry) this.entries.delete(ref.id); },
      );
    }
    const replica = await entry.opening;
    if (this.closed) {
      await replica.close();
      throw new CollaborationError("engine-closed", "Collaboration Engine closed while opening a document");
    }
    entry.refs += 1;
    return new DocumentHandle(this, entry, replica);
  }

  getSnapshot(documentId: DocumentId): CollaborativeDocumentSnapshot | undefined {
    return this.entries.get(documentId)?.replica?.snapshot();
  }

  list(): readonly CollaborativeDocumentSnapshot[] {
    return [...this.entries.values()].flatMap((entry) => entry.replica ? [entry.replica.snapshot()] : []);
  }

  subscribe(listener: CollaborationListener): Unsubscribe {
    if (this.closed) throw new CollaborationError("engine-closed", "Collaboration Engine is closed");
    this.engineListeners.add(listener);
    return () => this.engineListeners.delete(listener);
  }

  emit(snapshot: CollaborativeDocumentSnapshot): void {
    for (const listener of [...this.engineListeners]) {
      try {
        listener(snapshot);
      } catch (cause) {
        this.report({
          code: "listener-failed",
          message: `Collaboration Engine listener failed for ${snapshot.id}`,
          documentId: snapshot.id,
          cause,
        });
      }
    }
  }

  report(diagnostic: CollaborationDiagnostic): void {
    try {
      this.options.diagnostics?.(diagnostic);
    } catch (cause) {
      console.error("[NexusCollaboration] Diagnostic listener failed", cause);
    }
  }

  nextBindingId(documentId: DocumentId): string {
    return `collab:${documentId}:binding:${++this.bindingSequence}`;
  }

  bindingFor(editor: EditorAPI): EditorBinding | undefined {
    return this.editorBindings.get(editor);
  }

  rememberBinding(editor: EditorAPI, binding: EditorBinding): void {
    this.editorBindings.set(editor, binding);
  }

  forgetBinding(editor: EditorAPI, binding: EditorBinding): void {
    if (this.editorBindings.get(editor) === binding) this.editorBindings.delete(editor);
  }

  async release(entry: RegistryEntry, replica: CollaborativeReplica): Promise<void> {
    if (entry.refs > 0) entry.refs -= 1;
    if (entry.refs !== 0 || this.entries.get(replica.ref.id) !== entry) return;
    this.entries.delete(replica.ref.id);
    await replica.close();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.all(entries.map(async (entry) => {
      try {
        await (entry.replica ?? await entry.opening).close();
      } catch {
        // Opening failures already publish their own diagnostics.
      }
    }));
    this.engineListeners.clear();
  }
}

export function createCollaborationEngine(options: CollaborationEngineOptions): CollaborationEngine {
  return new CollaborationEngineImpl(options);
}
