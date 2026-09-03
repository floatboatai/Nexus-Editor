import { Server as HocuspocusServer, type Connection } from "@hocuspocus/server";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isIP, type Socket } from "node:net";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import * as Y from "yjs";

import {
  CollaborationTokenError,
  createCollaborationTokenAuthority,
  type CollaborationRole,
  type CollaborationTokenAuthority,
  type CollaborationTokenClaims,
} from "./auth";
import {
  createFileDocumentStore,
  createFileTokenRevocationStore,
  type FileDocumentStore,
} from "./file-store";
import {
  documentOperationKey,
  DocumentOperationGate,
  tokenOperationKey,
} from "./document-operation-gate";

const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;
const DEFAULT_MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_AUTHENTICATED_QUEUE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_AUTHENTICATED_QUEUE_MESSAGES = 8;
const DEFAULT_MAX_AWARENESS_BYTES = 16 * 1024;
const DEFAULT_MAX_INVITATION_BODY_BYTES = 4 * 1024;
const DEFAULT_MAX_INVITATION_LIFETIME_SECONDS = 15 * 60;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const MAX_PERSISTENCE_WAITERS_PER_DOCUMENT = 64;

interface ConnectionContext extends CollaborationTokenClaims {}

interface PersistenceWaiter {
  readonly generation: number;
  readonly resolve: () => void;
  readonly reject: (cause: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface PersistenceSignal {
  observedGeneration: number;
  persistedGeneration: number;
  failure?: {
    readonly generation: number;
    readonly cause: unknown;
  };
  readonly waiters: Set<PersistenceWaiter>;
}

interface HeldMessageOperation {
  readonly releases: Array<() => void>;
}

interface TrackedAuthenticatedFrame {
  count: number;
  readonly bytes: number;
}

interface AuthenticatedQueueState {
  pendingBytes: number;
  pendingMessages: number;
  closed: boolean;
  readonly frames: Map<Uint8Array, TrackedAuthenticatedFrame>;
}

export interface CollaborationServerOptions {
  readonly address?: string;
  readonly port?: number;
  readonly storageDirectory: string;
  readonly authSecret: string | Uint8Array;
  readonly tokenIssuer?: string;
  readonly tokenAudience?: string;
  readonly maxMessageBytes?: number;
  /** Maximum encoded Yjs state retained for one document. Defaults to 8 MiB. */
  readonly maxDocumentBytes?: number;
  /** Maximum bytes waiting inside one authenticated document connection. Defaults to 2 MiB. */
  readonly maxAuthenticatedQueueBytes?: number;
  /** Maximum messages waiting inside one authenticated document connection. Defaults to 8. */
  readonly maxAuthenticatedQueueMessages?: number;
  readonly maxAwarenessBytes?: number;
  readonly persistenceDebounceMs?: number;
  readonly persistenceMaxDebounceMs?: number;
  /** Maximum graceful shutdown wait before forced resource release. Defaults to 5 seconds. */
  readonly shutdownTimeoutMs?: number;
  readonly invitationMaximumBodyBytes?: number;
  readonly invitationMaximumLifetimeSeconds?: number;
  /** Exact HTTP(S) origins allowed to call the invitation endpoint. `null` represents file://. */
  readonly invitationAllowedOrigins?: readonly string[];
}

export interface CollaborationServerInspection {
  readonly running: boolean;
  readonly documents: number;
  readonly connections: number;
}

export interface CollaborationServer {
  readonly tokens: CollaborationTokenAuthority;
  readonly websocketUrl: string;
  readonly httpUrl: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  revokeToken(tokenId: string, expiresAt?: number): Promise<void>;
  /**
   * Wait until the server has durably stored every document generation it had
   * observed at invocation; updates still in network transit are outside that watermark.
   */
  waitForPersistence(documentId: string, timeoutMs?: number): Promise<void>;
  inspect(): CollaborationServerInspection;
}

function positiveInteger(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function portNumber(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) {
    throw new TypeError("port must be an integer between 0 and 65535");
  }
  return value;
}

function isLoopbackAddress(value: string): boolean {
  const address = value.toLowerCase();
  if (address === "localhost" || address === "localhost." || address === "::1") return true;
  return isIP(address) === 4 && address.split(".", 1)[0] === "127";
}

function normalizedInvitationOrigin(value: string): string {
  if (value === "null") return value;
  if (value.length === 0 || value.length > 2_048 || value.trim() !== value) {
    throw new TypeError("invitationAllowedOrigins contains an invalid origin");
  }
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      || parsed.username.length > 0
      || parsed.password.length > 0
      || parsed.pathname !== "/"
      || parsed.search.length > 0
      || parsed.hash.length > 0
      || parsed.origin === "null"
    ) {
      throw new Error("invalid origin");
    }
    return parsed.origin;
  } catch {
    throw new TypeError("invitationAllowedOrigins contains an invalid origin");
  }
}

