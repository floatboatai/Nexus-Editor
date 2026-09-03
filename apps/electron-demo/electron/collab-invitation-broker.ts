import {
  canonicalCollaborationServerUrl,
  type CollaborationInvitation,
  type CollaborationInvitationRequest,
  type CollaborationInvitationResult,
  type CollaborationNetworkConfiguration,
} from "../src/shared/collab-network-policy";

interface InvitationBrokerOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

const MAX_CLOCK_SKEW_SECONDS = 30;

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) throw new TypeError();
  return record;
}

function boundedText(value: unknown, maximum = 256): string {
  if (typeof value !== "string" || !value || value.length > maximum || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError();
  return value;
}

function invitationRequest(raw: unknown): CollaborationInvitationRequest {
  const value = exactRecord(raw, ["serverUrl", "token", "documentId", "userId", "role", "lifetimeSeconds"]);
  if (value.role !== "reader" && value.role !== "editor") throw new TypeError();
  if (!Number.isSafeInteger(value.lifetimeSeconds) || Number(value.lifetimeSeconds) <= 0 || Number(value.lifetimeSeconds) > 3_600) throw new TypeError();
  const serverUrl = canonicalCollaborationServerUrl(value.serverUrl);
  if (serverUrl !== value.serverUrl) throw new TypeError();
  const token = boundedText(value.token, 8_192);
  if (/[^\x21-\x7e]/u.test(token)) throw new TypeError();
  return { serverUrl, token, documentId: boundedText(value.documentId), userId: boundedText(value.userId), role: value.role, lifetimeSeconds: Number(value.lifetimeSeconds) };
}

function parseInvitation(raw: unknown, request: CollaborationInvitationRequest, nowSeconds: number): CollaborationInvitation {
  const value = exactRecord(raw, ["token", "tokenId", "expiresAt", "documentId", "userId", "role"]);
  if (value.documentId !== request.documentId || value.userId !== request.userId || value.role !== request.role
    || !Number.isSafeInteger(value.expiresAt) || Number(value.expiresAt) <= nowSeconds
    || Number(value.expiresAt) > nowSeconds + request.lifetimeSeconds + MAX_CLOCK_SKEW_SECONDS) throw new TypeError();
  return {
    token: boundedText(value.token, 8_192), tokenId: boundedText(value.tokenId), expiresAt: Number(value.expiresAt),
    documentId: request.documentId, userId: request.userId, role: request.role,
  };
}

async function boundedResponseJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
    || Number(response.headers.get("content-length") ?? 0) > 16_384 || !response.body) throw new TypeError();
  const reader = response.body.getReader();
  const cancel = (): void => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) throw new TypeError();
      chunks.push(value);
    }
    if (signal.aborted) throw new TypeError();
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}

/** Fixed-operation network authority; renderer-supplied fetch options never cross this boundary. */
export class CollaborationInvitationBroker {
  private readonly servers: ReadonlySet<string>;
  private readonly fetchRequest: typeof fetch;
  private readonly pending = new Map<number, Set<AbortController>>();

  constructor(configuration: CollaborationNetworkConfiguration, private readonly options: InvitationBrokerOptions = {}) {
    this.servers = new Set(configuration.serverUrls.map(canonicalCollaborationServerUrl));
    // Node fetch, not Electron net/session.fetch: no renderer session cookie jar.
    this.fetchRequest = options.fetch ?? fetch;
  }

  closeSender(senderId: number): void {
    for (const controller of this.pending.get(senderId) ?? []) controller.abort();
    this.pending.delete(senderId);
  }

  async issueInvitation(senderId: number, raw: unknown): Promise<CollaborationInvitationResult> {
    let request: CollaborationInvitationRequest;
    try { request = invitationRequest(raw); } catch { return { ok: false, error: "invitation-request-invalid" }; }
    if (!this.servers.has(request.serverUrl)) return { ok: false, error: "server-not-trusted" };
    const senderPending = this.pending.get(senderId) ?? new Set<AbortController>();
    if (senderPending.size >= 2) return { ok: false, error: "invitation-request-busy" };
    const controller = new AbortController();
    senderPending.add(controller);
    this.pending.set(senderId, senderPending);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.options.timeoutMs ?? 10_000);
    const cancelled = new Promise<CollaborationInvitationResult>((resolve) => {
      controller.signal.addEventListener("abort", () => resolve({
        ok: false, error: timedOut ? "invitation-request-timeout" : "invitation-request-cancelled",
      }), { once: true });
    });
    try {
      return await Promise.race([this.requestInvitation(request, controller.signal), cancelled]);
    } catch {
      return { ok: false, error: "invitation-request-failed" };
    } finally {
      clearTimeout(timer);
      controller.abort();
      senderPending.delete(controller);
      if (senderPending.size === 0 && this.pending.get(senderId) === senderPending) this.pending.delete(senderId);
    }
  }

  private async requestInvitation(request: CollaborationInvitationRequest, signal: AbortSignal): Promise<CollaborationInvitationResult> {
    const endpoint = new URL(request.serverUrl);
    endpoint.protocol = endpoint.protocol === "wss:" ? "https:" : "http:";
    endpoint.pathname = "/v1/invitations";
    const body = JSON.stringify({ documentId: request.documentId, userId: request.userId, role: request.role, lifetimeSeconds: request.lifetimeSeconds });
    if (Buffer.byteLength(body) > 4_096) return { ok: false, error: "invitation-request-invalid" };
    const response = await this.fetchRequest(endpoint.href, {
      method: "POST", redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { authorization: `Bearer ${request.token}`, "content-type": "application/json", accept: "application/json" },
      body, signal,
    });
    try {
      const decoded = await boundedResponseJson(response, signal);
      if (response.status !== 201 || response.redirected) {
        const code = decoded && typeof decoded === "object" && "error" in decoded ? decoded.error : undefined;
        return { ok: false, error: code === "delegation-not-authorized" || code === "delegation-outlives-authority" ? code : "invitation-request-failed" };
      }
      return { ok: true, invitation: parseInvitation(decoded, request, Math.floor((this.options.now?.() ?? Date.now()) / 1_000)) };
    } catch { return { ok: false, error: "invitation-response-invalid" }; }
  }
}
