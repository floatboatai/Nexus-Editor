import {
  asDocumentId,
  type CollaborationConnectionAdapter,
  type CollaborationInvitation,
  type CollaborationInvitationAdapter,
  type DocumentId,
} from "@floatboat/nexus-plugin-collab";

import { canonicalCollaborationServerUrl } from "./collaboration-server-url";
import type { ElectronCollabNetworkBridge } from "../shared/collab-network-policy";

const MAX_TEXT_LENGTH = 256;
const MAX_TOKEN_LENGTH = 8_192;
const MAX_INVITATION_LENGTH = 12_288;
const MAX_INVITATION_ERROR_LENGTH = 256;
const MAX_CREDENTIAL_LIFETIME_SECONDS = 3_600;
const DEFAULT_INVITATION_REQUEST_TIMEOUT_MS = 10_000;
const MAX_INVITATION_REQUEST_TIMEOUT_MS = 60_000;

export type CollaborationCredentialRole = "owner" | "editor" | "reader";

export interface CollaborationCredential {
  readonly token: string;
  readonly role: CollaborationCredentialRole;
  readonly userId: string;
}

export interface CollaborationCredentialRegistry {
  /** Activates a defensive copy and returns its identity for compare-and-set rollback. */
  set(documentId: DocumentId, credential: CollaborationCredential): CollaborationCredential;
  get(documentId: DocumentId): CollaborationCredential | undefined;
  resolveToken(documentId: DocumentId): string;
  /** Replaces only the exact active generation observed by the caller. */
  replaceIfCurrent(
    documentId: DocumentId,
    expected: CollaborationCredential,
    replacement: CollaborationCredential | undefined,
  ): boolean;
  clear(documentId: DocumentId): void;
}

export interface CollaborationInvitationEnvelope {
  readonly version: 1;
  readonly serverUrl: string;
  readonly documentId: DocumentId;
  readonly userId: string;
  readonly role: "editor" | "reader";
  readonly token: string;
  /** Integer Unix timestamp in seconds. */
  readonly expiresAt: number;
}

export interface PreparedCollaborationInvitation {
  readonly serverUrl: string;
  readonly documentId: DocumentId;
  readonly userId: string;
  readonly role: "editor" | "reader";
  readonly expiresAt: number;
}

export interface CollaborationInvitationCodecOptions {
  /** Milliseconds since Unix epoch. Defaults to Date.now. */
  readonly now?: () => number;
}

export type CollaborationNetworkErrorCode =
  | "server-not-trusted"
  | "credential-invalid"
  | "credential-unavailable"
  | "delegation-not-authorized"
  | "delegation-outlives-authority"
  | "invitation-invalid"
  | "invitation-expired"
  | "invitation-request-timeout"
  | "invitation-server-mismatch"
  | "invitation-request-failed"
  | "invitation-response-invalid"
  | "pending-credential-unavailable"
  | "reauthentication-in-progress";

export class CollaborationNetworkError extends Error {
  constructor(
    readonly code: CollaborationNetworkErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CollaborationNetworkError";
  }
}

export interface CollaborationProviderReconnectControl {
  reconnect(documentId: DocumentId): Promise<void>;
}

export type CollaborationNetworkFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

/** A Host can issue invitations without exposing a general-purpose fetch capability. */
export type CollaborationInvitationIssuer = (request: {
  readonly serverUrl: string;
  readonly token: string;
  readonly documentId: DocumentId;
  readonly userId: string;
  readonly role: "editor" | "reader";
  readonly lifetimeSeconds: number;
}) => Promise<unknown>;

