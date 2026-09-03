export interface CollaborationNetworkConfiguration {
  readonly serverUrls: readonly string[];
}

export interface CollaborationInvitationRequest {
  readonly serverUrl: string;
  readonly token: string;
  readonly documentId: string;
  readonly userId: string;
  readonly role: "reader" | "editor";
  readonly lifetimeSeconds: number;
}

export interface CollaborationInvitation {
  readonly token: string;
  readonly tokenId: string;
  readonly expiresAt: number;
  readonly documentId: string;
  readonly userId: string;
  readonly role: "reader" | "editor";
}

export type CollaborationInvitationResult =
  | { readonly ok: true; readonly invitation: CollaborationInvitation }
  | { readonly ok: false; readonly error: string };

export interface ElectronCollabNetworkBridge {
  getConfiguration(): Promise<CollaborationNetworkConfiguration>;
  issueInvitation(request: CollaborationInvitationRequest): Promise<CollaborationInvitationResult>;
}

export const COLLAB_NETWORK_CHANNELS = {
  configuration: "nexus:collab-network:configuration",
  issueInvitation: "nexus:collab-network:issue-invitation",
} as const;

const MAX_SERVER_URL_LENGTH = 2_048;
const MAX_SERVERS = 16;

function isLoopbackHostname(value: string): boolean {
  const hostname = value.toLowerCase();
  if (hostname === "localhost" || hostname === "localhost." || hostname.endsWith(".localhost")) return true;
  if (hostname === "[::1]") return true;
  const octets = hostname.split(".");
  return octets.length === 4 && octets[0] === "127"
    && octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255);
}

/** Canonical endpoints, not origins or wildcard patterns, are the authority. */
export function canonicalCollaborationServerUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_SERVER_URL_LENGTH
    || /[\s\\*?#;'",]/u.test(value)) {
    throw new TypeError("Collaboration server URL is invalid");
  }
  let parsed: URL;
  try {
    if (/[\s\\*?#;'",]/u.test(decodeURIComponent(value))) throw new TypeError();
    parsed = new URL(value);
  } catch { throw new TypeError("Collaboration server URL is invalid"); }
  if ((parsed.protocol !== "ws:" && parsed.protocol !== "wss:")
    || parsed.username || parsed.password
    || (parsed.protocol === "ws:" && !isLoopbackHostname(parsed.hostname))) {
    throw new TypeError("Collaboration server must use wss:, except for ws: on loopback");
  }
  const canonical = parsed.toString();
  return parsed.pathname === "/" ? canonical.slice(0, -1) : canonical;
}

export function parseCollaborationNetworkConfiguration(value: string | undefined): CollaborationNetworkConfiguration {
  const entries = (value ?? "ws://127.0.0.1:1234").split(",");
  if (entries.length > MAX_SERVERS) throw new TypeError("Too many collaboration servers");
  return Object.freeze({ serverUrls: Object.freeze([...new Set(entries.map((entry) => canonicalCollaborationServerUrl(entry.trim())))]) });
}

export function collaborationContentSecurityPolicy(configuration: CollaborationNetworkConfiguration, devUrl?: string): string {
  // CSP gates destinations by origin; exact endpoint selection is separately
  // enforced by the Host and the renderer before creating a Provider.
  const endpoints = configuration.serverUrls.map((value) => new URL(canonicalCollaborationServerUrl(value)).origin);
  if (devUrl) {
    const dev = new URL(devUrl);
    if (dev.protocol !== "http:" || !isLoopbackHostname(dev.hostname) || dev.username || dev.password || dev.search || dev.hash) {
      throw new TypeError("Development renderer must use loopback HTTP");
    }
    endpoints.push(`ws://${dev.host}`);
  }
  return "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; "
    + "style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data: nexus-vault:; "
    + `connect-src 'self' ${[...new Set(endpoints)].join(" ")}; object-src 'none'; base-uri 'none'; form-action 'none';`;
}
