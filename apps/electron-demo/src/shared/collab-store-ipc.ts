/** Electron/Node-free runtime schema shared by main, preload, renderer, and tests. */

import type { ReplicaStoreCheckpoint } from "@floatboat/nexus-plugin-collab";

const MAX_ID_LENGTH = 256;
const MAX_UPDATE_BYTES = 4 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;
const MAX_ERROR_TEXT = 512;

export type CollabStoreOperation =
  | "open"
  | "load"
  | "append"
  | "flush"
  | "replace-snapshot"
  | "close";

export type CollabStoreRequest =
  | { readonly operation: "open"; readonly documentId: string }
  | { readonly operation: "load"; readonly leaseId: string }
  | { readonly operation: "append"; readonly leaseId: string; readonly update: Uint8Array }
  | { readonly operation: "flush"; readonly leaseId: string }
  | {
      readonly operation: "replace-snapshot";
      readonly leaseId: string;
      readonly update: Uint8Array;
      readonly through: ReplicaStoreCheckpoint;
    }
  | { readonly operation: "close"; readonly leaseId: string };

export interface CollabStoreFailure {
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
}

export type CollabStoreResponseByOperation = {
  readonly open: { readonly ok: true; readonly leaseId: string } | CollabStoreFailure;
  readonly load: {
    readonly ok: true;
    readonly updates: readonly Uint8Array[];
    readonly checkpoint: ReplicaStoreCheckpoint;
  } | CollabStoreFailure;
  readonly append: { readonly ok: true; readonly checkpoint: ReplicaStoreCheckpoint } | CollabStoreFailure;
  readonly flush: { readonly ok: true } | CollabStoreFailure;
  readonly "replace-snapshot": {
    readonly ok: true;
    readonly checkpoint: ReplicaStoreCheckpoint;
  } | CollabStoreFailure;
  readonly close: { readonly ok: true } | CollabStoreFailure;
};

export type CollabStoreResponse<O extends CollabStoreOperation = CollabStoreOperation> =
  CollabStoreResponseByOperation[O];

export class CollabStoreIpcSchemaError extends TypeError {
  readonly code = "collab-store-ipc-invalid";

  constructor(message: string) {
    super(message);
    this.name = "CollabStoreIpcSchemaError";
  }
}

function fail(message: string): never {
  throw new CollabStoreIpcSchemaError(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} contains unexpected or missing fields`);
  }
}

function boundedString(value: unknown, label: string, maximum = MAX_ID_LENGTH): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail(`${label} must be a bounded non-empty string`);
  }
  return value;
}

function binary(value: unknown, label: string, maximum = MAX_UPDATE_BYTES): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength > maximum) {
    fail(`${label} must be a non-empty Uint8Array no larger than ${maximum} bytes`);
  }
  return new Uint8Array(value);
}

function checkpoint(value: unknown): ReplicaStoreCheckpoint {
  const parsed = record(value, "Replica Store checkpoint");
  exactKeys(parsed, ["generation", "sequence"], "Replica Store checkpoint");
  const generation = boundedString(parsed.generation, "checkpoint generation");
  if (typeof parsed.sequence !== "number" || !Number.isSafeInteger(parsed.sequence) || parsed.sequence < 0) {
    fail("checkpoint sequence must be a non-negative safe integer");
  }
  return Object.freeze({ generation, sequence: parsed.sequence });
}

export function parseCollabStoreRequest(value: unknown): CollabStoreRequest {
  const parsed = record(value, "Collaboration Store request");
  const operation = parsed.operation;
  if (operation === "open") {
    exactKeys(parsed, ["operation", "documentId"], "Collaboration Store open request");
    return { operation, documentId: boundedString(parsed.documentId, "documentId") };
  }
  if (
    operation !== "load" &&
    operation !== "append" &&
    operation !== "flush" &&
    operation !== "replace-snapshot" &&
    operation !== "close"
  ) {
    fail("Unsupported Collaboration Store operation");
  }
  const withUpdate = operation === "append" || operation === "replace-snapshot";
  exactKeys(
    parsed,
    operation === "replace-snapshot"
      ? ["operation", "leaseId", "update", "through"]
      : withUpdate
        ? ["operation", "leaseId", "update"]
        : ["operation", "leaseId"],
    `Collaboration Store ${operation} request`,
  );
  const leaseId = boundedString(parsed.leaseId, "leaseId");
  if (operation === "replace-snapshot") {
    return {
      operation,
      leaseId,
      update: binary(parsed.update, "snapshot", MAX_SNAPSHOT_BYTES),
      through: checkpoint(parsed.through),
    };
  }
  return operation === "append"
    ? { operation, leaseId, update: binary(parsed.update, "update") }
    : { operation, leaseId };
}

function failure(value: Record<string, unknown>): CollabStoreFailure {
  exactKeys(value, ["ok", "error"], "Collaboration Store failure");
  const error = record(value.error, "Collaboration Store error");
  exactKeys(error, ["code", "message"], "Collaboration Store error");
  return {
    ok: false,
    error: {
      code: boundedString(error.code, "error code", 128),
      message: boundedString(error.message, "error message", MAX_ERROR_TEXT),
    },
  };
}

export function parseCollabStoreResponse<O extends CollabStoreOperation>(
  operation: O,
  value: unknown,
): CollabStoreResponseByOperation[O] {
  const parsed = record(value, `Collaboration Store ${operation} response`);
  if (parsed.ok === false) return failure(parsed) as CollabStoreResponseByOperation[O];
  if (parsed.ok !== true) fail("Collaboration Store response must contain a boolean ok field");

  if (operation === "open") {
    exactKeys(parsed, ["ok", "leaseId"], "Collaboration Store open response");
    return { ok: true, leaseId: boundedString(parsed.leaseId, "leaseId") } as CollabStoreResponseByOperation[O];
  }
  if (operation === "load") {
    exactKeys(parsed, ["ok", "updates", "checkpoint"], "Collaboration Store load response");
    if (!Array.isArray(parsed.updates)) fail("Collaboration Store load updates must be an array");
    return {
      ok: true,
      updates: parsed.updates.map((update) => binary(update, "stored update")),
      checkpoint: checkpoint(parsed.checkpoint),
    } as unknown as CollabStoreResponseByOperation[O];
  }
  if (operation === "append" || operation === "replace-snapshot") {
    exactKeys(parsed, ["ok", "checkpoint"], `Collaboration Store ${operation} response`);
    return { ok: true, checkpoint: checkpoint(parsed.checkpoint) } as CollabStoreResponseByOperation[O];
  }
  exactKeys(parsed, ["ok"], `Collaboration Store ${operation} response`);
  return { ok: true } as CollabStoreResponseByOperation[O];
}

export interface ElectronCollabStoreBridge {
  request<O extends CollabStoreOperation>(
    request: Extract<CollabStoreRequest, { readonly operation: O }>,
  ): Promise<CollabStoreResponseByOperation[O]>;
}
