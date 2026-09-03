import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type CollaborationRole = "reader" | "editor";
export type CollaborationTokenErrorCode =
  | "invalid"
  | "expired"
  | "revoked"
  | "wrong-document"
  | "invalid-claims";

export class CollaborationTokenError extends Error {
  constructor(
    readonly code: CollaborationTokenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CollaborationTokenError";
  }
}

export interface CollaborationTokenClaims {
  readonly userId: string;
  readonly documentId: string;
  readonly role: CollaborationRole;
  readonly tokenId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface IssuedCollaborationToken {
  readonly token: string;
  readonly tokenId: string;
  readonly expiresAt: number;
}

export interface TokenRevocationStore {
  has(tokenId: string): Promise<boolean>;
  add(tokenId: string, expiresAt?: number): Promise<void>;
}

export interface CollaborationTokenAuthority {
  issue(input: {
    readonly userId: string;
    readonly documentId: string;
    readonly role: CollaborationRole;
    readonly lifetimeSeconds: number;
    readonly tokenId?: string;
  }): Promise<IssuedCollaborationToken>;
  verify(token: string, expectedDocumentId: string): Promise<CollaborationTokenClaims>;
  revoke(tokenId: string, expiresAt?: number): Promise<void>;
}

export interface CollaborationTokenAuthorityOptions {
  readonly secret: string | Uint8Array;
  readonly issuer?: string;
  readonly audience?: string;
  readonly maximumLifetimeSeconds?: number;
  readonly now?: () => Date;
  readonly revocations?: TokenRevocationStore;
}

interface WireClaims {
  readonly v: 1;
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly doc: string;
  readonly role: CollaborationRole;
  readonly jti: string;
  readonly iat: number;
  readonly exp: number;
}

const HEADER = Object.freeze({ alg: "HS256", typ: "JWT" });
const DEFAULT_ISSUER = "nexus-collab-reference";
const DEFAULT_AUDIENCE = "nexus-collaboration";
const MAX_TEXT_LENGTH = 256;
const INSECURE_DOCUMENTATION_SECRET = Buffer.from(
  "replace-with-at-least-32-random-bytes",
  "utf8",
);

function asSecret(value: string | Uint8Array): Uint8Array {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : new Uint8Array(value);
  if (bytes.byteLength < 32) throw new TypeError("Collaboration token secret must be at least 32 bytes");
  if (
    bytes.byteLength === INSECURE_DOCUMENTATION_SECRET.byteLength
    && timingSafeEqual(bytes, INSECURE_DOCUMENTATION_SECRET)
  ) {
    throw new TypeError("Collaboration token secret must not be the public documentation placeholder");
  }
  return bytes;
}

function boundedText(value: unknown, field: string): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_TEXT_LENGTH
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new CollaborationTokenError("invalid-claims", `Invalid ${field}`);
  }
  return value;
}

function parseRole(value: unknown): CollaborationRole {
  if (value !== "reader" && value !== "editor") {
    throw new CollaborationTokenError("invalid-claims", "Invalid collaboration role");
  }
  return value;
}

function asInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new CollaborationTokenError("invalid-claims", `Invalid ${field}`);
  }
  return value as number;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function sign(secret: Uint8Array, value: string): Buffer {
  return createHmac("sha256", secret).update(value).digest();
}

function createMemoryRevocations(): TokenRevocationStore {
  const revoked = new Map<string, number | undefined>();
  return {
    async has(tokenId) {
      return revoked.has(tokenId);
    },
    async add(tokenId, expiresAt) {
      revoked.set(tokenId, expiresAt);
    },
  };
}