export function createHostCollaborationInvitationIssuer(
  bridge: Pick<ElectronCollabNetworkBridge, "issueInvitation">,
): CollaborationInvitationIssuer {
  return async (request) => {
    let result: Awaited<ReturnType<ElectronCollabNetworkBridge["issueInvitation"]>>;
    try {
      result = await bridge.issueInvitation(request);
    } catch {
      throw new CollaborationNetworkError("invitation-request-failed", "The trusted Host invitation service is unavailable");
    }
    if (result?.ok === true) return result.invitation;
    switch (result?.ok === false ? result.error : undefined) {
      case "server-not-trusted":
        throw new CollaborationNetworkError("server-not-trusted", "Configure this endpoint as a trusted server in NEXUS_COLLAB_SERVERS and restart the application.");
      case "delegation-not-authorized":
        throw new CollaborationNetworkError("delegation-not-authorized", "The active collaboration credential is not authorized to create invitations");
      case "delegation-outlives-authority":
        throw new CollaborationNetworkError("delegation-outlives-authority", "The active collaboration credential expires too soon for this invitation");
      case "invitation-request-timeout":
        throw new CollaborationNetworkError("invitation-request-timeout", "Collaboration invitation service did not respond before the deadline");
      case "invitation-response-invalid":
        throw new CollaborationNetworkError("invitation-response-invalid", "Collaboration invitation service returned an invalid response");
      default:
        throw new CollaborationNetworkError("invitation-request-failed", "Could not reach the collaboration invitation service");
    }
  };
}

export interface ElectronCollaborationInvitationAdapter extends CollaborationInvitationAdapter {
  /** Parse before constructing the Provider so the product can choose the invited server. */
  prepareInvitation(value: string): PreparedCollaborationInvitation;
  /** Returns a server only after accept verified that it matches this adapter's canonical server. */
  getAcceptedServerUrl(documentId: DocumentId): string | undefined;
}

export interface ElectronCollaborationConnectionAdapter extends CollaborationConnectionAdapter {
  /** Stage a user-supplied refresh credential; it remains memory-only until reauthentication. */
  stageCredential(documentId: DocumentId, credential: CollaborationCredential): void;
  clearPendingCredential(documentId: DocumentId): void;
}

function boundedText(value: unknown, field: string): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_TEXT_LENGTH
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new CollaborationNetworkError("credential-invalid", `Invalid ${field}`);
  }
  return value;
}

function credentialToken(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_TOKEN_LENGTH
    || !/^[A-Za-z0-9._~-]+$/u.test(value)
  ) {
    throw new CollaborationNetworkError("credential-invalid", "Invalid collaboration credential");
  }
  return value;
}

function credentialRole(value: unknown): CollaborationCredentialRole {
  if (value !== "owner" && value !== "editor" && value !== "reader") {
    throw new CollaborationNetworkError("credential-invalid", "Invalid collaboration credential role");
  }
  return value;
}

function invitationRole(value: unknown): "editor" | "reader" {
  if (value !== "editor" && value !== "reader") {
    throw new CollaborationNetworkError("invitation-invalid", "Invalid invitation role");
  }
  return value;
}

function safeCredential(value: CollaborationCredential): CollaborationCredential {
  return Object.freeze({
    token: credentialToken(value.token),
    role: credentialRole(value.role),
    userId: boundedText(value.userId, "credential userId"),
  });
}

function safeDocumentId(value: unknown, code: "credential-invalid" | "invitation-invalid"): DocumentId {
  try {
    return asDocumentId(boundedText(value, "DocumentId"));
  } catch (cause) {
    if (cause instanceof CollaborationNetworkError && cause.code !== code) {
      throw new CollaborationNetworkError(code, "Invalid collaboration DocumentId");
    }
    throw cause;
  }
}

export function createMemoryCollaborationCredentialRegistry(): CollaborationCredentialRegistry {
  const credentials = new Map<DocumentId, CollaborationCredential>();
  const registry: CollaborationCredentialRegistry = {
    set(documentId, credential) {
      const active = safeCredential(credential);
      credentials.set(safeDocumentId(documentId, "credential-invalid"), active);
      return active;
    },
    get(documentId) {
      return credentials.get(documentId);
    },
    resolveToken(documentId) {
      const credential = credentials.get(documentId);
      if (!credential) {
        throw new CollaborationNetworkError(
          "credential-unavailable",
          `No active collaboration credential is available for ${documentId}`,
        );
      }
      return credential.token;
    },
    replaceIfCurrent(documentId, expected, replacement) {
      const safeId = safeDocumentId(documentId, "credential-invalid");
      if (credentials.get(safeId) !== expected) return false;
      if (replacement) credentials.set(safeId, safeCredential(replacement));
      else credentials.delete(safeId);
      return true;
    },
    clear(documentId) {
      credentials.delete(documentId);
    },
  };
  return Object.freeze(registry);
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  code: "invitation-invalid" | "invitation-response-invalid",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CollaborationNetworkError(code, "Collaboration invitation payload is invalid");
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new CollaborationNetworkError(code, "Collaboration invitation payload has invalid fields");
  }
  return value as Record<string, unknown>;
}

