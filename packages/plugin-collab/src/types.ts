import type { EditorAPI } from "@floatboat/nexus-core";
import type { CollaborativeMarkdownPort } from "./file-projection";

declare const documentIdBrand: unique symbol;

export type DocumentId = string & { readonly [documentIdBrand]: true };

export function asDocumentId(value: string): DocumentId {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 256) {
    throw new TypeError("DocumentId must contain between 1 and 256 characters");
  }
  return normalized as DocumentId;
}

export interface CollabDocumentRef {
  readonly id: DocumentId;
  /** Stable Host namespace/vault identity. A file path is deliberately not an identity. */
  readonly hostIdentity?: string;
  /** Mutable projection metadata; renaming it never changes the collaboration room. */
  readonly sourcePath?: string;
  readonly title?: string;
}

export type CollaborationLifecycle = "opening" | "open" | "closing" | "closed" | "failed";
export type CollaborationTransport = "idle" | "connecting" | "online" | "offline" | "failed";
export type CollaborationSync = "restoring" | "syncing" | "synced" | "stale" | "failed";
export type CollaborationPersistence = "volatile" | "loading" | "clean" | "pending" | "failed";
export type CollaborationConsistency = "healthy" | "catching-up" | "quarantined";
export type CollaborationAuthentication =
  | "not-required"
  | "authenticating"
  | "authenticated"
  | "denied"
  | "expired"
  | "failed"
  | "revoked";
/** `local-only` permits durable offline edits but makes no server authorization claim. */
export type CollaborationAccess = "none" | "local-only" | "read-only" | "read-write";

export interface CollaborationDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly documentId?: DocumentId;
  readonly cause?: unknown;
}

export interface PresenceSelection {
  readonly anchor: number;
  readonly head: number;
}

export interface LocalPresence {
  readonly userId: string;
  readonly name: string;
  readonly color?: string;
  readonly avatarUrl?: string;
}

export interface PeerSnapshot extends LocalPresence {
  readonly clientId: number;
  readonly selection?: PresenceSelection;
}

export interface CollaborativeDocumentSnapshot {
  readonly id: DocumentId;
  readonly lifecycle: CollaborationLifecycle;
  readonly transport: CollaborationTransport;
  readonly sync: CollaborationSync;
  readonly authentication: CollaborationAuthentication;
  readonly access: CollaborationAccess;
  readonly persistence: CollaborationPersistence;
  readonly consistency: CollaborationConsistency;
  readonly peers: readonly PeerSnapshot[];
  readonly bindings: number;
  readonly diagnostic?: CollaborationDiagnostic;
}

export type Unsubscribe = () => void;
export type CollaborationListener = (snapshot: CollaborativeDocumentSnapshot) => void;
export type CollaborationDocumentListener = CollaborationListener;

export interface ProviderState {
  readonly transport: CollaborationTransport;
  readonly sync: CollaborationSync;
  readonly authentication: CollaborationAuthentication;
  readonly access: CollaborationAccess;
  readonly diagnostic?: CollaborationDiagnostic;
}

/** Browser-safe binary port. Provider adapters never own or receive raw Yjs objects. */
export interface CollaborationReplicaPort {
  encodeStateVector(): Uint8Array;
  encodeStateAsUpdate(stateVector?: Uint8Array): Uint8Array;
  applyUpdate(update: Uint8Array, origin?: unknown): void;
  onUpdate(listener: (update: Uint8Array, origin: unknown) => void): Unsubscribe;
  encodeAwarenessUpdate(clientIds?: readonly number[]): Uint8Array;
  applyAwarenessUpdate(update: Uint8Array, origin?: unknown): void;
  onAwarenessUpdate(listener: (update: Uint8Array, origin: unknown) => void): Unsubscribe;
  getAwarenessClientIds(): readonly number[];
}

export interface ProviderContext {
  readonly document: CollabDocumentRef;
  readonly replica: CollaborationReplicaPort;
}

export interface ProviderLease {
  start(): Promise<void>;
  getState(): ProviderState;
  subscribe(listener: (state: ProviderState) => void): Unsubscribe;
  release(): Promise<void>;
}

export interface CollaborationProviderFactory {
  prepare(context: ProviderContext): Promise<ProviderLease>;
}

export interface ReplicaStoreLoadResult {
  readonly updates: readonly Uint8Array[];
  /** Opaque durability watermark covering every returned update. */
  readonly checkpoint: ReplicaStoreCheckpoint;
}

