import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
  MessageType,
  WebSocketStatus,
} from "@hocuspocus/provider";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import * as Y from "yjs";

import {
  CollaborationError,
  type CollaborationAccess,
  type CollaborationAuthentication,
  type CollaborationDiagnostic,
  type CollaborationErrorCode,
  type CollaborationProviderFactory,
  type CollaborationReplicaPort,
  type DocumentId,
  type ProviderLease,
  type ProviderState,
  type Unsubscribe,
} from "./types";

const REPLICA_TO_PROVIDER = Object.freeze({ kind: "nexus-hocuspocus-replica" });
const PROVIDER_TO_REPLICA = Object.freeze({ kind: "nexus-hocuspocus-provider" });
const YJS_SYNC_UPDATE_MESSAGE = 2;

function isDocumentUpdateFrame(value: unknown): boolean {
  if (!(value instanceof Uint8Array)) return false;
  let offset = 0;
  const readVarUint = (): number | undefined => {
    let result = 0;
    let multiplier = 1;
    for (let index = 0; index < 8; index += 1) {
      const byte = value[offset++];
      if (byte === undefined) return undefined;
      result += (byte & 0x7f) * multiplier;
      if (!Number.isSafeInteger(result)) return undefined;
      if ((byte & 0x80) === 0) return result;
      multiplier *= 128;
    }
    return undefined;
  };
  const documentNameLength = readVarUint();
  if (documentNameLength === undefined || documentNameLength > value.byteLength - offset) return false;
  offset += documentNameLength;
  return readVarUint() === MessageType.Sync && readVarUint() === YJS_SYNC_UPDATE_MESSAGE;
}

/**
 * Yjs already retains the complete current Replica in `mirror`. Queuing each
 * incremental update while disconnected duplicates that state without a bound.
 * A reconnect's state-vector handshake sends the missing state, so offline
 * document frames can be discarded while authentication/awareness frames keep
 * the upstream socket's normal bounded/deduplicated behavior.
 */
class StateVectorReconnectWebsocket extends HocuspocusProviderWebsocket {
  override send(message: unknown): void {
    const transport = Reflect.get(this, "webSocket") as { readonly readyState?: unknown } | null;
    if (
      isDocumentUpdateFrame(message)
      && (this.status !== WebSocketStatus.Connected || transport?.readyState !== 1)
    ) return;
    super.send(message);
  }
}

export interface HocuspocusReconnectOptions {
  readonly initialDelayMs?: number;
  readonly maximumDelayMs?: number;
  readonly maximumAttempts?: number;
  readonly factor?: number;
  readonly jitter?: boolean;
}

export interface HocuspocusProviderFactoryOptions {
  readonly url: string;
  readonly token: (documentId: DocumentId) => string | Promise<string>;
  readonly initialSyncTimeoutMs?: number;
  readonly reconnect?: HocuspocusReconnectOptions;
  /** Standard WebSocket constructor override for runtimes without global WebSocket. */
  readonly webSocketPolyfill?: unknown;
}

export interface HocuspocusProviderControl {
  /** Force every active lease for the document to reconnect and obtain a fresh token. */
  reconnect(documentId: DocumentId): Promise<void>;
}

export interface HocuspocusCollaborationProvider extends CollaborationProviderFactory {
  readonly control: HocuspocusProviderControl;
}

function validatedUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new TypeError("Hocuspocus Provider URL must use ws: or wss:");
  }
  if (url.username || url.password) {
    throw new TypeError("Hocuspocus Provider URL must not contain credentials");
  }
  return url.toString().replace(/\/$/u, "");
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function diagnostic(code: string, message: string, documentId: DocumentId): CollaborationDiagnostic {
  return { code, message, documentId };
}

interface AuthenticationFailure {
  readonly authentication: Extract<CollaborationAuthentication, "denied" | "expired" | "revoked">;
  readonly code: Extract<
    CollaborationErrorCode,
    "authentication-denied" | "authentication-expired" | "authorization-revoked"
  >;
  readonly message: string;
}

function authenticationFailure(reason: string, documentId: DocumentId): AuthenticationFailure {
  if (reason === "authentication-expired" || reason === "authorization-expired") {
    return {
      authentication: "expired",
      code: "authentication-expired",
      message: `Collaboration credential expired for ${documentId}`,
    };
  }
  if (reason === "authentication-revoked" || reason === "authorization-revoked") {
    return {
      authentication: "revoked",
      code: "authorization-revoked",
      message: `Collaboration authorization was revoked for ${documentId}`,
    };
  }
  return {
    authentication: "denied",
    code: "authentication-denied",
    message: `Collaboration credential was denied for ${documentId}`,
  };
}