function clockNow(options: CollaborationInvitationCodecOptions): number {
  const value = (options.now ?? Date.now)();
  if (!Number.isFinite(value)) throw new TypeError("Invitation clock must return finite milliseconds");
  return value;
}

function serverUrl(value: unknown, code: "invitation-invalid" | "credential-invalid"): string {
  try {
    return canonicalCollaborationServerUrl(value);
  } catch {
    throw new CollaborationNetworkError(code, "Invalid collaboration server URL");
  }
}

function safeExpiry(
  value: unknown,
  options: CollaborationInvitationCodecOptions,
  code: "invitation-invalid" | "invitation-response-invalid",
): number {
  if (!Number.isSafeInteger(value)) {
    throw new CollaborationNetworkError(code, "Invalid collaboration invitation expiry");
  }
  const expiresAt = value as number;
  const nowSeconds = Math.floor(clockNow(options) / 1_000);
  if (expiresAt <= nowSeconds) {
    throw new CollaborationNetworkError("invitation-expired", "Collaboration invitation has expired");
  }
  if (expiresAt > nowSeconds + MAX_CREDENTIAL_LIFETIME_SECONDS) {
    throw new CollaborationNetworkError(code, "Collaboration invitation expiry exceeds its bound");
  }
  return expiresAt;
}

function safeEnvelope(
  value: unknown,
  options: CollaborationInvitationCodecOptions,
): CollaborationInvitationEnvelope {
  const record = exactObject(value, [
    "version",
    "serverUrl",
    "documentId",
    "userId",
    "role",
    "token",
    "expiresAt",
  ], "invitation-invalid");
  if (record.version !== 1) {
    throw new CollaborationNetworkError("invitation-invalid", "Unsupported collaboration invitation version");
  }
  let token: string;
  try {
    token = credentialToken(record.token);
  } catch {
    throw new CollaborationNetworkError("invitation-invalid", "Invalid collaboration invitation credential");
  }
  return Object.freeze({
    version: 1,
    serverUrl: serverUrl(record.serverUrl, "invitation-invalid"),
    documentId: safeDocumentId(record.documentId, "invitation-invalid"),
    userId: boundedInvitationText(record.userId, "userId"),
    role: invitationRole(record.role),
    token,
    expiresAt: safeExpiry(record.expiresAt, options, "invitation-invalid"),
  });
}

function boundedInvitationText(value: unknown, field: string): string {
  try {
    return boundedText(value, field);
  } catch {
    throw new CollaborationNetworkError("invitation-invalid", `Invalid invitation ${field}`);
  }
}

export function encodeCollaborationInvitation(
  envelope: CollaborationInvitationEnvelope,
  options: CollaborationInvitationCodecOptions = {},
): string {
  const safe = safeEnvelope(envelope, options);
  const encoded = JSON.stringify({
    version: safe.version,
    serverUrl: safe.serverUrl,
    documentId: safe.documentId,
    userId: safe.userId,
    role: safe.role,
    token: safe.token,
    expiresAt: safe.expiresAt,
  });
  if (encoded.length > MAX_INVITATION_LENGTH) {
    throw new CollaborationNetworkError("invitation-invalid", "Collaboration invitation is too large");
  }
  return encoded;
}

export function decodeCollaborationInvitation(
  value: string,
  options: CollaborationInvitationCodecOptions = {},
): CollaborationInvitationEnvelope {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_INVITATION_LENGTH) {
    throw new CollaborationNetworkError("invitation-invalid", "Collaboration invitation is invalid or too large");
  }
  try {
    return safeEnvelope(JSON.parse(value) as unknown, options);
  } catch (cause) {
    if (cause instanceof CollaborationNetworkError) throw cause;
    throw new CollaborationNetworkError("invitation-invalid", "Collaboration invitation is not valid JSON");
  }
}

interface DelegationResponse {
  readonly token: string;
  readonly tokenId: string;
  readonly expiresAt: number;
  readonly documentId: DocumentId;
  readonly userId: string;
  readonly role: "editor" | "reader";
}