function normalizedInvitationOrigins(
  values: readonly string[] | undefined,
  address: string,
): readonly string[] {
  const configured = values ?? (isLoopbackAddress(address) ? ["null"] : []);
  return Object.freeze([...new Set(configured.map(normalizedInvitationOrigin))]);
}

function isAllowedInvitationPreflight(request: IncomingMessage): boolean {
  if (request.headers["access-control-request-method"] !== "POST") return false;
  const requested = request.headers["access-control-request-headers"];
  if (requested === undefined) return true;
  if (typeof requested !== "string" || requested.length === 0 || requested.length > 512) {
    return false;
  }
  const allowed = new Set(["authorization", "content-type"]);
  const headers = requested.split(",");
  return headers.every((header) => {
    const name = header.trim().toLowerCase();
    return name.length > 0 && allowed.has(name);
  });
}

function authFailure(cause: unknown): never {
  const code = cause instanceof CollaborationTokenError && cause.code === "expired" ? 4401 : 4403;
  const reason = cause instanceof CollaborationTokenError ? `authentication-${cause.code}` : "authentication-failed";
  throw { code, reason };
}

class InvitationRequestError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 405 | 413 | 415,
    readonly code: string,
  ) {
    super(code);
  }
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function parseBearer(request: IncomingMessage): string {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string") {
    throw new InvitationRequestError(401, "authentication-required");
  }
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/u.exec(authorization);
  if (!match || match[1]!.length > 8_192) {
    throw new InvitationRequestError(401, "authentication-invalid");
  }
  return match[1]!;
}

async function readInvitationBody(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<Record<string, unknown>> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new InvitationRequestError(415, "content-type-required");
  }
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    request.resume();
    throw new InvitationRequestError(413, "invitation-body-too-large");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > maximumBytes) {
      request.resume();
      throw new InvitationRequestError(413, "invitation-body-too-large");
    }
    chunks.push(bytes);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid body");
    return value as Record<string, unknown>;
  } catch {
    throw new InvitationRequestError(400, "invitation-body-invalid");
  }
}

function invitationText(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 256
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new InvitationRequestError(400, "invitation-body-invalid");
  }
  return value;
}

function invitationRole(value: unknown): CollaborationRole {
  if (value !== "reader" && value !== "editor") {
    throw new InvitationRequestError(400, "invitation-body-invalid");
  }
  return value;
}

function invitationLifetime(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new InvitationRequestError(400, "invitation-lifetime-invalid");
  }
  return value as number;
}

function assertContextActive(
  context: ConnectionContext,
  documentName: string,
  revoked: { has(tokenId: string): Promise<boolean> },
): Promise<void> {
  return (async () => {
    if (!context || context.documentId !== documentName) {
      throw { code: 4403, reason: "authorization-document-mismatch" };
    }
    if (context.expiresAt <= Math.floor(Date.now() / 1_000)) {
      throw { code: 4401, reason: "authorization-expired" };
    }
    if (await revoked.has(context.tokenId)) {
      throw { code: 4403, reason: "authorization-revoked" };
    }
  })();
}

function sanitizeAwareness(
  states: Map<number, Record<string, unknown>>,
  context: ConnectionContext,
  maximumBytes: number,
): void {
  if (states.size > 64) throw { code: 4403, reason: "awareness-state-limit" };
  for (const [clientId, state] of states) {
    let encoded: string;
    try {
      encoded = JSON.stringify(state);
    } catch {
      states.delete(clientId);
      continue;
    }
    if (Buffer.byteLength(encoded, "utf8") > maximumBytes) {
      throw { code: 4403, reason: "awareness-payload-limit" };
    }
    if (!Array.isArray(state.nexusPresence)) continue;
    state.nexusPresence = state.nexusPresence.slice(0, 32).map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      return { ...(entry as Record<string, unknown>), userId: context.userId };
    });
  }
}