function trustedCloseAuthenticationFailure(
  code: number,
  reason: string,
  documentId: DocumentId,
): AuthenticationFailure | undefined {
  // Hocuspocus document-scoped close messages surface as code 1000 even when
  // the server supplied an application close code; require its exact reason.
  if (
    (code === 1000 || code === 4401)
    && (reason === "authentication-expired" || reason === "authorization-expired")
  ) {
    return authenticationFailure(reason, documentId);
  }
  if (
    (code === 1000 || code === 4403)
    && (reason === "authentication-revoked" || reason === "authorization-revoked")
  ) {
    return authenticationFailure(reason, documentId);
  }
  if ((code === 1000 || code === 4403) && reason === "authorization-document-mismatch") {
    return authenticationFailure(reason, documentId);
  }
  return undefined;
}

function copy(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}

function awarenessClientIds(update: Uint8Array): readonly number[] {
  let offset = 0;
  const readVarUint = (): number => {
    let value = 0;
    let multiplier = 1;
    for (let index = 0; index < 8; index += 1) {
      const byte = update[offset++];
      if (byte === undefined) throw new RangeError("Truncated Awareness update");
      value += (byte & 0x7f) * multiplier;
      if (!Number.isSafeInteger(value)) throw new RangeError("Awareness integer exceeds safe bounds");
      if ((byte & 0x80) === 0) return value;
      multiplier *= 128;
    }
    throw new RangeError("Awareness integer exceeds encoding bounds");
  };

  try {
    const count = readVarUint();
    if (count > 1_024) return [];
    const ids: number[] = [];
    for (let index = 0; index < count; index += 1) {
      ids.push(readVarUint());
      readVarUint();
      const stateLength = readVarUint();
      if (stateLength > update.byteLength - offset) return [];
      offset += stateLength;
    }
    return offset === update.byteLength ? ids : [];
  } catch {
    return [];
  }
}

class HocuspocusLease implements ProviderLease {
  private state: ProviderState = {
    transport: "idle",
    sync: "syncing",
    authentication: "authenticating",
    access: "none",
  };
  private readonly listeners = new Set<(state: ProviderState) => void>();
  private readonly mirror = new Y.Doc();
  private readonly mirrorAwareness = new Awareness(this.mirror);
  private readonly decodedReplicaDocument = new Y.Doc();
  private readonly decodedReplicaAwareness = new Awareness(this.decodedReplicaDocument);
  private provider: HocuspocusProvider | null = null;
  private socket: HocuspocusProviderWebsocket | null = null;
  private stopReplicaUpdate: Unsubscribe | null = null;
  private stopReplicaAwareness: Unsubscribe | null = null;
  private started = false;
  private released = false;
  private startPromise: Promise<void> | null = null;
  private resolveStart: (() => void) | null = null;
  private rejectStart: ((cause: unknown) => void) | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectPromise: Promise<void> | null = null;
  private resolveReconnect: (() => void) | null = null;
  private rejectReconnect: ((cause: unknown) => void) | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly replicaClientIds = new Set<number>();

  constructor(
    private readonly documentId: DocumentId,
    private readonly replica: CollaborationReplicaPort,
    private readonly options: Required<Pick<HocuspocusProviderFactoryOptions, "url" | "initialSyncTimeoutMs">>
      & Omit<HocuspocusProviderFactoryOptions, "url" | "initialSyncTimeoutMs">,
    private readonly onRelease: () => void,
  ) {
    this.mirrorAwareness.setLocalState(null);
    this.decodedReplicaAwareness.setLocalState(null);
  }

  getState(): ProviderState {
    return this.state;
  }