function parseDelegationResponse(
  value: unknown,
  request: { documentId: DocumentId; userId: string; role: "editor" | "reader" },
  options: CollaborationInvitationCodecOptions,
): DelegationResponse {
  const record = exactObject(value, [
    "token",
    "tokenId",
    "expiresAt",
    "documentId",
    "userId",
    "role",
  ], "invitation-response-invalid");
  let token: string;
  let tokenId: string;
  let documentId: DocumentId;
  let userId: string;
  let role: "editor" | "reader";
  try {
    token = credentialToken(record.token);
    tokenId = boundedText(record.tokenId, "tokenId");
    documentId = safeDocumentId(record.documentId, "invitation-invalid");
    userId = boundedText(record.userId, "userId");
    role = invitationRole(record.role);
  } catch {
    throw new CollaborationNetworkError(
      "invitation-response-invalid",
      "Collaboration server returned an invalid invitation credential",
    );
  }
  const expiresAt = safeExpiry(record.expiresAt, options, "invitation-response-invalid");
  if (documentId !== request.documentId || userId !== request.userId || role !== request.role) {
    throw new CollaborationNetworkError(
      "invitation-response-invalid",
      "Collaboration server returned a credential for a different invitation",
    );
  }
  return Object.freeze({ token, tokenId, expiresAt, documentId, userId, role });
}

function httpInvitationEndpoint(value: string): string {
  const parsed = new URL(value);
  parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
  parsed.pathname = "/v1/invitations";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function defaultInvitationId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new CollaborationNetworkError(
      "invitation-request-failed",
      "A secure invitation id generator is unavailable",
    );
  }
  return globalThis.crypto.randomUUID();
}

async function boundedResponseText(response: Response, maximumBytes: number): Promise<string | undefined> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/u.test(declaredLength)) {
    const size = Number(declaredLength);
    if (!Number.isSafeInteger(size) || size > maximumBytes) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } catch {
    await reader.cancel().catch(() => undefined);
    return undefined;
  } finally {
    reader.releaseLock();
  }
}

async function invitationFailureCode(
  response: Response,
): Promise<"delegation-not-authorized" | "delegation-outlives-authority" | undefined> {
  if (response.status !== 401 && response.status !== 403) return undefined;
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return undefined;
  const body = await boundedResponseText(response, MAX_INVITATION_ERROR_LENGTH);
  if (!body) return undefined;
  try {
    const value = JSON.parse(body) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "error") return undefined;
    const code = Reflect.get(value, "error");
    if (code === "delegation-not-authorized") return code;
    if (response.status === 403 && code === "delegation-outlives-authority") return code;
  } catch {
    // Failure payloads are untrusted; malformed details collapse to the generic safe error.
  }
  return undefined;
}