class CollaborationServerImpl implements CollaborationServer {
  readonly tokens: CollaborationTokenAuthority;
  private readonly store: FileDocumentStore;
  private readonly revocations: ReturnType<typeof createFileTokenRevocationStore>;
  private readonly persistenceSignals = new Map<string, PersistenceSignal>();
  private readonly documentOperations = new DocumentOperationGate();
  private readonly authenticatedQueues = new WeakMap<
    Connection<ConnectionContext>,
    AuthenticatedQueueState
  >();
  private readonly heldMessageOperations = new WeakMap<
    Connection<ConnectionContext>,
    HeldMessageOperation
  >();
  private server: HocuspocusServer<ConnectionContext> | null = null;
  private lifecycleTail: Promise<void> = Promise.resolve();
  private readonly sockets = new Set<Socket>();
  private readonly connectionExpiryTimers = new Map<
    Connection<ConnectionContext>,
    ReturnType<typeof setTimeout>
  >();
  private activeServerEpoch = 0;
  private nextServerEpoch = 0;
  private shutdownPersistenceFailures: Set<unknown> | null = null;

  private scheduleConnectionExpiration(
    connection: Connection<ConnectionContext>,
    expiresAt: number,
  ): void {
    const existing = this.connectionExpiryTimers.get(connection);
    if (existing) clearTimeout(existing);
    const delay = Math.max(0, expiresAt * 1_000 - Date.now());
    const timer = setTimeout(() => {
      this.connectionExpiryTimers.delete(connection);
      connection.close({ code: 4401, reason: "authorization-expired" });
    }, Math.min(delay, 2_147_483_647));
    this.connectionExpiryTimers.set(connection, timer);
  }

  private clearConnectionExpiration(connection: Connection<ConnectionContext>): void {
    const timer = this.connectionExpiryTimers.get(connection);
    if (timer) clearTimeout(timer);
    this.connectionExpiryTimers.delete(connection);
  }

  private persistenceSignal(documentId: string): PersistenceSignal {
    const existing = this.persistenceSignals.get(documentId);
    if (existing) return existing;
    const created: PersistenceSignal = {
      observedGeneration: 0,
      persistedGeneration: 0,
      waiters: new Set(),
    };
    this.persistenceSignals.set(documentId, created);
    return created;
  }

  private recordDocumentChange(documentId: string): void {
    this.persistenceSignal(documentId).observedGeneration += 1;
  }

  private recordPersistence(documentId: string, generation: number): void {
    const signal = this.persistenceSignal(documentId);
    signal.persistedGeneration = Math.max(signal.persistedGeneration, generation);
    if (signal.failure && signal.failure.generation <= signal.persistedGeneration) {
      this.shutdownPersistenceFailures?.delete(signal.failure.cause);
      delete signal.failure;
    }
    for (const waiter of [...signal.waiters]) {
      if (waiter.generation > signal.persistedGeneration) continue;
      signal.waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  private recordPersistenceFailure(documentId: string, generation: number, cause: unknown): void {
    const signal = this.persistenceSignal(documentId);
    if (signal.failure) this.shutdownPersistenceFailures?.delete(signal.failure.cause);
    signal.failure = { generation, cause };
    this.shutdownPersistenceFailures?.add(cause);
    for (const waiter of [...signal.waiters]) {
      if (waiter.generation > generation) continue;
      signal.waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`Server persistence failed for ${documentId}`, { cause }));
    }
  }

  private clearPersistenceSignal(documentId: string, cause: unknown): void {
    const signal = this.persistenceSignals.get(documentId);
    if (!signal) return;
    this.persistenceSignals.delete(documentId);
    for (const waiter of signal.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(cause);
    }
    signal.waiters.clear();
  }

  private clearPersistenceSignals(cause: unknown): void {
    for (const documentId of [...this.persistenceSignals.keys()]) {
      this.clearPersistenceSignal(documentId, cause);
    }
  }

