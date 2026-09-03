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
  type CollaborationOpenOptions,
  type CollaborationPersistence,
  type CollaborationReplicaPort,
  type CollaborativeDocumentHandle,
  type CollaborativeDocumentSnapshot,
  type DocumentId,
  type EditorBindingAccess,
  type EditorBindingHandle,
  type LocalPresence,
  type PeerSnapshot,
  type ProviderLease,
  type ProviderState,
  type ReplicaStoreCheckpoint,
  type ReplicaStoreLease,
  type Unsubscribe,
} from "./types";
import type {
  CollaborativeMarkdownSnapshot,
  FileProjectionReplacementOrigin,
} from "./file-projection";

const RESTORE_ORIGIN = Object.freeze({ kind: "nexus-collab-restore" });
const PROVIDER_ORIGIN = Object.freeze({ kind: "nexus-collab-provider" });
const DEFAULT_STORE_COMPACTION_THRESHOLD = 256;
const DEFAULT_MAX_PENDING_STORE_OPERATIONS = 256;
const DEFAULT_MAX_PENDING_STORE_BYTES = 16 * 1024 * 1024;
const MAX_MARKDOWN_CODE_UNITS = 64 * 1024 * 1024;
const DEFAULT_COLOR = "#6d5dfc";
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9.,%\s]+\)|[a-z]{1,20})$/i;

function copyBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}

async function captureCleanupFailure(
  failures: unknown[],
  cleanup: () => void | Promise<void>,
): Promise<void> {
  try {
    await cleanup();
  } catch (cause) {
    failures.push(cause);
  }
}