  subscribe(listener: (state: ProviderState) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(patch: Partial<ProviderState>): void {
    if (this.released) return;
    this.state = Object.freeze({ ...this.state, ...patch });
    for (const listener of [...this.listeners]) {
      try {
        listener(this.state);
      } catch {
        // Engine listeners are isolated at the Engine seam; a Provider observer must not stop transport.
      }
    }
  }

  private finishStart(): void {
    if (!this.resolveStart) return;
    this.clearStartTimeout();
    const resolve = this.resolveStart;
    this.resolveStart = null;
    this.rejectStart = null;
    resolve();
  }

  private finishReconnect(): void {
    if (!this.resolveReconnect) return;
    this.clearReconnectTimeout();
    const resolve = this.resolveReconnect;
    this.resolveReconnect = null;
    this.rejectReconnect = null;
    this.reconnectPromise = null;
    resolve();
  }

  private failStart(cause: unknown): void {
    if (!this.rejectStart) return;
    this.clearStartTimeout();
    const reject = this.rejectStart;
    this.resolveStart = null;
    this.rejectStart = null;
    reject(cause);
  }

  private failReconnect(cause: unknown): void {
    if (!this.rejectReconnect) return;
    this.clearReconnectTimeout();
    const reject = this.rejectReconnect;
    this.resolveReconnect = null;
    this.rejectReconnect = null;
    this.reconnectPromise = null;
    reject(cause);
  }

  private clearStartTimeout(): void {
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null;
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout !== null) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = null;
  }

  private publishAuthenticationFailure(
    failure: AuthenticationFailure,
    transport: ProviderState["transport"],
  ): void {
    const failureDiagnostic = diagnostic(failure.code, failure.message, this.documentId);
    this.publish({
      transport,
      sync: "failed",
      authentication: failure.authentication,
      access: "none",
      diagnostic: failureDiagnostic,
    });
    const error = new CollaborationError(failure.code, failure.message);
    this.failStart(error);
    this.failReconnect(error);
  }

  private copyReplicaAwarenessToMirror(): void {
    const ids = [...this.replicaClientIds];
    const states = this.decodedReplicaAwareness.getStates();
    const local = ids.map((id) => states.get(id)).find((value) => value !== undefined);
    this.mirrorAwareness.setLocalState(local ?? null);
  }

  private installBridges(): void {
    const existingUpdate = this.replica.encodeStateAsUpdate();
    if (existingUpdate.byteLength > 0) Y.applyUpdate(this.mirror, existingUpdate, REPLICA_TO_PROVIDER);

    this.stopReplicaUpdate = this.replica.onUpdate((update, origin) => {
      if (origin === PROVIDER_TO_REPLICA || this.released) return;
      Y.applyUpdate(this.mirror, copy(update), REPLICA_TO_PROVIDER);
    });
    this.stopReplicaAwareness = this.replica.onAwarenessUpdate((update, origin) => {
      if (origin === PROVIDER_TO_REPLICA || this.released) return;
      for (const clientId of awarenessClientIds(update)) this.replicaClientIds.add(clientId);
      applyAwarenessUpdate(this.decodedReplicaAwareness, copy(update), REPLICA_TO_PROVIDER);
      this.copyReplicaAwarenessToMirror();
    });
  }

