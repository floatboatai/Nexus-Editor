import type { ReplicaStoreCheckpoint } from "@floatboat/nexus-plugin-collab";

const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,255}$/;
const MAX_APPEND_BYTES = 4 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;

export type CollaborationStoreOperation =
  | "open"
  | "load"
  | "append"
  | "flush"
  | "snapshot"
  | "close";

export type CollaborationStoreRequest =
  | {
      readonly requestId: string;
      readonly operation: "open";
      readonly leaseId: string;
      readonly documentId: string;
    }
  | {
      readonly requestId: string;
      readonly operation: "load" | "flush" | "close";
      readonly leaseId: string;
    }
  | {
      readonly requestId: string;
      readonly operation: "append";
      readonly leaseId: string;
      readonly update: Uint8Array;
    }
  | {
      readonly requestId: string;
      readonly operation: "snapshot";
      readonly leaseId: string;
      readonly update: Uint8Array;
      readonly through: ReplicaStoreCheckpoint;
    };

export type CollaborationStoreResponse =
  | {
      readonly requestId: string;
      readonly ok: true;
      readonly updates?: readonly Uint8Array[];
      readonly checkpoint?: ReplicaStoreCheckpoint;
    }
  | {
      readonly requestId: string;
      readonly ok: false;
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    };

export type CollaborationStoreControlMessage =
  | { readonly type: "drain-request"; readonly drainId: string }
  | { readonly type: "drain-ack"; readonly drainId: string };

/** A deliberately tiny adapter over renderer and Electron MessagePorts. */
export interface CollaborationStoreChannel {
  postMessage(message: unknown): void;
  subscribe(listener: (message: unknown) => void): () => void;
  subscribeClose?(listener: () => void): () => void;
  close(): void;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function documentIdentifier(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    value.trim() !== value
  ) {
    throw new TypeError("documentId is invalid");
  }
  return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} contains unexpected or missing fields`);
  }
}

function bytes(value: unknown, label: string, maximum = MAX_SNAPSHOT_BYTES): Uint8Array {
  let copy: Uint8Array;
  if (value instanceof Uint8Array) copy = new Uint8Array(value);
  else if (ArrayBuffer.isView(value)) {
    copy = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  } else if (
    value instanceof ArrayBuffer ||
    Object.prototype.toString.call(value) === "[object ArrayBuffer]"
  ) {
    copy = new Uint8Array(value as ArrayBuffer).slice();
  } else {
    throw new TypeError(`${label} must be binary data`);
  }
  if (copy.byteLength === 0 || copy.byteLength > maximum) {
    throw new TypeError(`${label} is too large or empty`);
  }
  return copy;
}

function checkpoint(value: unknown): ReplicaStoreCheckpoint {
  const candidate = record(value, "Replica Store checkpoint");
  exactKeys(candidate, ["generation", "sequence"], "Replica Store checkpoint");
  const generation = identifier(candidate.generation, "checkpoint generation");
  if (
    typeof candidate.sequence !== "number" ||
    !Number.isSafeInteger(candidate.sequence) ||
    candidate.sequence < 0
  ) {
    throw new TypeError("checkpoint sequence is invalid");
  }
  return Object.freeze({ generation, sequence: candidate.sequence });
}

export function parseCollaborationStoreRequest(value: unknown): CollaborationStoreRequest {
  const candidate = record(value, "Collaboration Store request");
  const requestId = identifier(candidate.requestId, "requestId");
  const leaseId = identifier(candidate.leaseId, "leaseId");
  switch (candidate.operation) {
    case "open": {
      exactKeys(candidate, ["requestId", "operation", "leaseId", "documentId"], "Store open request");
      const documentId = documentIdentifier(candidate.documentId);
      return { requestId, operation: "open", leaseId, documentId };
    }
    case "load":
    case "flush":
    case "close": {
      exactKeys(candidate, ["requestId", "operation", "leaseId"], `Store ${candidate.operation} request`);
      return { requestId, operation: candidate.operation, leaseId };
    }
    case "append": {
      exactKeys(
        candidate,
        ["requestId", "operation", "leaseId", "update"],
        `Store ${candidate.operation} request`,
      );
      return {
        requestId,
        operation: candidate.operation,
        leaseId,
        update: bytes(
          candidate.update,
          "update",
          MAX_APPEND_BYTES,
        ),
      };
    }
    case "snapshot": {
      exactKeys(
        candidate,
        ["requestId", "operation", "leaseId", "update", "through"],
        "Store snapshot request",
      );
      return {
        requestId,
        operation: "snapshot",
        leaseId,
        update: bytes(candidate.update, "update", MAX_SNAPSHOT_BYTES),
        through: checkpoint(candidate.through),
      };
    }
    default:
      throw new TypeError("Collaboration Store operation is invalid");
  }
}

export function parseCollaborationStoreResponse(value: unknown): CollaborationStoreResponse {
  const candidate = record(value, "Collaboration Store response");
  const requestId = identifier(candidate.requestId, "requestId");
  if (candidate.ok === true) {
    if (candidate.updates !== undefined) {
      exactKeys(candidate, ["requestId", "ok", "updates", "checkpoint"], "Store load response");
      if (!Array.isArray(candidate.updates)) throw new TypeError("Store response updates must be an array");
      return {
        requestId,
        ok: true,
        updates: candidate.updates.map((update) => bytes(update, "update")),
        checkpoint: checkpoint(candidate.checkpoint),
      };
    }
    if (candidate.checkpoint !== undefined) {
      exactKeys(candidate, ["requestId", "ok", "checkpoint"], "Store checkpoint response");
      return { requestId, ok: true, checkpoint: checkpoint(candidate.checkpoint) };
    }
    {
      exactKeys(candidate, ["requestId", "ok"], "Store success response");
      return { requestId, ok: true };
    }
  }
  if (candidate.ok !== false) throw new TypeError("Store response status is invalid");
  exactKeys(candidate, ["requestId", "ok", "error"], "Store failure response");
  const error = record(candidate.error, "Collaboration Store error");
  exactKeys(error, ["code", "message"], "Store failure");
  const code = identifier(error.code, "error code");
  if (typeof error.message !== "string" || error.message.length === 0 || error.message.length > 1_024) {
    throw new TypeError("Store response error message is invalid");
  }
  return { requestId, ok: false, error: { code, message: error.message } };
}

export function parseCollaborationStoreControlMessage(
  value: unknown,
): CollaborationStoreControlMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("type" in value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== "drain-request" && candidate.type !== "drain-ack") {
    throw new TypeError("Collaboration Store control message is invalid");
  }
  exactKeys(candidate, ["type", "drainId"], "Collaboration Store control message");
  return {
    type: candidate.type,
    drainId: identifier(candidate.drainId, "drainId"),
  };
}

export function collaborationStoreErrorResponse(
  requestId: string,
  cause: unknown,
): CollaborationStoreResponse {
  const candidate = cause && typeof cause === "object"
    ? cause as { readonly code?: unknown; readonly message?: unknown }
    : undefined;
  const typed = typeof candidate?.code === "string" && IDENTIFIER.test(candidate.code);
  const rawCode = typed ? candidate.code as string : "store-failed";
  const code = IDENTIFIER.test(rawCode) ? rawCode : "store-failed";
  const rawMessage = typed && typeof candidate?.message === "string"
    ? candidate.message
    : "Collaboration Store operation failed";
  return {
    requestId,
    ok: false,
    error: {
      code,
      message: rawMessage.slice(0, 1_024) || "Collaboration Store operation failed",
    },
  };
}