  private async acquireDocumentMessage(
    documentId: string,
    connection: Connection<ConnectionContext>,
  ): Promise<void> {
    const held = this.heldMessageOperations.get(connection);
    if (!held) throw new Error("Document message authorization turn is not held");
    const releaseDocument = await this.documentOperations.acquire(
      documentOperationKey(documentId),
    );
    held.releases.push(releaseDocument);
  }

  private async acquireAuthorizationMessage(
    connection: Connection<ConnectionContext>,
  ): Promise<void> {
    if (this.heldMessageOperations.has(connection)) {
      throw new Error("A collaboration connection cannot process authorized messages concurrently");
    }
    const release = await this.documentOperations.acquire(
      tokenOperationKey(connection.context.tokenId),
    );
    this.heldMessageOperations.set(connection, { releases: [release] });
  }

  private releaseMessageOperation(connection: Connection<ConnectionContext>): void {
    const held = this.heldMessageOperations.get(connection);
    if (!held) return;
    this.heldMessageOperations.delete(connection);
    for (const release of held.releases.reverse()) release();
  }

  private installAuthenticatedQueueBudget(connection: Connection<ConnectionContext>): void {
    if (this.authenticatedQueues.has(connection)) return;
    const state: AuthenticatedQueueState = {
      pendingBytes: 0,
      pendingMessages: 0,
      closed: false,
      frames: new Map(),
    };
    this.authenticatedQueues.set(connection, state);
    const handleMessage = connection.handleMessage.bind(connection);
    connection.handleMessage = (data: Uint8Array): void => {
      if (state.closed) return;
      if (
        state.pendingBytes + data.byteLength > this.options.maxAuthenticatedQueueBytes
        || state.pendingMessages + 1 > this.options.maxAuthenticatedQueueMessages
      ) {
        state.closed = true;
        state.frames.clear();
        state.pendingBytes = 0;
        state.pendingMessages = 0;
        connection.close({ code: 4408, reason: "authenticated-queue-limit" });
        connection.webSocket.close(4408, "authenticated-queue-limit");
        return;
      }
      const tracked = state.frames.get(data);
      if (tracked) {
        tracked.count += 1;
      } else {
        state.frames.set(data, { count: 1, bytes: data.byteLength });
      }
      state.pendingBytes += data.byteLength;
      state.pendingMessages += 1;
      try {
        handleMessage(data);
      } catch (cause) {
        this.completeAuthenticatedMessage(connection, data);
        throw cause;
      }
    };
    connection.onClose(() => {
      state.closed = true;
      state.frames.clear();
      state.pendingBytes = 0;
      state.pendingMessages = 0;
      this.authenticatedQueues.delete(connection);
    });
  }

  private completeAuthenticatedMessage(
    connection: Connection<ConnectionContext>,
    data: Uint8Array,
  ): void {
    const state = this.authenticatedQueues.get(connection);
    const tracked = state?.frames.get(data);
    if (!state || !tracked) return;
    if (tracked.count === 1) state.frames.delete(data);
    else tracked.count -= 1;
    state.pendingBytes = Math.max(0, state.pendingBytes - tracked.bytes);
    state.pendingMessages = Math.max(0, state.pendingMessages - 1);
  }