export function createCollaborationTokenAuthority(
  options: CollaborationTokenAuthorityOptions,
): CollaborationTokenAuthority {
  const secret = asSecret(options.secret);
  const issuer = boundedText(options.issuer ?? DEFAULT_ISSUER, "issuer");
  const audience = boundedText(options.audience ?? DEFAULT_AUDIENCE, "audience");
  const maxLifetime = options.maximumLifetimeSeconds ?? 3_600;
  if (!Number.isSafeInteger(maxLifetime) || maxLifetime < 1) {
    throw new TypeError("maximumLifetimeSeconds must be a positive integer");
  }
  const now = options.now ?? (() => new Date());
  const revocations = options.revocations ?? createMemoryRevocations();

  return {
    async issue(input) {
      const userId = boundedText(input.userId, "userId");
      const documentId = boundedText(input.documentId, "documentId");
      const role = parseRole(input.role);
      const tokenId = boundedText(input.tokenId ?? randomUUID(), "tokenId");
      if (
        !Number.isSafeInteger(input.lifetimeSeconds)
        || input.lifetimeSeconds < 1
        || input.lifetimeSeconds > maxLifetime
      ) {
        throw new CollaborationTokenError("invalid-claims", "Invalid token lifetime");
      }
      const issuedAt = Math.floor(now().getTime() / 1_000);
      const expiresAt = issuedAt + input.lifetimeSeconds;
      const claims: WireClaims = {
        v: 1,
        iss: issuer,
        aud: audience,
        sub: userId,
        doc: documentId,
        role,
        jti: tokenId,
        iat: issuedAt,
        exp: expiresAt,
      };
      const body = `${encodeJson(HEADER)}.${encodeJson(claims)}`;
      return {
        token: `${body}.${sign(secret, body).toString("base64url")}`,
        tokenId,
        expiresAt,
      };
    },

    async verify(token, expectedDocumentId) {
      try {
        const expectedDocument = boundedText(expectedDocumentId, "expectedDocumentId");
        if (typeof token !== "string" || token.length > 8_192) {
          throw new CollaborationTokenError("invalid", "Invalid collaboration credential");
        }
        const segments = token.split(".");
        if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) {
          throw new CollaborationTokenError("invalid", "Invalid collaboration credential");
        }
        const [encodedHeader, encodedClaims, encodedSignature] = segments as [string, string, string];
        const header = decodeJson(encodedHeader) as Record<string, unknown>;
        if (header.alg !== HEADER.alg || header.typ !== HEADER.typ) {
          throw new CollaborationTokenError("invalid", "Unsupported collaboration credential");
        }
        const body = `${encodedHeader}.${encodedClaims}`;
        const expectedSignature = sign(secret, body);
        const actualSignature = Buffer.from(encodedSignature, "base64url");
        if (
          actualSignature.byteLength !== expectedSignature.byteLength
          || !timingSafeEqual(actualSignature, expectedSignature)
        ) {
          throw new CollaborationTokenError("invalid", "Invalid collaboration credential");
        }

        const raw = decodeJson(encodedClaims) as Partial<WireClaims>;
        if (raw.v !== 1 || raw.iss !== issuer || raw.aud !== audience) {
          throw new CollaborationTokenError("invalid", "Invalid collaboration credential claims");
        }
        const claims: CollaborationTokenClaims = {
          userId: boundedText(raw.sub, "subject"),
          documentId: boundedText(raw.doc, "documentId"),
          role: parseRole(raw.role),
          tokenId: boundedText(raw.jti, "tokenId"),
          issuedAt: asInteger(raw.iat, "issuedAt"),
          expiresAt: asInteger(raw.exp, "expiresAt"),
        };
        const nowSeconds = Math.floor(now().getTime() / 1_000);
        if (claims.issuedAt > nowSeconds || claims.expiresAt <= claims.issuedAt) {
          throw new CollaborationTokenError("invalid-claims", "Invalid collaboration credential time range");
        }
        if (claims.expiresAt <= nowSeconds) {
          throw new CollaborationTokenError("expired", "Collaboration credential expired");
        }
        if (claims.documentId !== expectedDocument) {
          throw new CollaborationTokenError("wrong-document", "Credential is not valid for this document");
        }
        if (await revocations.has(claims.tokenId)) {
          throw new CollaborationTokenError("revoked", "Collaboration credential was revoked");
        }
        return claims;
      } catch (cause) {
        if (cause instanceof CollaborationTokenError) throw cause;
        throw new CollaborationTokenError("invalid", "Invalid collaboration credential");
      }
    },

    async revoke(tokenId, expiresAt) {
      await revocations.add(boundedText(tokenId, "tokenId"), expiresAt);
    },
  };
}