async function withInvitationRequestDeadline<T>(
  timeoutMs: number,
  exposeSignal: boolean,
  operation: (signal: AbortSignal | undefined) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new CollaborationNetworkError(
        "invitation-request-timeout",
        "Collaboration invitation service did not respond before the deadline",
      ));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(exposeSignal ? controller.signal : undefined), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createCollaborationInvitationAdapter(options: {
  readonly serverUrl: string;
  readonly credentials: CollaborationCredentialRegistry;
  readonly fetch?: CollaborationNetworkFetch;
  readonly issueInvitation?: CollaborationInvitationIssuer;
  readonly now?: () => number;
  readonly idGenerator?: () => string;
  readonly lifetimeSeconds?: number;
  readonly requestTimeoutMs?: number;
}): ElectronCollaborationInvitationAdapter {
  const collaborationServerUrl = serverUrl(options.serverUrl, "credential-invalid");
  const fetchRequest: CollaborationNetworkFetch = options.fetch
    ?? ((input, init) => globalThis.fetch(input, init));
  let defaultFetchAcceptsSignal = true;
  if (!options.fetch && !options.issueInvitation) {
    try {
      // Some DOM test environments combine Node fetch with a different-realm
      // AbortSignal. Omitting only that incompatible signal preserves the
      // deadline without making the request fail before it starts.
      void new Request("https://nexus.invalid/", { signal: new AbortController().signal });
    } catch {
      defaultFetchAcceptsSignal = false;
    }
  }
  const codecOptions = { ...(options.now ? { now: options.now } : {}) };
  const idGenerator = options.idGenerator ?? defaultInvitationId;
  const lifetimeSeconds = options.lifetimeSeconds ?? 300;
  if (
    !Number.isSafeInteger(lifetimeSeconds)
    || lifetimeSeconds < 1
    || lifetimeSeconds > MAX_CREDENTIAL_LIFETIME_SECONDS
  ) {
    throw new RangeError(`lifetimeSeconds must be between 1 and ${MAX_CREDENTIAL_LIFETIME_SECONDS}`);
  }
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_INVITATION_REQUEST_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(requestTimeoutMs)
    || requestTimeoutMs < 1
    || requestTimeoutMs > MAX_INVITATION_REQUEST_TIMEOUT_MS
  ) {
    throw new RangeError(
      `requestTimeoutMs must be between 1 and ${MAX_INVITATION_REQUEST_TIMEOUT_MS}`,
    );
  }
  const acceptedServerUrls = new Map<DocumentId, string>();
  const invitationFromResponse = (
    decoded: unknown,
    request: { readonly documentId: DocumentId; readonly userId: string; readonly role: "editor" | "reader" },
  ): CollaborationInvitation => {
    const delegated = parseDelegationResponse(decoded, request, codecOptions);
    const value = encodeCollaborationInvitation({
      version: 1,
      serverUrl: collaborationServerUrl,
      documentId: delegated.documentId,
      userId: delegated.userId,
      role: delegated.role,
      token: delegated.token,
      expiresAt: delegated.expiresAt,
    }, codecOptions);
    return Object.freeze({
      value,
      role: delegated.role,
      expiresAt: new Date(delegated.expiresAt * 1_000).toISOString(),
    });
  };

  const adapter: ElectronCollaborationInvitationAdapter = {
    prepareInvitation(value) {
      const envelope = decodeCollaborationInvitation(value, codecOptions);
      return Object.freeze({
        serverUrl: envelope.serverUrl,
        documentId: envelope.documentId,
        userId: envelope.userId,
        role: envelope.role,
        expiresAt: envelope.expiresAt,
      });
    },

    getAcceptedServerUrl(documentId) {
      return acceptedServerUrls.get(documentId);
    },

    async create({ documentId, role }): Promise<CollaborationInvitation> {
      const active = options.credentials.get(documentId);
      if (!active) {
        throw new CollaborationNetworkError(
          "credential-unavailable",
          `No active collaboration credential is available for ${documentId}`,
        );
      }
      if (active.role !== "owner" && active.role !== "editor") {
        throw new CollaborationNetworkError(
          "delegation-not-authorized",
          "Only a collaboration owner or editor credential can delegate invitations",
        );
      }
      const userId = boundedInvitationText(idGenerator(), "userId");
      const request = { documentId, userId, role, lifetimeSeconds } as const;
      return withInvitationRequestDeadline(
        requestTimeoutMs,
        Boolean(options.fetch) || defaultFetchAcceptsSignal,
        async (signal) => {
          if (options.issueInvitation) {
            let decoded: unknown;
            try {
              decoded = await options.issueInvitation({
                ...request,
                serverUrl: collaborationServerUrl,
                token: active.token,
              });
            } catch (cause) {
              if (cause instanceof CollaborationNetworkError) throw cause;
              throw new CollaborationNetworkError(
                "invitation-request-failed",
                "Could not reach the collaboration invitation service",
              );
            }
            return invitationFromResponse(decoded, request);
          }
          let response: Response;
          try {
            response = await fetchRequest(httpInvitationEndpoint(collaborationServerUrl), {
              method: "POST",
              redirect: "error",
              cache: "no-store",
              credentials: "omit",
              referrerPolicy: "no-referrer",
              ...(signal ? { signal } : {}),
              headers: {
                authorization: `Bearer ${active.token}`,
                "content-type": "application/json",
                accept: "application/json",
              },
              body: JSON.stringify(request),
            });
          } catch (cause) {
            throw new CollaborationNetworkError(
              "invitation-request-failed",
              "Could not reach the collaboration invitation service",
              cause,
            );
          }
          if (response.status !== 201) {
            const failureCode = await invitationFailureCode(response);
            if (failureCode === "delegation-not-authorized") {
              throw new CollaborationNetworkError(
                failureCode,
                "The active collaboration credential is not authorized to create invitations",
              );
            }
            if (failureCode === "delegation-outlives-authority") {
              throw new CollaborationNetworkError(
                failureCode,
                "The active collaboration credential expires too soon for this invitation",
              );
            }
            throw new CollaborationNetworkError(
              "invitation-request-failed",
              `Collaboration invitation service rejected the request with status ${response.status}`,
            );
          }
          const contentType = response.headers.get("content-type")
            ?.split(";", 1)[0]
            ?.trim()
            .toLowerCase();
          if (contentType !== "application/json") {
            throw new CollaborationNetworkError(
              "invitation-response-invalid",
              "Collaboration invitation service returned a non-JSON response",
            );
          }
          const body = await boundedResponseText(response, MAX_INVITATION_LENGTH);
          if (!body) {
            throw new CollaborationNetworkError(
              "invitation-response-invalid",
              "Collaboration invitation service response exceeded its bound",
            );
          }
          let decoded: unknown;
          try {
            decoded = JSON.parse(body) as unknown;
          } catch {
            throw new CollaborationNetworkError(
              "invitation-response-invalid",
              "Collaboration invitation service returned invalid JSON",
            );
          }
          return invitationFromResponse(decoded, request);
        },
      );
    },

    async accept(value) {
      const envelope = decodeCollaborationInvitation(value, codecOptions);
      if (envelope.serverUrl !== collaborationServerUrl) {
        throw new CollaborationNetworkError(
          "invitation-server-mismatch",
          "This invitation belongs to a different collaboration server",
        );
      }
      options.credentials.set(envelope.documentId, {
        token: envelope.token,
        role: envelope.role,
        userId: envelope.userId,
      });
      acceptedServerUrls.set(envelope.documentId, envelope.serverUrl);
      return Object.freeze({
        document: Object.freeze({ id: envelope.documentId, hostIdentity: collaborationServerUrl }),
        access: envelope.role,
      });
    },
  };
  return Object.freeze(adapter);
}