  private assertDocumentUpdateWithinLimit(document: Y.Doc, update: Uint8Array): void {
    const candidate = new Y.Doc();
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
      Y.applyUpdate(candidate, update);
      if (Y.encodeStateAsUpdate(candidate).byteLength > this.options.maxDocumentBytes) {
        throw { code: 4409, reason: "document-size-limit" };
      }
    } finally {
      candidate.destroy();
    }
  }

  private async handleInvitationRequest(
    request: IncomingMessage,
    response: ServerResponse,
    headers: Record<string, string> = {},
  ): Promise<void> {
    try {
      const bearer = parseBearer(request);
      const body = await readInvitationBody(request, this.options.invitationMaximumBodyBytes);
      const documentId = invitationText(body.documentId);
      const userId = invitationText(body.userId);
      const role = invitationRole(body.role);
      const lifetimeSeconds = invitationLifetime(
        body.lifetimeSeconds,
        this.options.invitationMaximumLifetimeSeconds,
      );
      let delegator: CollaborationTokenClaims;
      try {
        delegator = await this.tokens.verify(bearer, documentId);
      } catch (cause) {
        const status = cause instanceof CollaborationTokenError && cause.code === "wrong-document"
          ? 403
          : 401;
        throw new InvitationRequestError(status, "delegation-not-authorized");
      }
      if (delegator.role !== "editor") {
        throw new InvitationRequestError(403, "delegation-not-authorized");
      }
      if (Math.floor(Date.now() / 1_000) + lifetimeSeconds > delegator.expiresAt) {
        throw new InvitationRequestError(403, "delegation-outlives-authority");
      }
      const issued = await this.tokens.issue({ userId, documentId, role, lifetimeSeconds });
      writeJson(response, 201, { ...issued, documentId, userId, role }, headers);
    } catch (cause) {
      if (cause instanceof InvitationRequestError) {
        writeJson(response, cause.status, { error: cause.code }, headers);
        return;
      }
      writeJson(response, 400, { error: "invitation-body-invalid" }, headers);
    }
  }

  private invitationCorsHeaders(request: IncomingMessage): Record<string, string> | undefined {
    const origin = request.headers.origin;
    if (
      typeof origin !== "string"
      || !this.options.invitationAllowedOrigins.includes(origin)
    ) {
      return undefined;
    }
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST",
      "access-control-allow-headers": "Authorization, Content-Type",
      vary: "Origin",
    };
  }

  constructor(private readonly options: Required<CollaborationServerOptions>) {
    this.store = createFileDocumentStore({
      directory: options.storageDirectory,
      maxDocumentBytes: options.maxDocumentBytes,
    });
    this.revocations = createFileTokenRevocationStore({ directory: options.storageDirectory });
    this.tokens = createCollaborationTokenAuthority({
      secret: options.authSecret,
      issuer: options.tokenIssuer,
      audience: options.tokenAudience,
      revocations: this.revocations,
    });
  }

  get websocketUrl(): string {
    if (!this.server) throw new Error("Collaboration server is not running");
    return `ws://${this.options.address}:${this.server.address.port}`;
  }

  get httpUrl(): string {
    if (!this.server) throw new Error("Collaboration server is not running");
    return `http://${this.options.address}:${this.server.address.port}`;
  }

  private enqueueLifecycle(operation: () => Promise<void>): Promise<void> {
    // Linearize lifecycle requests in call order. A later stop/start is the
    // final requested state even when the preceding listen/destroy is pending.
    const result = this.lifecycleTail.then(operation);
    this.lifecycleTail = result.catch(() => undefined);
    return result;
  }

  start(): Promise<void> {
    return this.enqueueLifecycle(() => this.startOnce());
  }

  private async startOnce(): Promise<void> {
    if (this.server) return;
    await this.store.ensureReady();
    const epoch = ++this.nextServerEpoch;
    this.activeServerEpoch = epoch;
    const server = new HocuspocusServer<ConnectionContext>({
      name: "nexus-collab-reference",
      address: this.options.address,
      port: this.options.port,
      quiet: true,
      stopOnSignals: false,
      debounce: this.options.persistenceDebounceMs,
      maxDebounce: this.options.persistenceMaxDebounceMs,
      unloadImmediately: false,
      // Messages accumulated while authentication is in flight are drained
      // before `connected` can install the authenticated queue gate. Give that
      // bootstrap queue the same strict budget. During the handoff both bounded
      // sets may coexist, so the transient total is at most their sum.
      maxUnauthenticatedQueueSize: Math.min(
        this.options.maxMessageBytes,
        this.options.maxAuthenticatedQueueBytes,
      ),
      maxUnauthenticatedQueueMessages: Math.min(
        128,
        this.options.maxAuthenticatedQueueMessages,
      ),
      maxPendingDocuments: 8,
      websocketOptions: { maxPayload: this.options.maxMessageBytes },
      onAuthenticate: async ({ documentName, token, connectionConfig }) => {
        try {
          const claims = await this.tokens.verify(token, documentName);
          connectionConfig.readOnly = claims.role === "reader";
          return claims;
        } catch (cause) {
          authFailure(cause);
        }
      },
      onTokenSync: async ({ documentName, token, connection }) => {
        try {
          const claims = await this.tokens.verify(token, documentName);
          connection.readOnly = claims.role === "reader";
          connection.context = claims;
          this.scheduleConnectionExpiration(connection, claims.expiresAt);
          return claims;
        } catch (cause) {
          authFailure(cause);
        }
      },
      connected: async ({ connection, context }) => {
        this.installAuthenticatedQueueBudget(connection);
        this.scheduleConnectionExpiration(connection, context.expiresAt);
        connection.onClose(() => this.clearConnectionExpiration(connection));
      },
      beforeHandleMessage: async ({ connection, documentName, update }) => {
        try {
          await this.acquireAuthorizationMessage(connection);
          await assertContextActive(connection.context, documentName, this.revocations);
        } catch (cause) {
          this.completeAuthenticatedMessage(connection, update);
          this.releaseMessageOperation(connection);
          throw cause;
        }
      },
      afterHandleMessage: async ({ connection, update }) => {
        this.completeAuthenticatedMessage(connection, update);
        this.releaseMessageOperation(connection);
      },
      beforeSync: async ({ connection, document, documentName, type, payload }) => {
        if (!connection.readOnly && (type === 1 || type === 2)) {
          await this.acquireDocumentMessage(documentName, connection);
          // Exact Yjs candidate sizing is whole-document work. Yield once while
          // the room lock is held so unrelated sockets and health probes are not
          // starved by a sustained stream of authenticated updates.
          await yieldToEventLoop();
          // Revocation acquires the same token gate. This check therefore has no
          // revoke-to-apply gap: either this update finishes before revokeToken,
          // or it observes the durable revocation before touching the Y.Doc.
          await assertContextActive(connection.context, documentName, this.revocations);
          this.assertDocumentUpdateWithinLimit(document, payload);
        }
      },
      beforeHandleAwareness: async ({ connection, documentName, states }) => {
        if (!connection) throw { code: 4401, reason: "authentication-required" };
        await assertContextActive(connection.context, documentName, this.revocations);
        sanitizeAwareness(states, connection.context, this.options.maxAwarenessBytes);
      },
      onLoadDocument: async ({ documentName }) => {
        return this.store.fetch(documentName);
      },
      onChange: async ({ documentName }) => {
        if (this.activeServerEpoch !== epoch) return;
        this.recordDocumentChange(documentName);
      },
      onStoreDocument: async ({ documentName, document }) => {
        if (this.activeServerEpoch !== epoch) return;
        const generation = this.persistenceSignal(documentName).observedGeneration;
        const state = Y.encodeStateAsUpdate(document);
        try {
          await this.store.store(documentName, state);
        } catch (cause) {
          if (this.activeServerEpoch === epoch) {
            this.recordPersistenceFailure(documentName, generation, cause);
          }
          throw cause;
        }
        if (this.activeServerEpoch !== epoch) return;
        this.recordPersistence(documentName, generation);
      },
      afterUnloadDocument: async ({ documentName }) => {
        if (this.activeServerEpoch !== epoch) return;
        this.clearPersistenceSignal(
          documentName,
          new Error(`Document unloaded before persistence completed for ${documentName}`),
        );
      },
      onRequest: async ({ request, response }) => {
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
        if (request.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/readyz")) {
          response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ status: "ok" }));
          throw null;
        }
        if (url.pathname === "/v1/invitations") {
          const corsHeaders = this.invitationCorsHeaders(request);
          if (request.headers.origin !== undefined && !corsHeaders) {
            request.resume();
            writeJson(response, 403, { error: "origin-not-allowed" });
          } else if (url.search.length > 0) {
            request.resume();
            writeJson(
              response,
              400,
              { error: "query-parameters-not-allowed" },
              corsHeaders,
            );
          } else if (request.method === "OPTIONS") {
            if (!corsHeaders || !isAllowedInvitationPreflight(request)) {
              request.resume();
              writeJson(response, 403, { error: "origin-not-allowed" });
            } else {
              response.writeHead(204, {
                "cache-control": "no-store",
                ...corsHeaders,
                vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
              });
              response.end();
            }
          } else if (request.method !== "POST") {
            writeJson(response, 405, { error: "method-not-allowed" }, {
              ...corsHeaders,
              allow: "POST, OPTIONS",
            });
          } else {
            await this.handleInvitationRequest(request, response, corsHeaders);
          }
          throw null;
        }
      },
    });
    server.httpServer.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.once("close", () => this.sockets.delete(socket));
    });
    try {
      await server.listen();
      this.server = server;
    } catch (cause) {
      if (this.activeServerEpoch === epoch) this.activeServerEpoch = 0;
      await server.destroy().catch(() => undefined);
      throw cause;
    }
  }

  stop(): Promise<void> {
    return this.enqueueLifecycle(() => this.stopOnce());
  }

  private async stopOnce(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    const persistenceFailures = new Set<unknown>();
    for (const signal of this.persistenceSignals.values()) {
      if (signal.failure && signal.failure.generation > signal.persistedGeneration) {
        persistenceFailures.add(signal.failure.cause);
      }
    }
    this.shutdownPersistenceFailures = persistenceFailures;
    const shutdownFailures: unknown[] = [];
    const addFailure = (cause: unknown): void => {
      if (!shutdownFailures.includes(cause)) shutdownFailures.push(cause);
    };
    const attempt = (operation: () => void): void => {
      try {
        operation();
      } catch (cause) {
        addFailure(cause);
      }
    };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      for (const timer of this.connectionExpiryTimers.values()) {
        attempt(() => clearTimeout(timer));
      }
      this.connectionExpiryTimers.clear();
      for (const socket of this.sockets) attempt(() => socket.destroy());
      this.sockets.clear();
      const destroyed = server.destroy().then(
        () => ({ status: "destroyed" as const }),
        (cause: unknown) => ({ status: "failed" as const, cause }),
      );
      const outcome = await Promise.race([
        destroyed,
        new Promise<{ status: "timed-out" }>((resolve) => {
          timeout = setTimeout(
            () => resolve({ status: "timed-out" }),
            this.options.shutdownTimeoutMs,
          );
        }),
      ]);
      if (outcome.status === "failed") addFailure(outcome.cause);
      if (outcome.status !== "destroyed") {
        if (outcome.status === "timed-out") {
          addFailure(new Error(
            `Collaboration server shutdown exceeded ${this.options.shutdownTimeoutMs}ms`,
          ));
        }
        attempt(() => server.hocuspocus.closeConnections());
        for (const [documentName, document] of [...server.hocuspocus.documents]) {
          server.hocuspocus.documents.delete(documentName);
          attempt(() => document.destroy());
        }
        attempt(() => server.hocuspocus.loadingDocuments.clear());
        attempt(() => server.hocuspocus.unloadingDocuments.clear());
        attempt(() => server.httpServer.closeAllConnections());
        attempt(() => server.httpServer.closeIdleConnections());
        attempt(() => server.httpServer.close());
        attempt(() => server.httpServer.removeAllListeners());
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      for (const cause of persistenceFailures) addFailure(cause);
      this.shutdownPersistenceFailures = null;
      this.activeServerEpoch = 0;
      if (this.server === server) this.server = null;
      this.clearPersistenceSignals(new Error("Collaboration server stopped before persistence completed"));
    }
    if (shutdownFailures.length > 0) {
      throw new AggregateError(shutdownFailures, "Collaboration server shutdown failed");
    }
  }

  async revokeToken(tokenId: string, expiresAt?: number): Promise<void> {
    await this.documentOperations.runExclusive(tokenOperationKey(tokenId), async () => {
      await this.tokens.revoke(tokenId, expiresAt);
      if (!this.server) return;
      for (const document of this.server.hocuspocus.documents.values()) {
        for (const connection of document.getConnections() as Connection<ConnectionContext>[]) {
          if (connection.context.tokenId === tokenId) {
            connection.close({ code: 4403, reason: "authorization-revoked" });
          }
        }
      }
    });
  }

  async waitForPersistence(documentId: string, timeoutMs = 5_000): Promise<void> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError("Persistence wait timeout must be a positive safe integer");
    }
    if (!this.server) throw new Error("Collaboration server is not running");
    const signal = this.persistenceSignal(documentId);
    const generation = signal.observedGeneration || 1;
    if (signal.persistedGeneration >= generation) {
      return;
    }
    if (signal.failure && signal.failure.generation >= generation) {
      throw new Error(`Server persistence failed for ${documentId}`, { cause: signal.failure.cause });
    }
    if (signal.waiters.size >= MAX_PERSISTENCE_WAITERS_PER_DOCUMENT) {
      throw new Error(`Too many persistence waiters for ${documentId}`);
    }
    await new Promise<void>((resolve, reject) => {
      let waiter!: PersistenceWaiter;
      const timer = setTimeout(() => {
        signal.waiters.delete(waiter);
        reject(new Error(`Timed out waiting for server persistence of ${documentId}`));
      }, timeoutMs);
      waiter = {
        generation,
        resolve,
        reject,
        timer,
      };
      signal.waiters.add(waiter);
    });
  }

  inspect(): CollaborationServerInspection {
    return {
      running: this.server !== null,
      documents: this.server?.hocuspocus.getDocumentsCount() ?? 0,
      connections: this.server?.hocuspocus.getConnectionsCount() ?? 0,
    };
  }
}