  async start(): Promise<void> {
    if (this.released) throw new Error("Hocuspocus Provider lease is released");
    if (this.startPromise) return this.startPromise;
    this.started = true;
    this.installBridges();
    this.publish({
      transport: "connecting",
      sync: "syncing",
      authentication: "authenticating",
      access: "none",
      diagnostic: undefined,
    });

    this.startPromise = new Promise<void>((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });
    this.timeout = setTimeout(() => {
      const failure = diagnostic(
        "initial-sync-timeout",
        `Initial collaboration synchronization timed out for ${this.documentId}`,
        this.documentId,
      );
      this.publish({ transport: "failed", sync: "failed", access: "none", diagnostic: failure });
      this.failStart(new Error(failure.message));
    }, this.options.initialSyncTimeoutMs);

    const reconnect = this.options.reconnect ?? {};
    this.socket = new StateVectorReconnectWebsocket({
      url: this.options.url,
      autoConnect: false,
      initialDelay: reconnect.initialDelayMs ?? 0,
      delay: reconnect.initialDelayMs ?? 1_000,
      minDelay: reconnect.initialDelayMs ?? 1_000,
      maxDelay: reconnect.maximumDelayMs ?? 30_000,
      maxAttempts: reconnect.maximumAttempts ?? 0,
      factor: reconnect.factor ?? 2,
      jitter: reconnect.jitter ?? true,
      ...(this.options.webSocketPolyfill ? { WebSocketPolyfill: this.options.webSocketPolyfill } : {}),
    });
    this.provider = new HocuspocusProvider({
      websocketProvider: this.socket,
      name: this.documentId,
      document: this.mirror,
      awareness: this.mirrorAwareness,
      token: async () => this.options.token(this.documentId),
      sessionAwareness: true,
      onOpen: () => {
        this.publish({
          transport: "online",
          sync: "syncing",
          authentication: "authenticating",
          access: "none",
          diagnostic: undefined,
        });
      },
      onStatus: ({ status }) => {
        if (status === "connecting") {
          this.publish({ transport: "connecting", sync: "syncing" });
        } else if (status === "disconnected" && this.state.authentication !== "revoked") {
          this.publish({ transport: "offline", sync: "stale" });
        }
      },
      onAuthenticated: ({ scope }) => {
        const access: CollaborationAccess = scope === "readonly" ? "read-only" : "read-write";
        this.publish({ authentication: "authenticated", access, diagnostic: undefined });
      },
      onAuthenticationFailed: ({ reason }) => {
        this.publishAuthenticationFailure(
          authenticationFailure(reason, this.documentId),
          this.state.transport,
        );
      },
      onSynced: ({ state }) => {
        if (!state || this.state.authentication !== "authenticated") return;
        this.publish({ transport: "online", sync: "synced", diagnostic: undefined });
        this.finishStart();
        this.finishReconnect();
      },
      // Update batching inside the upstream Provider retains every source
      // buffer until its timer fires. Nexus leaves it disabled and relies on
      // the reconnect state-vector handshake instead of an outbound log.
      flushDelay: false,
      onClose: ({ event }) => {
        const failure = trustedCloseAuthenticationFailure(event.code, event.reason, this.documentId);
        if (failure) {
          this.publishAuthenticationFailure(failure, "offline");
          return;
        }
        this.publish({ transport: "offline", sync: "stale" });
      },
    });
    this.provider.attach();

    const onMirrorUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === this.provider && !this.released) {
        this.replica.applyUpdate(copy(update), PROVIDER_TO_REPLICA);
      }
    };
    const onMirrorAwareness = (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin !== this.provider || this.released) return;
      const ids = [...changes.added, ...changes.updated, ...changes.removed]
        .filter((clientId) => clientId !== this.mirror.clientID);
      if (ids.length > 0) {
        this.replica.applyAwarenessUpdate(
          encodeAwarenessUpdate(this.mirrorAwareness, ids),
          PROVIDER_TO_REPLICA,
        );
      }
    };
    this.mirror.on("update", onMirrorUpdate);
    this.mirrorAwareness.on("update", onMirrorAwareness);
    this.provider.on("destroy", () => {
      this.mirror.off("update", onMirrorUpdate);
      this.mirrorAwareness.off("update", onMirrorAwareness);
    });

    void this.socket.connect().catch((cause) => {
      const failure = diagnostic(
        "provider-connect-failed",
        `Collaboration transport failed for ${this.documentId}`,
        this.documentId,
      );
      this.publish({ transport: "failed", sync: "failed", access: "none", diagnostic: failure });
      this.failStart(cause);
    });
    return this.startPromise;
  }

  async reconnect(): Promise<void> {
    if (this.released) throw new Error("Hocuspocus Provider lease is released");
    if (!this.started || !this.socket) {
      throw new Error(`Collaboration document ${this.documentId} has not started`);
    }
    if (this.reconnectPromise) return this.reconnectPromise;

    const socket = this.socket;
    this.publish({
      transport: "connecting",
      sync: "syncing",
      authentication: "authenticating",
      access: "none",
      diagnostic: undefined,
    });
    this.reconnectPromise = new Promise<void>((resolve, reject) => {
      this.resolveReconnect = resolve;
      this.rejectReconnect = reject;
    });
    const pending = this.reconnectPromise;
    this.reconnectTimeout = setTimeout(() => {
      const failure = diagnostic(
        "initial-sync-timeout",
        `Collaboration reconnection timed out for ${this.documentId}`,
        this.documentId,
      );
      this.publish({ transport: "failed", sync: "failed", access: "none", diagnostic: failure });
      this.failReconnect(new Error(failure.message));
    }, this.options.initialSyncTimeoutMs);

    try {
      if (socket.status !== WebSocketStatus.Disconnected) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            socket.off("disconnect", onDisconnect);
            reject(new Error(`Timed out disconnecting collaboration transport for ${this.documentId}`));
          }, Math.min(this.options.initialSyncTimeoutMs, 2_000));
          const onDisconnect = () => {
            clearTimeout(timeout);
            socket.off("disconnect", onDisconnect);
            resolve();
          };
          socket.on("disconnect", onDisconnect);
          socket.disconnect();
        });
      }
      if (this.released) throw new Error("Hocuspocus Provider lease is released");
      await socket.connect();
    } catch (cause) {
      const failure = diagnostic(
        "provider-connect-failed",
        `Collaboration transport failed for ${this.documentId}`,
        this.documentId,
      );
      this.publish({ transport: "failed", sync: "failed", access: "none", diagnostic: failure });
      this.failReconnect(cause);
    }
    return pending;
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    const failures: unknown[] = [];
    const attempt = (operation: () => void): void => {
      try {
        operation();
      } catch (cause) {
        failures.push(cause);
      }
    };
    attempt(() => this.clearStartTimeout());
    attempt(() => this.clearReconnectTimeout());
    attempt(() => this.rejectStart?.(new Error("Hocuspocus Provider lease was released")));
    attempt(() => this.rejectReconnect?.(new Error("Hocuspocus Provider lease was released")));
    this.resolveStart = null;
    this.rejectStart = null;
    this.resolveReconnect = null;
    this.rejectReconnect = null;
    this.reconnectPromise = null;
    const stopReplicaUpdate = this.stopReplicaUpdate;
    const stopReplicaAwareness = this.stopReplicaAwareness;
    this.stopReplicaUpdate = null;
    this.stopReplicaAwareness = null;
    if (stopReplicaUpdate) attempt(stopReplicaUpdate);
    if (stopReplicaAwareness) attempt(stopReplicaAwareness);
    attempt(() => this.listeners.clear());
    const provider = this.provider;
    const socket = this.socket;
    this.provider = null;
    this.socket = null;
    if (this.started && provider) attempt(() => provider.destroy());
    if (socket) attempt(() => socket.destroy());
    attempt(() => this.decodedReplicaAwareness.destroy());
    attempt(() => this.decodedReplicaDocument.destroy());
    attempt(() => this.mirrorAwareness.destroy());
    attempt(() => this.mirror.destroy());
    attempt(this.onRelease);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, `Hocuspocus Provider cleanup failed for ${this.documentId}`);
    }
  }
}