export function createCollaborationConnectionAdapter(options: {
  readonly credentials: CollaborationCredentialRegistry;
  readonly control: CollaborationProviderReconnectControl;
}): ElectronCollaborationConnectionAdapter {
  interface PendingCredential {
    readonly credential: CollaborationCredential;
    readonly generation: number;
  }
  interface ReauthenticationFlight {
    readonly generation: number;
    readonly task: Promise<{ readonly access: "owner" | "editor" | "reader" }>;
  }

  const pending = new Map<DocumentId, PendingCredential>();
  const generations = new Map<DocumentId, number>();
  const flights = new Map<DocumentId, ReauthenticationFlight>();
  const adapter: ElectronCollaborationConnectionAdapter = {
    stageCredential(documentId, credential) {
      const safeId = safeDocumentId(documentId, "credential-invalid");
      const generation = (generations.get(safeId) ?? 0) + 1;
      generations.set(safeId, generation);
      pending.set(safeId, { credential: safeCredential(credential), generation });
    },
    clearPendingCredential(documentId) {
      pending.delete(documentId);
    },
    reconnect(documentId) {
      return options.control.reconnect(documentId);
    },
    async reauthenticate(documentId) {
      const safeId = safeDocumentId(documentId, "credential-invalid");
      const next = pending.get(safeId);
      if (!next) {
        throw new CollaborationNetworkError(
          "pending-credential-unavailable",
          `No pending collaboration credential is available for ${safeId}`,
        );
      }

      const currentFlight = flights.get(safeId);
      if (currentFlight) {
        if (currentFlight.generation === next.generation) return currentFlight.task;
        throw new CollaborationNetworkError(
          "reauthentication-in-progress",
          `Another collaboration reauthentication is already in progress for ${safeId}`,
        );
      }

      const previous = options.credentials.get(safeId);
      const attempted = options.credentials.set(safeId, next.credential);
      const task = (async () => {
        try {
          await options.control.reconnect(safeId);
        } catch (cause) {
          options.credentials.replaceIfCurrent(safeId, attempted, previous);
          throw cause;
        }
        if (pending.get(safeId)?.generation === next.generation) pending.delete(safeId);
        return Object.freeze({ access: next.credential.role });
      })();
      const flight = { generation: next.generation, task };
      flights.set(safeId, flight);
      void task.finally(() => {
        if (flights.get(safeId) === flight) flights.delete(safeId);
      }).catch(() => undefined);
      return task;
    },
  };
  return Object.freeze(adapter);
}