export function createCollaborationServer(options: CollaborationServerOptions): CollaborationServer {
  const address = options.address ?? "127.0.0.1";
  const maxMessageBytes = positiveInteger(
    options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES,
    "maxMessageBytes",
    64 * 1024 * 1024,
  );
  const maxDocumentBytes = positiveInteger(
    options.maxDocumentBytes ?? DEFAULT_MAX_DOCUMENT_BYTES,
    "maxDocumentBytes",
    MAX_DOCUMENT_BYTES,
  );
  const maxAuthenticatedQueueBytes = positiveInteger(
    options.maxAuthenticatedQueueBytes ?? DEFAULT_MAX_AUTHENTICATED_QUEUE_BYTES,
    "maxAuthenticatedQueueBytes",
    64 * 1024 * 1024,
  );
  const maxAuthenticatedQueueMessages = positiveInteger(
    options.maxAuthenticatedQueueMessages ?? DEFAULT_MAX_AUTHENTICATED_QUEUE_MESSAGES,
    "maxAuthenticatedQueueMessages",
    1_024,
  );
  const maxAwarenessBytes = positiveInteger(
    options.maxAwarenessBytes ?? Math.min(DEFAULT_MAX_AWARENESS_BYTES, maxMessageBytes),
    "maxAwarenessBytes",
    maxMessageBytes,
  );
  const persistenceDebounceMs = positiveInteger(
    options.persistenceDebounceMs ?? 250,
    "persistenceDebounceMs",
    60_000,
  );
  const persistenceMaxDebounceMs = positiveInteger(
    options.persistenceMaxDebounceMs ?? 2_000,
    "persistenceMaxDebounceMs",
    120_000,
  );
  if (persistenceMaxDebounceMs < persistenceDebounceMs) {
    throw new TypeError("persistenceMaxDebounceMs must be greater than or equal to persistenceDebounceMs");
  }
  const shutdownTimeoutMs = positiveInteger(
    options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
    "shutdownTimeoutMs",
    120_000,
  );
  const invitationMaximumBodyBytes = positiveInteger(
    options.invitationMaximumBodyBytes ?? DEFAULT_MAX_INVITATION_BODY_BYTES,
    "invitationMaximumBodyBytes",
    64 * 1024,
  );
  const invitationMaximumLifetimeSeconds = positiveInteger(
    options.invitationMaximumLifetimeSeconds ?? DEFAULT_MAX_INVITATION_LIFETIME_SECONDS,
    "invitationMaximumLifetimeSeconds",
    3_600,
  );
  const normalized: Required<CollaborationServerOptions> = {
    address,
    port: portNumber(options.port ?? 1234),
    storageDirectory: options.storageDirectory,
    authSecret: options.authSecret,
    tokenIssuer: options.tokenIssuer ?? "nexus-collab-reference",
    tokenAudience: options.tokenAudience ?? "nexus-collaboration",
    maxMessageBytes,
    maxDocumentBytes,
    maxAuthenticatedQueueBytes,
    maxAuthenticatedQueueMessages,
    maxAwarenessBytes,
    persistenceDebounceMs,
    persistenceMaxDebounceMs,
    shutdownTimeoutMs,
    invitationMaximumBodyBytes,
    invitationMaximumLifetimeSeconds,
    invitationAllowedOrigins: normalizedInvitationOrigins(options.invitationAllowedOrigins, address),
  };
  return new CollaborationServerImpl(normalized);
}