/**
 * A Store-owned journal generation plus a monotonic sequence. Callers may pass
 * it back only to the lease that produced it; they must not manufacture or
 * compare checkpoints from different Stores.
 */
export interface ReplicaStoreCheckpoint {
  readonly generation: string;
  readonly sequence: number;
}

export interface ReplicaStoreLease {
  load(): Promise<ReplicaStoreLoadResult>;
  append(update: Uint8Array): Promise<ReplicaStoreCheckpoint>;
  flush(): Promise<void>;
  replaceWithSnapshot(
    update: Uint8Array,
    options: { readonly through: ReplicaStoreCheckpoint },
  ): Promise<ReplicaStoreCheckpoint>;
  close(): Promise<void>;
}

export interface ReplicaStore {
  open(documentId: DocumentId): Promise<ReplicaStoreLease>;
}

export interface CollaborationEngineOptions {
  readonly providers: CollaborationProviderFactory;
  readonly store: ReplicaStore | { readonly mode: "volatile" };
  /** Durable journal rows written between safe snapshot compactions. Defaults to 256. */
  readonly storeCompaction?: { readonly updateThreshold?: number };
  /** In-memory durable-write backlog limits. Defaults to 256 operations / 16 MiB. */
  readonly storeBackpressure?: {
    readonly maxPendingOperations?: number;
    readonly maxPendingBytes?: number;
  };
  readonly diagnostics?: (diagnostic: CollaborationDiagnostic) => void;
}

/**
 * Controls which authority can satisfy `open()` readiness. The default keeps
 * durable offline recovery available. Invitation joins use remote authority:
 * cached updates are not applied before authenticated Provider synchronization,
 * and the resulting remote snapshot replaces the cache before a handle is exposed.
 */
export interface CollaborationOpenOptions {
  readonly readiness?: "allow-local-authority" | "require-authenticated-sync";
}

export interface EditorBindingHandle {
  readonly id: string;
  readonly detached: boolean;
  getState(): "ready" | "quarantined" | "detached";
  setPresence(presence: LocalPresence | null): void;
  detach(): Promise<void>;
}

/** Host-owned membership limit for local Editor proposals. Defaults to `read-write`. */
export type EditorBindingAccess = "read-only" | "read-write";

export interface CollaborativeDocumentHandle extends CollaborativeMarkdownPort {
  readonly id: DocumentId;
  readonly closed: boolean;
  whenReady(): Promise<void>;
  getMarkdown(): string | undefined;
  getState(): CollaborativeDocumentSnapshot;
  subscribe(listener: CollaborationDocumentListener): Unsubscribe;
  /**
   * Reconcile the complete live Replica into the durable Store after a transient or
   * ambiguously committed write failure. Resolves only after checkpoint replacement and flush.
   */
  reconcilePersistence(): Promise<void>;
  attach(
    editor: EditorAPI,
    options: {
      readonly content: "replace-editor" | "require-match";
      readonly access?: EditorBindingAccess;
    },
  ): Promise<EditorBindingHandle>;
  close(): Promise<void>;
}

export interface CollaborationEngine {
  create(
    document: CollabDocumentRef,
    options: { readonly initialMarkdown: string },
  ): Promise<CollaborativeDocumentHandle>;
  open(
    document: CollabDocumentRef,
    options?: CollaborationOpenOptions,
  ): Promise<CollaborativeDocumentHandle>;
  getSnapshot(documentId: DocumentId): CollaborativeDocumentSnapshot | undefined;
  list(): readonly CollaborativeDocumentSnapshot[];
  subscribe(listener: CollaborationListener): Unsubscribe;
  close(): Promise<void>;
}

export type CollaborationErrorCode =
  | "engine-closed"
  | "handle-closed"
  | "binding-conflict"
  | "interaction-active"
  | "content-mismatch"
  | "document-not-found"
  | "document-already-exists"
  | "document-identity-mismatch"
  | "schema-mismatch"
  | "authentication-denied"
  | "authentication-expired"
  | "authentication-failed"
  | "authorization-revoked"
  | "read-only"
  | "remote-authority-unavailable"
  | "provider-failed"
  | "store-failed"
  | "projection-revision-conflict"
  | "projection-diverged";

export class CollaborationError extends Error {
  constructor(
    readonly code: CollaborationErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CollaborationError";
  }
}