export function createHocuspocusProviderFactory(
  options: HocuspocusProviderFactoryOptions,
): HocuspocusCollaborationProvider {
  if (typeof options.token !== "function") throw new TypeError("A token resolver is required");
  const url = validatedUrl(options.url);
  const initialSyncTimeoutMs = boundedInteger(
    options.initialSyncTimeoutMs ?? 15_000,
    "initialSyncTimeoutMs",
    100,
    120_000,
  );
  const reconnect = options.reconnect;
  if (reconnect?.initialDelayMs !== undefined) {
    boundedInteger(reconnect.initialDelayMs, "reconnect.initialDelayMs", 0, 60_000);
  }
  if (reconnect?.maximumDelayMs !== undefined) {
    boundedInteger(reconnect.maximumDelayMs, "reconnect.maximumDelayMs", 1, 300_000);
  }
  if (reconnect?.maximumAttempts !== undefined) {
    boundedInteger(reconnect.maximumAttempts, "reconnect.maximumAttempts", 0, 1_000);
  }

  const activeLeases = new Map<DocumentId, Set<HocuspocusLease>>();
  const control: HocuspocusProviderControl = {
    async reconnect(documentId) {
      const leases = activeLeases.get(documentId);
      if (!leases || leases.size === 0) {
        throw new Error(`No active collaboration Provider for ${documentId}`);
      }
      await Promise.all([...leases].map((lease) => lease.reconnect()));
    },
  };

  return {
    control,
    async prepare({ document, replica }) {
      let leases = activeLeases.get(document.id);
      if (!leases) {
        leases = new Set();
        activeLeases.set(document.id, leases);
      }
      let lease: HocuspocusLease;
      lease = new HocuspocusLease(
        document.id,
        replica,
        { ...options, url, initialSyncTimeoutMs },
        () => {
          leases!.delete(lease);
          if (leases!.size === 0) activeLeases.delete(document.id);
        },
      );
      leases.add(lease);
      return lease;
    },
  };
}