function throwCleanupFailures(failures: readonly unknown[], message: string): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message);
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
  authentication: CollaborativeDocumentSnapshot["authentication"];
  access: CollaborativeDocumentSnapshot["access"];
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
  readonly markdownListeners = new Set<(snapshot: CollaborativeMarkdownSnapshot) => void>();
  readonly presences = new Map<string, StoredPresence>();
  provider: ProviderLease | null = null;
  providerStart: Promise<void> | null = null;
  store: ReplicaStoreLease | null = null;
  storeQueue: Promise<void> = Promise.resolve();
  closed = false;
  state: ReplicaState;
  private stopStoreObservation: Unsubscribe | null = null;
  private stopProviderState: Unsubscribe | null = null;
  private storeFailure: unknown = null;
  private closePromise: Promise<void> | null = null;
  private persistenceReconcilePromise: Promise<void> | null = null;
  private pendingStoreOperations = 0;
  private pendingStoreBytes = 0;
  private storeUpdateVersion = 0;
  private storeBackpressured = false;
  private durableUpdatesSinceSnapshot = 0;
  private hasLocalAuthority = false;
  private remoteAuthorityProven = false;
  private readonly awarenessListener: () => void;
  private readonly markdownListener: () => void;

  constructor(
    readonly ref: CollabDocumentRef,
    private readonly engine: CollaborationEngineImpl,
    volatile: boolean,
  ) {
    this.state = {
      lifecycle: "opening",
      transport: "idle",
      sync: "restoring",
      authentication: "not-required",
      access: "none",
      persistence: volatile ? "volatile" : "loading",
      consistency: "catching-up",
    };
    this.awarenessListener = () => this.emit();
    this.markdownListener = () => this.emitMarkdown();
    this.awareness.on("change", this.awarenessListener);
    this.schema.text.observe(this.markdownListener);
  }

  markdownSnapshot(): CollaborativeMarkdownSnapshot {
    const stateVector = Y.encodeStateVector(this.doc);
    let revision = "";
    for (const byte of stateVector) revision += byte.toString(16).padStart(2, "0");
    return Object.freeze({ markdown: this.schema.text.toString(), revision });
  }

  replaceMarkdown(
    markdown: string,
    options: { readonly origin: FileProjectionReplacementOrigin; readonly expectedRevision: string },
  ): CollaborativeMarkdownSnapshot {
    if (this.closed) throw new CollaborationError("handle-closed", "Collaborative document handle is closed");
    if (this.state.access !== "read-write" && this.state.access !== "local-only") {
      throw new CollaborationError("read-only", `Collaborative document ${this.ref.id} is not writable`);
    }
    if (typeof markdown !== "string" || markdown.length > MAX_MARKDOWN_CODE_UNITS) {
      throw new TypeError(`Markdown must not exceed ${MAX_MARKDOWN_CODE_UNITS} UTF-16 code units`);
    }
    const current = this.markdownSnapshot();
    if (current.revision !== options.expectedRevision) {
      throw new CollaborationError(
        "projection-revision-conflict",
        `Collaborative document ${this.ref.id} changed before File Projection replacement`,
      );
    }
    const normalized = markdown.replace(/\r\n?/gu, "\n");
    if (normalized === current.markdown) return current;
    this.doc.transact(() => {
      if (this.schema.text.length > 0) this.schema.text.delete(0, this.schema.text.length);
      if (normalized.length > 0) this.schema.text.insert(0, normalized);
    }, Object.freeze({ kind: "nexus-file-projection", origin: options.origin }));
    return this.markdownSnapshot();
  }

  emitMarkdown(): void {
    if (this.closed) return;
    const snapshot = this.markdownSnapshot();
    for (const listener of [...this.markdownListeners]) {
      try {
        listener(snapshot);
      } catch (cause) {
        this.engine.report({
          code: "listener-failed",
          message: `Collaboration Markdown listener failed for ${this.ref.id}`,
          documentId: this.ref.id,
          cause,
        });
      }
    }
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
      if (clientId === this.awareness.clientID) continue;
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
    if (this.state.access === "none") {
      this.presences.delete(bindingId);
      this.awareness.setLocalState(null);
      return;
    }
    if (presence) this.presences.set(bindingId, presence);
    else this.presences.delete(bindingId);
    if (this.presences.size === 0) {
      this.awareness.setLocalState(null);
    } else {
      const nexusPresence = [...this.presences.values()];
      if (this.awareness.getLocalState() === null) {
        this.awareness.setLocalState({ nexusPresence });
      } else {
        this.awareness.setLocalStateField("nexusPresence", nexusPresence);
      }
    }
  }

  private installStoreObservation(): void {
    if (this.stopStoreObservation || !this.store) return;
    this.stopStoreObservation = this.port.onUpdate((update, origin) => {
      if (origin === RESTORE_ORIGIN || this.closed || !this.store) return;
      this.storeUpdateVersion += 1;
      if (this.storeBackpressured || this.storeFailure !== null) {
        this.storeBackpressured = true;
        return;
      }
      if (
        this.pendingStoreOperations >= this.engine.maxPendingStoreOperations
        || update.byteLength > this.engine.maxPendingStoreBytes - this.pendingStoreBytes
      ) {
        this.storeBackpressured = true;
        this.failStore(Object.assign(
          new Error(`Replica Store backlog exceeded its configured limit for ${this.ref.id}`),
          { code: "store-backpressure" },
        ));
        return;
      }
      this.pendingStoreOperations += 1;
      this.pendingStoreBytes += update.byteLength;
      this.state = { ...this.state, persistence: "pending" };
      this.emit();
      this.storeQueue = this.storeQueue
        .then(async () => {
          await this.store!.append(update);
          this.durableUpdatesSinceSnapshot += 1;
          if (this.durableUpdatesSinceSnapshot < this.engine.storeCompactionThreshold) return;
          const restored = await this.store!.load();
          for (const durableUpdate of restored.updates) {
            Y.applyUpdate(this.doc, durableUpdate, RESTORE_ORIGIN);
          }
          const snapshot = this.port.encodeStateAsUpdate();
          await this.store!.replaceWithSnapshot(snapshot, { through: restored.checkpoint });
          this.durableUpdatesSinceSnapshot = 0;
        })
        .then(
          () => {
            this.pendingStoreOperations -= 1;
            this.pendingStoreBytes -= update.byteLength;
            this.markStoreCleanWhenSettled();
          },
          (cause) => {
            this.pendingStoreOperations -= 1;
            this.pendingStoreBytes -= update.byteLength;
            this.failStore(cause);
          },
        );
    });
  }

  private async resetStoreToRemoteAuthority(
    checkpoint: ReplicaStoreCheckpoint,
    flush = true,
  ): Promise<void> {
    const store = this.store;
    if (!store) return;

    let resolveSnapshot!: (snapshot: Uint8Array) => void;
    let rejectSnapshot!: (cause: unknown) => void;
    const snapshotReady = new Promise<Uint8Array>((resolve, reject) => {
      resolveSnapshot = resolve;
      rejectSnapshot = reject;
    });
    this.pendingStoreOperations += 1;
    this.state = { ...this.state, persistence: "pending" };
    this.emit();
    const reset = this.storeQueue.then(async () => {
      const snapshot = await snapshotReady;
      await store.replaceWithSnapshot(snapshot, { through: checkpoint });
      if (flush) await store.flush();
    });
    this.storeQueue = reset.then(
      () => {
        this.pendingStoreOperations -= 1;
        this.durableUpdatesSinceSnapshot = 0;
        this.markStoreCleanWhenSettled();
      },
      (cause) => {
        this.pendingStoreOperations -= 1;
        this.failStore(cause);
      },
    );

    // The reset is already the head of the Store queue before observation starts.
    // Any newer remote update is therefore appended after the authoritative snapshot.
    try {
      this.installStoreObservation();
      resolveSnapshot(this.port.encodeStateAsUpdate());
    } catch (cause) {
      rejectSnapshot(cause);
    }

    try {
      await reset;
    } catch (cause) {
      throw new CollaborationError(
        "store-failed",
        `Could not replace the cached Replica for ${this.ref.id} with remote authority`,
        cause,
      );
    }
  }

  async initialize(
    mode: "create" | "open",
    initialMarkdown?: string,
    readiness: NonNullable<CollaborationOpenOptions["readiness"]> = "allow-local-authority",
  ): Promise<void> {
    const requiresRemoteAuthority = mode === "open" && readiness === "require-authenticated-sync";
    const startsFromRemoteAuthority = mode === "create" || requiresRemoteAuthority;
    let remoteStoreCheckpoint: ReplicaStoreCheckpoint | undefined;
    let hasCachedStoreUpdates = false;
    try {
      if (this.engine.storeMode === "durable") {
        try {
          const store = this.engine.options.store;
          if (!("open" in store)) throw new Error("Durable Store configuration is invalid");
          const lease = await store.open(this.ref.id);
          this.store = lease;
          const restored = await lease.load();
          if (startsFromRemoteAuthority) {
            remoteStoreCheckpoint = restored.checkpoint;
            hasCachedStoreUpdates = restored.updates.length > 0;
          } else {
            for (const update of restored.updates) Y.applyUpdate(this.doc, update, RESTORE_ORIGIN);
            this.hasLocalAuthority = validateSchema(this.schema, this.ref) === "created";
            this.installStoreObservation();
          }
        } catch (cause) {
          throw new CollaborationError("store-failed", `Could not restore ${this.ref.id}`, cause);
        }
      }

      validateSchema(this.schema, this.ref);
      try {
        this.provider = await this.engine.options.providers.prepare({ document: this.ref, replica: this.port });
        this.stopProviderState = this.provider.subscribe((state) => this.applyProviderState(state));
        this.applyProviderState(this.provider.getState());
        this.providerStart = this.provider.start();
        if (mode === "create" || requiresRemoteAuthority || !this.hasLocalAuthority) {
          await this.providerStart;
          if (this.closed) {
            throw new CollaborationError("engine-closed", `Collaboration Engine closed while opening ${this.ref.id}`);
          }
          this.applyProviderState(this.provider.getState());
        } else {
          this.applyProviderState(this.provider.getState());
          void this.providerStart.catch((cause) => this.handleBackgroundProviderFailure(cause));
        }
        if (mode === "create" && this.state.access !== "read-write") {
          throw new CollaborationError(
            "read-only",
            `Creating collaborative document ${this.ref.id} requires read-write access`,
          );
        }
        if (requiresRemoteAuthority) {
          const state = this.provider.getState();
          if (
            state.authentication !== "authenticated"
            || state.sync !== "synced"
            || (state.access !== "read-only" && state.access !== "read-write")
          ) {
            throw this.authenticatedSyncFailure(state);
          }
        }
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
        if (remoteStoreCheckpoint && hasCachedStoreUpdates) {
          await this.resetStoreToRemoteAuthority(remoteStoreCheckpoint, false);
        } else if (this.store) this.installStoreObservation();
        createSchema(this.doc, this.schema, this.ref, initialMarkdown ?? "");
        this.hasLocalAuthority = true;
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
      if (requiresRemoteAuthority && remoteStoreCheckpoint) {
        await this.resetStoreToRemoteAuthority(remoteStoreCheckpoint);
      }
      if (mode === "open") {
        const providerState = this.provider?.getState();
        this.remoteAuthorityProven = requiresRemoteAuthority
          && providerState?.authentication === "authenticated"
          && providerState.sync === "synced"
          && (providerState.access === "read-only" || providerState.access === "read-write");
      }
      this.hasLocalAuthority = true;
      this.setState({
        lifecycle: "open",
        consistency: "healthy",
        persistence: this.currentPersistence(),
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
      try {
        await this.close();
      } catch (cleanupCause) {
        const cleanupFailures = cleanupCause instanceof AggregateError
          ? cleanupCause.errors
          : [cleanupCause];
        throw new CollaborationError(
          error.code,
          error.message,
          new AggregateError(
            [error, ...cleanupFailures],
            `Collaboration initialization and cleanup failed for ${this.ref.id}`,
          ),
        );
      }
      throw error;
    }
  }

  async requireAuthenticatedSync(): Promise<void> {
    if (this.closed) {
      throw new CollaborationError("handle-closed", `Collaborative document ${this.ref.id} is closed`);
    }
    if (!this.remoteAuthorityProven) {
      throw new CollaborationError(
        "remote-authority-unavailable",
        `Authenticated join cannot reuse a local-authority Replica for ${this.ref.id}`,
      );
    }
    const provider = this.provider;
    const providerStart = this.providerStart;
    if (!provider || !providerStart) {
      throw new CollaborationError(
        "provider-failed",
        `Collaboration Provider is unavailable for ${this.ref.id}`,
      );
    }
    try {
      await providerStart;
    } catch (cause) {
      if (cause instanceof CollaborationError) throw cause;
      const state = provider.getState();
      this.applyProviderState(state);
      throw this.authenticatedSyncFailure(state, cause);
    }
    if (this.closed) {
      throw new CollaborationError("handle-closed", `Collaborative document ${this.ref.id} is closed`);
    }
    const state = provider.getState();
    this.applyProviderState(state);
    if (
      state.authentication !== "authenticated"
      || state.sync !== "synced"
      || (state.access !== "read-only" && state.access !== "read-write")
    ) {
      throw this.authenticatedSyncFailure(state);
    }
    if (validateSchema(this.schema, this.ref) !== "created") {
      throw new CollaborationError(
        "document-not-found",
        `Collaborative document ${this.ref.id} was not found after authenticated synchronization`,
      );
    }
  }

  private authenticatedSyncFailure(state: ProviderState, cause?: unknown): CollaborationError {
    const message = state.diagnostic?.message
      ?? `Provider did not establish authenticated synchronization for ${this.ref.id}`;
    if (state.authentication === "denied") {
      return new CollaborationError("authentication-denied", message, cause);
    }
    if (state.authentication === "expired") {
      return new CollaborationError("authentication-expired", message, cause);
    }
    if (state.authentication === "revoked") {
      return new CollaborationError("authorization-revoked", message, cause);
    }
    if (state.authentication === "failed") {
      return new CollaborationError("authentication-failed", message, cause);
    }
    return new CollaborationError("provider-failed", message, cause);
  }

  private applyProviderState(provider: ProviderState): void {
    const access = provider.access === "none"
      && this.hasLocalAuthority
      && provider.authentication === "authenticating"
      && provider.transport !== "online"
      ? "local-only"
      : provider.access;
    this.setState({
      transport: provider.transport,
      sync: provider.sync,
      authentication: provider.authentication,
      access,
      diagnostic: provider.diagnostic,
    });
    if (
      provider.authentication === "revoked"
      || provider.authentication === "denied"
      || provider.authentication === "expired"
      || provider.authentication === "failed"
      || (provider.access === "none" && provider.authentication !== "authenticating")
    ) {
      this.presences.clear();
      this.awareness.setLocalState(null);
    }
  }

  private handleBackgroundProviderFailure(cause: unknown): void {
    if (this.closed) return;
    const providerState = this.provider?.getState();
    if (providerState) this.applyProviderState(providerState);
    if (providerState?.diagnostic) return;
    const diagnostic = {
      code: "provider-failed",
      message: `Provider could not synchronize ${this.ref.id}`,
      documentId: this.ref.id,
      cause,
    } satisfies CollaborationDiagnostic;
    this.state = { ...this.state, transport: "failed", sync: "failed", access: "none", diagnostic };
    this.engine.report(diagnostic);
    this.emit();
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

  private markStoreCleanWhenSettled(): void {
    if (
      !this.closed
      && this.pendingStoreOperations === 0
      && this.storeFailure === null
    ) {
      this.setState({ persistence: "clean" });
    }
  }

  private currentPersistence(): CollaborationPersistence {
    if (this.engine.storeMode === "volatile") return "volatile";
    if (this.storeFailure !== null || this.storeBackpressured) return "failed";
    return this.pendingStoreOperations > 0 ? "pending" : "clean";
  }

  reconcilePersistence(): Promise<void> {
    if (this.persistenceReconcilePromise) return this.persistenceReconcilePromise;
    if (this.closed) {
      return Promise.reject(new CollaborationError(
        "handle-closed",
        `Collaborative document ${this.ref.id} is closed`,
      ));
    }
    const store = this.store;
    if (!store) {
      return Promise.reject(new CollaborationError(
        "store-failed",
        `Collaborative document ${this.ref.id} has no durable Store`,
      ));
    }
    this.pendingStoreOperations += 1;
    this.setState({ persistence: "pending" });
    const reconciliation = this.storeQueue
      .then(async () => {
        let reconciledVersion: number;
        do {
          const restored = await store.load();
          for (const update of restored.updates) Y.applyUpdate(this.doc, update, RESTORE_ORIGIN);
          reconciledVersion = this.storeUpdateVersion;
          const snapshot = this.port.encodeStateAsUpdate();
          await store.replaceWithSnapshot(snapshot, { through: restored.checkpoint });
          await store.flush();
        } while (this.storeBackpressured && reconciledVersion !== this.storeUpdateVersion);
        this.durableUpdatesSinceSnapshot = 0;
        this.storeFailure = null;
        this.storeBackpressured = false;
        if (!this.closed && this.state.diagnostic?.code === "store-failed") {
          this.state = { ...this.state, diagnostic: undefined };
        }
      })
      .then(() => {
        this.pendingStoreOperations -= 1;
        this.markStoreCleanWhenSettled();
      })
      .catch((cause) => {
        this.pendingStoreOperations -= 1;
        if (!this.closed) this.failStore(cause);
        else this.storeFailure ??= cause;
        throw new CollaborationError(
          "store-failed",
          `Could not reconcile durable state for ${this.ref.id}`,
          cause,
        );
      });
    this.storeQueue = reconciliation.catch(() => undefined);
    this.persistenceReconcilePromise = reconciliation;
    void reconciliation.then(
      () => {
        if (this.persistenceReconcilePromise === reconciliation) this.persistenceReconcilePromise = null;
      },
      () => {
        if (this.persistenceReconcilePromise === reconciliation) this.persistenceReconcilePromise = null;
      },
    );
    return reconciliation;
  }

  close(): Promise<void> {
    this.closePromise ??= this.performClose();
    return this.closePromise;
  }

  private async performClose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.state = { ...this.state, lifecycle: "closing" };
    const failures: unknown[] = [];
    const storeFailures: unknown[] = this.storeFailure === null ? [] : [this.storeFailure];
    const bindingResults = await Promise.allSettled(
      [...this.bindings]
        .filter((binding) => !binding.detached)
        .map((binding) => binding.detach()),
    );
    for (const result of bindingResults) {
      if (result.status === "rejected") failures.push(result.reason);
    }
    this.bindings.clear();
    await captureCleanupFailure(failures, () => this.presences.clear());
    await captureCleanupFailure(failures, () => this.awareness.setLocalState(null));
    const stopProviderState = this.stopProviderState;
    this.stopProviderState = null;
    if (stopProviderState) await captureCleanupFailure(failures, stopProviderState);
    const provider = this.provider;
    this.provider = null;
    if (provider) await captureCleanupFailure(failures, () => provider.release());
    const providerStart = this.providerStart;
    this.providerStart = null;
    if (providerStart) await providerStart.catch(() => undefined);
    const stopStoreObservation = this.stopStoreObservation;
    this.stopStoreObservation = null;
    const rememberStoreFailure = (cause: unknown): void => {
      if (!storeFailures.includes(cause)) storeFailures.push(cause);
      if (this.storeFailure === null) this.failStore(cause);
    };
    if (stopStoreObservation) await captureCleanupFailure(failures, stopStoreObservation);
    try {
      await this.storeQueue;
    } catch (cause) {
      rememberStoreFailure(cause);
    }
    if (this.storeFailure !== null && !storeFailures.includes(this.storeFailure)) {
      storeFailures.push(this.storeFailure);
    }
    const store = this.store;
    this.store = null;
    if (store) {
      try {
        await store.flush();
      } catch (cause) {
        rememberStoreFailure(cause);
      }
      try {
        await store.close();
      } catch (cause) {
        rememberStoreFailure(cause);
      }
    }
    await captureCleanupFailure(failures, () => this.awareness.off("change", this.awarenessListener));
    await captureCleanupFailure(failures, () => this.schema.text.unobserve(this.markdownListener));
    await captureCleanupFailure(failures, () => this.markdownListeners.clear());
    await captureCleanupFailure(failures, () => this.listeners.clear());
    await captureCleanupFailure(failures, () => {
      removeAwarenessStates(this.awareness, [...this.awareness.getStates().keys()], this);
    });
    await captureCleanupFailure(failures, () => this.awareness.destroy());
    await captureCleanupFailure(failures, () => this.doc.destroy());
    this.state = { ...this.state, lifecycle: "closed" };
    if (storeFailures.length > 0) {
      const storeCause = storeFailures.length === 1
        ? storeFailures[0]
        : new AggregateError(storeFailures, `Replica Store cleanup failed for ${this.ref.id}`);
      failures.push(new CollaborationError(
        "store-failed",
        `Could not durably close ${this.ref.id}`,
        storeCause,
      ));
    }
    throwCleanupFailures(failures, `Collaborative Replica cleanup failed for ${this.ref.id}`);
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
  private editorDestroyListener: EditorContributionRegistration | null = null;
  private localPresence: LocalPresence | null = null;
  private presenceFrame: number | null = null;
  private textObserved = false;
  private readyForProjection = false;
  private readyForProposals = false;
  private detachPromise: Promise<void> | null = null;
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
    private readonly access: EditorBindingAccess,
    private readonly onDetach: (binding: EditorBinding) => void,
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
    access: EditorBindingAccess,
    onDetach: (binding: EditorBinding) => void,
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
    const binding = new EditorBinding(id, replica, editor, engine, access, onDetach);
    const markdownAtStart = replica.schema.text.toString();
    if (content === "require-match" && editor.getDocument() !== markdownAtStart) {
      binding.undoManager.destroy();
      throw new CollaborationError("content-mismatch", "Editor content does not match the collaborative document");
    }
    try {
      binding.editorDestroyListener = sink.registerDestroyListener(
        binding.id,
        () => binding.onEditorDestroyed(),
      );
      binding.filter = sink.registerTransactionFilter(binding.id, () => {
        const reason = binding.writeRejectionReason();
        return reason === null ? { action: "accept" } : { action: "reject", reason };
      }, { priority: 10_000 });
      binding.listener = sink.registerUpdateListener(binding.id, (update) => binding.onEditorUpdate(update));
      replica.schema.text.observe(binding.textObserver);
      binding.textObserved = true;
      binding.source = sink.registerAuthoritativeSource(binding.id, {
        undo: () => binding.runHistory("undo"),
        redo: () => binding.runHistory("redo"),
      });
      await binding.source.ready;
      if (binding.detached) {
        throw new CollaborationError("binding-conflict", "Editor was destroyed during collaboration attach");
      }
      if (replica.closed) {
        throw new CollaborationError("handle-closed", "Collaborative document closed during Editor attach");
      }
      const currentMarkdown = replica.schema.text.toString();
      const currentEditorMarkdown = editor.getDocument();
      if (
        content === "require-match"
        && currentEditorMarkdown !== markdownAtStart
        && currentEditorMarkdown !== currentMarkdown
      ) {
        throw new CollaborationError(
          "content-mismatch",
          "Editor content changed outside collaboration while the binding was attaching",
        );
      }
      binding.readyForProjection = true;
      if (!binding.projectCurrentReplica("attach")) {
        throw new CollaborationError("projection-diverged", "Could not project collaborative content into Editor");
      }
      replica.bindings.add(binding);
      engine.rememberBinding(editor, binding);
      editor.on("selectionChange", binding.selectionListener);
      editor.on("focus", binding.focusListener);
      editor.on("blur", binding.blurListener);
      binding.readyForProposals = true;
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
    if (
      this.state !== "ready"
      || !this.readyForProjection
      || event.transaction.origin === this.localOrigin
      || !this.source
    ) return;
    if (!this.projectCurrentReplica("yjs")) this.quarantine();
    this.refreshPresence();
  }

  private projectCurrentReplica(origin: "attach" | "yjs"): boolean {
    if (!this.source) return false;
    const next = this.replica.schema.text.toString();
    const change = minimalChange(this.editor.getDocument(), next);
    if (!change) return true;
    const result = this.source.dispatch({
      changes: [change],
      origin: [this.id, origin],
    });
    return result.status === "success" && this.editor.getDocument() === next;
  }

  private writeRejectionReason(): string | null {
    if (!this.readyForProposals) return "collaboration-binding-not-ready";
    if (this.state === "quarantined") return "collaboration-quarantined";
    if (this.state !== "ready" || this.replica.closed) return "collaboration-binding-unavailable";
    if (this.access === "read-only" || this.replica.state.access === "read-only") {
      return "collaboration-read-only";
    }
    if (this.replica.state.access !== "read-write" && this.replica.state.access !== "local-only") {
      return "collaboration-authorization-unavailable";
    }
    return null;
  }

  private runHistory(action: "undo" | "redo"): boolean {
    if (this.writeRejectionReason() !== null) return false;
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

  private onEditorDestroyed(): void {
    const cleanup = this.detach();
    void cleanup.catch((cause) => {
      this.engine.report({
        code: "editor-destroy-cleanup-failed",
        message: `Editor Binding cleanup failed after Editor destruction for ${this.replica.ref.id}`,
        documentId: this.replica.ref.id,
        cause,
      });
    });
  }

  detach(): Promise<void> {
    this.detachPromise ??= this.performDetach();
    return this.detachPromise;
  }

  private performDetach(): Promise<void> {
    if (this.detached) return Promise.resolve();
    this.state = "detached";
    this.readyForProjection = false;
    this.readyForProposals = false;
    let cleanupOrder = 0;
    const failures = new Map<number, unknown>();
    const pending: Promise<void>[] = [];
    const startCleanup = (cleanup: () => void | Promise<void>): void => {
      const order = cleanupOrder++;
      try {
        const result = cleanup();
        if (result && typeof result.then === "function") {
          pending.push(Promise.resolve(result).catch((cause) => {
            failures.set(order, cause);
          }));
        }
      } catch (cause) {
        failures.set(order, cause);
      }
    };
    const presenceFrame = this.presenceFrame;
    this.presenceFrame = null;
    if (presenceFrame !== null) {
      startCleanup(() => cancelAnimationFrame(presenceFrame));
    }
    startCleanup(() => this.replica.publishPresence(this.id, null));
    startCleanup(() => this.editor.off("selectionChange", this.selectionListener));
    startCleanup(() => this.editor.off("focus", this.focusListener));
    startCleanup(() => this.editor.off("blur", this.blurListener));
    if (this.textObserved) {
      this.textObserved = false;
      startCleanup(() => this.replica.schema.text.unobserve(this.textObserver));
    }
    const editorDestroyListener = this.editorDestroyListener;
    const listener = this.listener;
    const filter = this.filter;
    const source = this.source;
    this.editorDestroyListener = null;
    this.listener = null;
    this.filter = null;
    this.source = null;
    if (editorDestroyListener) startCleanup(() => editorDestroyListener.dispose());
    if (listener) startCleanup(() => listener.dispose());
    if (filter) startCleanup(() => filter.dispose());
    if (source) startCleanup(() => source.dispose());
    startCleanup(() => this.undoManager.destroy());
    startCleanup(() => { this.replica.bindings.delete(this); });
    startCleanup(() => this.engine.forgetBinding(this.editor, this));
    startCleanup(() => this.onDetach(this));
    startCleanup(() => this.replica.emit());

    return Promise.all(pending).then(() => {
      const orderedFailures = [...failures.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, cause]) => cause);
      throwCleanupFailures(orderedFailures, `Editor Binding cleanup failed for ${this.replica.ref.id}`);
    });
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
  private closePromise: Promise<void> | null = null;

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

  getMarkdownSnapshot(): CollaborativeMarkdownSnapshot | undefined {
    return this.closed ? undefined : this.replica.markdownSnapshot();
  }

  async replaceMarkdown(
    markdown: string,
    options: { readonly origin: FileProjectionReplacementOrigin; readonly expectedRevision: string },
  ): Promise<CollaborativeMarkdownSnapshot> {
    if (this.closed) throw new CollaborationError("handle-closed", "Collaborative document handle is closed");
    return this.replica.replaceMarkdown(markdown, options);
  }

  subscribeMarkdown(listener: (snapshot: CollaborativeMarkdownSnapshot) => void): Unsubscribe {
    if (this.closed) throw new CollaborationError("handle-closed", "Collaborative document handle is closed");
    this.replica.markdownListeners.add(listener);
    try {
      listener(this.replica.markdownSnapshot());
    } catch (cause) {
      this.engine.report({
        code: "listener-failed",
        message: `Collaboration Markdown listener failed for ${this.id}`,
        documentId: this.id,
        cause,
      });
    }
    return () => this.replica.markdownListeners.delete(listener);
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

  reconcilePersistence(): Promise<void> {
    if (this.closed) {
      return Promise.reject(new CollaborationError("handle-closed", "Collaborative document handle is closed"));
    }
    return this.replica.reconcilePersistence();
  }

  async attach(
    editor: EditorAPI,
    options: {
      readonly content: "replace-editor" | "require-match";
      readonly access?: EditorBindingAccess;
    },
  ): Promise<EditorBindingHandle> {
    if (this.closed) throw new CollaborationError("handle-closed", "Collaborative document handle is closed");
    const binding = await EditorBinding.attach(
      this.engine.nextBindingId(this.id),
      this.replica,
      editor,
      this.engine,
      options.content,
      options.access ?? "read-write",
      (detached) => this.bindings.delete(detached),
    );
    if (this.closed) {
      let cleanupFailure: unknown;
      try {
        await binding.detach();
      } catch (cause) {
        cleanupFailure = cause;
      }
      throw new CollaborationError(
        "handle-closed",
        "Collaborative document closed during Editor attach",
        cleanupFailure,
      );
    }
    if (binding.detached) {
      throw new CollaborationError(
        "binding-conflict",
        "Editor was destroyed before its collaboration binding could be retained",
      );
    }
    this.bindings.add(binding);
    return binding;
  }

  close(): Promise<void> {
    this.closePromise ??= this.performClose();
    return this.closePromise;
  }

  private async performClose(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    const failures: unknown[] = [];
    const bindings = [...this.bindings].filter((binding) => !binding.detached);
    const results = await Promise.allSettled(bindings.map((binding) => binding.detach()));
    for (const result of results) {
      if (result.status === "rejected") failures.push(result.reason);
    }
    this.bindings.clear();
    await captureCleanupFailure(failures, () => this.engine.release(this.entry, this.replica));
    throwCleanupFailures(failures, `Collaborative Document cleanup failed for ${this.id}`);
  }
}

class CollaborationEngineImpl implements CollaborationEngine {
  readonly entries = new Map<DocumentId, RegistryEntry>();
  readonly engineListeners = new Set<CollaborationListener>();
  readonly editorBindings = new WeakMap<EditorAPI, EditorBinding>();
  readonly storeMode: "volatile" | "durable";
  readonly storeCompactionThreshold: number;
  readonly maxPendingStoreOperations: number;
  readonly maxPendingStoreBytes: number;
  private closed = false;
  private closePromise: Promise<void> | null = null;
  private bindingSequence = 0;

  constructor(readonly options: CollaborationEngineOptions) {
    if (!options.providers) throw new TypeError("A Collaboration Provider factory is required");
    if (!options.store) throw new TypeError("Store must be supplied, or explicitly set to volatile mode");
    this.storeMode = "mode" in options.store && options.store.mode === "volatile" ? "volatile" : "durable";
    this.storeCompactionThreshold = options.storeCompaction?.updateThreshold ??
      DEFAULT_STORE_COMPACTION_THRESHOLD;
    if (!Number.isSafeInteger(this.storeCompactionThreshold) || this.storeCompactionThreshold <= 0) {
      throw new RangeError("storeCompaction.updateThreshold must be a positive safe integer");
    }
    this.maxPendingStoreOperations = options.storeBackpressure?.maxPendingOperations
      ?? DEFAULT_MAX_PENDING_STORE_OPERATIONS;
    this.maxPendingStoreBytes = options.storeBackpressure?.maxPendingBytes
      ?? DEFAULT_MAX_PENDING_STORE_BYTES;
    if (!Number.isSafeInteger(this.maxPendingStoreOperations) || this.maxPendingStoreOperations <= 0) {
      throw new RangeError("storeBackpressure.maxPendingOperations must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.maxPendingStoreBytes) || this.maxPendingStoreBytes <= 0) {
      throw new RangeError("storeBackpressure.maxPendingBytes must be a positive safe integer");
    }
  }

  create(
    document: CollabDocumentRef,
    options: { readonly initialMarkdown: string },
  ): Promise<CollaborativeDocumentHandle> {
    return this.acquire(document, "create", options.initialMarkdown);
  }

  open(
    document: CollabDocumentRef,
    options: CollaborationOpenOptions = {},
  ): Promise<CollaborativeDocumentHandle> {
    const readiness = options.readiness ?? "allow-local-authority";
    if (readiness !== "allow-local-authority" && readiness !== "require-authenticated-sync") {
      throw new TypeError("Collaboration open readiness is invalid");
    }
    return this.acquire(document, "open", undefined, readiness);
  }

  private async acquire(
    ref: CollabDocumentRef,
    mode: "create" | "open",
    initialMarkdown?: string,
    readiness: NonNullable<CollaborationOpenOptions["readiness"]> = "allow-local-authority",
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
      const opening = replica.initialize(mode, initialMarkdown, readiness).then(() => replica);
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
    const handle = new DocumentHandle(this, entry, replica);
    if (mode === "open" && readiness === "require-authenticated-sync") {
      try {
        await replica.requireAuthenticatedSync();
      } catch (cause) {
        try {
          await handle.close();
        } catch (cleanupCause) {
          this.report({
            code: "strict-open-cleanup-failed",
            message: `Failed to release an unauthorized open for ${ref.id}`,
            documentId: ref.id,
            cause: cleanupCause,
          });
        }
        throw cause;
      }
    }
    return handle;
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

  close(): Promise<void> {
    this.closePromise ??= this.performClose();
    return this.closePromise;
  }

  private async performClose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const entries = [...this.entries.values()];
    this.entries.clear();
    const results = await Promise.allSettled(entries.map(async (entry) => {
      await (entry.replica ?? await entry.opening).close();
    }));
    this.engineListeners.clear();
    const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    throwCleanupFailures(failures, "Collaboration Engine cleanup failed");
  }
}

export function createCollaborationEngine(options: CollaborationEngineOptions): CollaborationEngine {
  return new CollaborationEngineImpl(options);
}
