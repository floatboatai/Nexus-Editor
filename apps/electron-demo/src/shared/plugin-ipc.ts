/**
 * Shared, runtime-validated IPC contract for the plugin host. This module is
 * deliberately Electron- and Node-free so main, preload, renderer, and tests
 * all consume the same schema.
 */

declare const vaultSessionBrand: unique symbol;
declare const vaultIdBrand: unique symbol;
declare const contentVersionBrand: unique symbol;

export type VaultSessionId = string & { readonly [vaultSessionBrand]: true };
export type VaultId = string & { readonly [vaultIdBrand]: true };
export type IpcContentVersion = string & { readonly [contentVersionBrand]: true };

export interface PluginVaultSession {
  readonly sessionId: VaultSessionId;
  /** Stable opaque identity for persistence partitioning; unlike sessionId it survives reopen. */
  readonly vaultId: VaultId;
  readonly name: string;
}

export interface PluginVaultNode {
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "folder";
  readonly children?: readonly PluginVaultNode[];
}

export interface PluginVaultFile {
  readonly path: string;
  readonly content: string;
  readonly version: IpcContentVersion;
}

export interface PluginVaultBinaryFile {
  readonly path: string;
  readonly content: Uint8Array;
  readonly version: IpcContentVersion;
}

export interface PluginVaultMutation {
  readonly path: string;
  readonly version?: IpcContentVersion;
  readonly operationId: string;
}

export interface PluginVaultProjectionWritePermit {
  readonly permitId: string;
  readonly path: string;
}

export interface PluginVaultProjectionOpeningOwner {
  readonly senderId: number;
  readonly sessionId: VaultSessionId;
}

export interface PluginVaultProjectionOpeningFence {
  readonly operationId: string;
  readonly path: string;
  readonly documentId: string;
  readonly vaultId: VaultId;
  readonly owner: PluginVaultProjectionOpeningOwner;
  readonly state: "precommit" | "committed";
  readonly active: boolean;
}

export interface PluginVaultDeletionFence {
  readonly operationId: string;
  readonly path: string;
}

export interface PluginVaultDeletionFenceStatus extends PluginVaultDeletionFence {
  readonly state: "precommit" | "committed";
}

export interface PluginVaultChangeEvent {
  readonly sessionId: VaultSessionId;
  readonly kind: "create" | "modify" | "rename" | "delete" | "rescan";
  readonly path: string;
  readonly oldPath?: string;
  readonly version?: IpcContentVersion;
  readonly operationId?: string;
  readonly origin: "host" | "external";
}

export interface PluginStorageSnapshot {
  readonly found: boolean;
  /** The original bytes were preserved for explicit recovery and must not be treated as first-run state. */
  readonly corrupt?: boolean;
  readonly revision: number;
  readonly data: unknown;
}

/**
 * Main-process permissions are deliberately narrower than Electron's `shell`
 * API. The host may grant HTTPS navigation and mailto handling independently;
 * a generic system-shell permission is named so it can be reported as
 * unsupported without exposing a command or IPC surface for it.
 */
export const PLUGIN_HOST_PERMISSIONS = Object.freeze({
  externalUrl: "host.external-url.https",
  externalProtocol: "host.external-protocol.mailto",
  systemShell: "host.system-shell",
} as const);

export type PluginHostPermissionId =
  (typeof PLUGIN_HOST_PERMISSIONS)[keyof typeof PLUGIN_HOST_PERMISSIONS];

export type PluginHostPermissionStatus = "granted" | "denied" | "unsupported";

export interface PluginIpcContract {
  readonly "nexus:vault:pick": {
    readonly request: Record<string, never>;
    readonly response: PluginVaultSession | null;
  };
  readonly "nexus:vault:restore": {
    readonly request: Record<string, never>;
    readonly response: PluginVaultSession | null;
  };
  readonly "nexus:vault:close": {
    readonly request: { readonly sessionId: VaultSessionId };
    readonly response: { readonly ok: true };
  };
  readonly "nexus:vault:commit": {
    readonly request: { readonly sessionId: VaultSessionId };
    readonly response: { readonly ok: true };
  };
  readonly "nexus:vault:list": {
    readonly request: { readonly sessionId: VaultSessionId };
    readonly response: readonly PluginVaultNode[];
  };
  readonly "nexus:vault:read": {
    readonly request: { readonly sessionId: VaultSessionId; readonly path: string };
    readonly response: PluginVaultFile;
  };
  readonly "nexus:vault:read-binary": {
    readonly request: { readonly sessionId: VaultSessionId; readonly path: string };
    readonly response: PluginVaultBinaryFile;
  };
  readonly "nexus:vault:read-all": {
    readonly request: { readonly sessionId: VaultSessionId };
    readonly response: readonly PluginVaultFile[];
  };
  readonly "nexus:vault:write": {
    readonly request: {
      readonly sessionId: VaultSessionId;
      readonly path: string;
      readonly content: string;
      readonly expectedVersion?: IpcContentVersion | null;
      readonly operationId?: string;
      readonly projectionWritePermit?: string;
    };
    readonly response: PluginVaultMutation;
  };
  readonly "nexus:vault:write-binary": {
    readonly request: {
      readonly sessionId: VaultSessionId;
      readonly path: string;
      readonly content: Uint8Array;
      readonly expectedVersion?: IpcContentVersion | null;
      readonly operationId?: string;
      readonly projectionWritePermit?: string;
    };
    readonly response: PluginVaultMutation;
  };
  readonly "nexus:vault:create-folder": {
    readonly request: {
      readonly sessionId: VaultSessionId;
      readonly path: string;
      readonly operationId?: string;
    };
    readonly response: PluginVaultMutation;
  };
  readonly "nexus:vault:rename": {
    readonly request: {
      readonly sessionId: VaultSessionId;
      readonly path: string;
      readonly destination: string;
      readonly operationId?: string;
    };
    readonly response: PluginVaultMutation;
  };
  readonly "nexus:vault:trash": {
    readonly request: {
      readonly sessionId: VaultSessionId;
      readonly path: string;
      readonly operationId?: string;
    };
    readonly response: PluginVaultMutation & { readonly recoverable: true };
  };
  readonly "nexus:vault:projection-write-acquire": {
    readonly request: {
      readonly sessionId: VaultSessionId;
      readonly path: string;
      readonly projectionOpeningOperationId?: string;
    };
    readonly response: PluginVaultProjectionWritePermit;
  };
  readonly "nexus:vault:projection-write-release": {
    readonly request: { readonly sessionId: VaultSessionId; readonly permitId: string };
    readonly response: { readonly ok: true };
  };
  readonly "nexus:vault:projection-opening-reserve": {
    readonly request: {
      readonly sessionId: VaultSessionId;
      readonly path: string;
      readonly documentId: string;
      readonly operationId: string;
      readonly recoveryOwner?: PluginVaultProjectionOpeningOwner;
    };
    readonly response: PluginVaultProjectionOpeningFence;
  };
  readonly "nexus:vault:projection-opening-commit": {
    readonly request: {
      readonly sessionId: VaultSessionId;
      readonly path: string;
      readonly documentId: string;
      readonly operationId: string;
    };
    readonly response: PluginVaultProjectionOpeningFence;
  };
  readonly "nexus:vault:projection-opening-list": {
    readonly request: { readonly sessionId: VaultSessionId };
    readonly response: readonly PluginVaultProjectionOpeningFence[];
  };
  readonly "nexus:vault:projection-opening-release": {
    readonly request: {
      readonly sessionId: VaultSessionId;
      readonly path: string;
      readonly documentId: string;
      readonly operationId: string;
    };
    readonly response: { readonly released: boolean };
  };
  readonly "nexus:vault:delete-reserve": {
    readonly request: {
      readonly sessionId: VaultSessionId;
      readonly path: string;
      readonly operationId: string;
      readonly state?: "precommit" | "committed";
    };
    readonly response: PluginVaultDeletionFence;
  };
  readonly "nexus:vault:delete-list": {
    readonly request: { readonly sessionId: VaultSessionId };
    readonly response: readonly PluginVaultDeletionFenceStatus[];
  };
  readonly "nexus:vault:delete-release": {
    readonly request: {
      readonly sessionId: VaultSessionId;
      readonly path: string;
      readonly operationId: string;
    };
    readonly response: { readonly released: boolean };
  };
  readonly "nexus:vault:resource-url": {
    readonly request: { readonly sessionId: VaultSessionId; readonly path: string };
    readonly response: { readonly url: string; readonly registrationId: string };
  };
  readonly "nexus:vault:revoke-resource-url": {
    readonly request: {
      readonly sessionId: VaultSessionId;
      readonly registrationId: string;
    };
    readonly response: { readonly ok: true };
  };
  readonly "nexus:storage:load": {
    readonly request: { readonly pluginId: string };
    readonly response: PluginStorageSnapshot;
  };
  readonly "nexus:storage:save": {
    readonly request: {
      readonly pluginId: string;
      readonly expectedRevision: number;
      readonly data: unknown;
    };
    readonly response:
      | { readonly ok: true; readonly revision: number }
      | { readonly ok: false; readonly revision: number };
  };
  readonly "nexus:secrets:status": {
    readonly request: Record<string, never>;
    readonly response: { readonly status: "unsupported"; readonly reason: string };
  };
  readonly "nexus:host:activate-plugin": {
    readonly request: { readonly pluginId: string };
    readonly response: { readonly instanceCapability: string };
  };
  readonly "nexus:host:revoke-plugin": {
    readonly request: { readonly instanceCapability: string };
    readonly response: { readonly ok: true };
  };
  readonly "nexus:host:open-external": {
    readonly request: { readonly instanceCapability: string; readonly url: string };
    readonly response: { readonly ok: true };
  };
  readonly "nexus:host:shutdown-complete": {
    readonly request: Record<string, never>;
    readonly response: { readonly ok: true };
  };
}

export interface PluginIpcEventContract {
  readonly "nexus:vault:changed": PluginVaultChangeEvent;
  readonly "nexus:host:shutdown": { readonly reason: "window-close" | "app-quit" };
}

export type PluginIpcChannel = keyof PluginIpcContract;
export type PluginIpcEventChannel = keyof PluginIpcEventContract;
export type PluginIpcRequest<C extends PluginIpcChannel> = PluginIpcContract[C]["request"];
export type PluginIpcResponse<C extends PluginIpcChannel> = PluginIpcContract[C]["response"];

export const PLUGIN_IPC_CHANNELS = Object.freeze([
  "nexus:vault:pick",
  "nexus:vault:restore",
  "nexus:vault:close",
  "nexus:vault:commit",
  "nexus:vault:list",
  "nexus:vault:read",
  "nexus:vault:read-binary",
  "nexus:vault:read-all",
  "nexus:vault:write",
  "nexus:vault:write-binary",
  "nexus:vault:create-folder",
  "nexus:vault:rename",
  "nexus:vault:trash",
  "nexus:vault:projection-write-acquire",
  "nexus:vault:projection-write-release",
  "nexus:vault:projection-opening-reserve",
  "nexus:vault:projection-opening-commit",
  "nexus:vault:projection-opening-list",
  "nexus:vault:projection-opening-release",
  "nexus:vault:delete-reserve",
  "nexus:vault:delete-list",
  "nexus:vault:delete-release",
  "nexus:vault:resource-url",
  "nexus:vault:revoke-resource-url",
  "nexus:storage:load",
  "nexus:storage:save",
  "nexus:secrets:status",
  "nexus:host:activate-plugin",
  "nexus:host:revoke-plugin",
  "nexus:host:open-external",
  "nexus:host:shutdown-complete",
] as const satisfies readonly PluginIpcChannel[]);

export interface PluginHostVaultBridge {
  pick(): Promise<PluginVaultSession | null>;
  restore(): Promise<PluginVaultSession | null>;
  close(sessionId: VaultSessionId): Promise<{ readonly ok: true }>;
  /** Confirms that the renderer mirror is ready before the host persists this Vault as recent. */
  commit(sessionId: VaultSessionId): Promise<{ readonly ok: true }>;
  list(sessionId: VaultSessionId): Promise<readonly PluginVaultNode[]>;
  read(sessionId: VaultSessionId, path: string): Promise<PluginVaultFile>;
  readBinary(sessionId: VaultSessionId, path: string): Promise<PluginVaultBinaryFile>;
  readAll(sessionId: VaultSessionId): Promise<readonly PluginVaultFile[]>;
  write(
    sessionId: VaultSessionId,
    path: string,
    content: string,
    options?: {
      readonly expectedVersion?: IpcContentVersion | null;
      readonly operationId?: string;
      readonly projectionWritePermit?: string;
    },
  ): Promise<PluginVaultMutation>;
  writeBinary(
    sessionId: VaultSessionId,
    path: string,
    content: Uint8Array,
    options?: {
      readonly expectedVersion?: IpcContentVersion | null;
      readonly operationId?: string;
      readonly projectionWritePermit?: string;
    },
  ): Promise<PluginVaultMutation>;
  createFolder(
    sessionId: VaultSessionId,
    path: string,
    operationId?: string,
  ): Promise<PluginVaultMutation>;
  rename(
    sessionId: VaultSessionId,
    path: string,
    destination: string,
    operationId?: string,
  ): Promise<PluginVaultMutation>;
  trash(
    sessionId: VaultSessionId,
    path: string,
    operationId?: string,
  ): Promise<PluginVaultMutation & { readonly recoverable: true }>;
  acquireProjectionWrite(
    sessionId: VaultSessionId,
    path: string,
    projectionOpeningOperationId?: string,
  ): Promise<PluginVaultProjectionWritePermit>;
  releaseProjectionWrite(
    sessionId: VaultSessionId,
    permitId: string,
  ): Promise<{ readonly ok: true }>;
  reserveProjectionOpening(
    sessionId: VaultSessionId,
    path: string,
    documentId: string,
    operationId: string,
    recoveryOwner?: PluginVaultProjectionOpeningOwner,
  ): Promise<PluginVaultProjectionOpeningFence>;
  commitProjectionOpening(
    sessionId: VaultSessionId,
    path: string,
    documentId: string,
    operationId: string,
  ): Promise<PluginVaultProjectionOpeningFence>;
  listProjectionOpenings(
    sessionId: VaultSessionId,
  ): Promise<readonly PluginVaultProjectionOpeningFence[]>;
  releaseProjectionOpening(
    sessionId: VaultSessionId,
    path: string,
    documentId: string,
    operationId: string,
  ): Promise<{ readonly released: boolean }>;
  reserveDeletion(
    sessionId: VaultSessionId,
    path: string,
    operationId: string,
    state?: "precommit" | "committed",
  ): Promise<PluginVaultDeletionFence>;
  listDeletionFences(sessionId: VaultSessionId): Promise<readonly PluginVaultDeletionFenceStatus[]>;
  releaseDeletion(
    sessionId: VaultSessionId,
    path: string,
    operationId: string,
  ): Promise<{ readonly released: boolean }>;
  createResourceUrl(
    sessionId: VaultSessionId,
    path: string,
  ): Promise<{ readonly url: string; readonly registrationId: string }>;
  revokeResourceUrl(
    sessionId: VaultSessionId,
    registrationId: string,
  ): Promise<{ readonly ok: true }>;
  onChanged(callback: (event: PluginVaultChangeEvent) => void): () => void;
}

export interface PluginHostBridge {
  readonly vault: PluginHostVaultBridge;
  readonly storage: {
    load(pluginId: string): Promise<PluginStorageSnapshot>;
    save(
      pluginId: string,
      expectedRevision: number,
      data: unknown,
    ): Promise<{ readonly ok: true; readonly revision: number } | { readonly ok: false; readonly revision: number }>;
  };
  readonly secrets: {
    status(): Promise<{ readonly status: "unsupported"; readonly reason: string }>;
  };
  readonly host: {
    activatePlugin(pluginId: string): Promise<{ readonly ok: true }>;
    revokePlugin(pluginId: string): Promise<{ readonly ok: true }>;
    openExternal(pluginId: string, url: string): Promise<{ readonly ok: true }>;
    onShutdown(callback: (event: PluginIpcEventContract["nexus:host:shutdown"]) => void): () => void;
    shutdownComplete(): Promise<{ readonly ok: true }>;
  };
}

export class PluginIpcSchemaError extends TypeError {
  readonly code = "ipc-schema-invalid";

  constructor(
    readonly channel: string,
    readonly direction: "request" | "response" | "event",
    message: string,
  ) {
    super(`${channel} ${direction}: ${message}`);
    this.name = "PluginIpcSchemaError";
  }
}

function fail(channel: string, direction: "request" | "response" | "event", message: string): never {
  throw new PluginIpcSchemaError(channel, direction, message);
}

function record(
  channel: string,
  direction: "request" | "response" | "event",
  value: unknown,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(channel, direction, "expected an object");
  }
  return value as Record<string, unknown>;
}

function stringField(
  channel: string,
  direction: "request" | "response" | "event",
  value: Record<string, unknown>,
  key: string,
  options: { optional?: boolean; nonEmpty?: boolean } = {},
): string | undefined {
  const field = value[key];
  if (field === undefined && options.optional) return undefined;
  if (typeof field !== "string" || (options.nonEmpty !== false && field.length === 0)) {
    fail(channel, direction, `expected ${key} to be a non-empty string`);
  }
  return field;
}

function numberField(
  channel: string,
  direction: "request" | "response" | "event",
  value: Record<string, unknown>,
  key: string,
): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isSafeInteger(field) || field < 0) {
    fail(channel, direction, `expected ${key} to be a non-negative integer`);
  }
  return field;
}

function sessionRequest(channel: string, value: unknown): Record<string, unknown> {
  const parsed = record(channel, "request", value);
  stringField(channel, "request", parsed, "sessionId");
  return parsed;
}

function pathRequest(channel: string, value: unknown): Record<string, unknown> {
  const parsed = sessionRequest(channel, value);
  stringField(channel, "request", parsed, "path");
  return parsed;
}

function assertEmpty(channel: string, direction: "request" | "response", value: unknown): void {
  const parsed = record(channel, direction, value);
  if (Object.keys(parsed).length !== 0) fail(channel, direction, "expected an empty object");
}

function assertOnlyKeys(
  channel: string,
  direction: "request" | "response",
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    fail(channel, direction, `unexpected field ${unexpected}`);
  }
}

function assertVersionedFile(
  channel: string,
  direction: "response",
  value: unknown,
  binary: boolean,
): void {
  const parsed = record(channel, direction, value);
  stringField(channel, direction, parsed, "path");
  stringField(channel, direction, parsed, "version");
  if (binary) {
    if (!(parsed.content instanceof Uint8Array)) fail(channel, direction, "expected content to be Uint8Array");
  } else if (typeof parsed.content !== "string") {
    fail(channel, direction, "expected content to be a string");
  }
}

function assertMutation(channel: string, value: unknown, recoverable = false): void {
  const parsed = record(channel, "response", value);
  stringField(channel, "response", parsed, "path", { nonEmpty: false });
  stringField(channel, "response", parsed, "operationId");
  stringField(channel, "response", parsed, "version", { optional: true });
  if (recoverable && parsed.recoverable !== true) {
    fail(channel, "response", "expected recoverable to equal true");
  }
}

function assertNode(channel: string, value: unknown): void {
  const parsed = record(channel, "response", value);
  stringField(channel, "response", parsed, "name");
  stringField(channel, "response", parsed, "path", { nonEmpty: false });
  if (parsed.kind !== "file" && parsed.kind !== "folder") {
    fail(channel, "response", "expected kind to be file or folder");
  }
  if (parsed.children !== undefined) {
    if (!Array.isArray(parsed.children)) fail(channel, "response", "expected children to be an array");
    for (const child of parsed.children) assertNode(channel, child);
  }
}

function assertProjectionOpeningOwner(
  channel: string,
  direction: "request" | "response",
  value: unknown,
): void {
  const parsed = record(channel, direction, value);
  numberField(channel, direction, parsed, "senderId");
  stringField(channel, direction, parsed, "sessionId");
  assertOnlyKeys(channel, direction, parsed, ["senderId", "sessionId"]);
}

function assertProjectionOpeningFence(channel: string, value: unknown): void {
  const parsed = record(channel, "response", value);
  stringField(channel, "response", parsed, "operationId");
  stringField(channel, "response", parsed, "path");
  stringField(channel, "response", parsed, "documentId");
  stringField(channel, "response", parsed, "vaultId");
  assertProjectionOpeningOwner(channel, "response", parsed.owner);
  if (parsed.state !== "precommit" && parsed.state !== "committed") {
    fail(channel, "response", "expected state to be precommit or committed");
  }
  if (typeof parsed.active !== "boolean") fail(channel, "response", "expected active to be boolean");
  assertOnlyKeys(channel, "response", parsed, [
    "active",
    "documentId",
    "operationId",
    "owner",
    "path",
    "state",
    "vaultId",
  ]);
}

export function parsePluginIpcRequest<C extends PluginIpcChannel>(
  channel: C,
  value: unknown,
): PluginIpcRequest<C> {
  switch (channel) {
    case "nexus:vault:pick":
    case "nexus:vault:restore":
    case "nexus:secrets:status":
    case "nexus:host:shutdown-complete":
      assertEmpty(channel, "request", value);
      break;
    case "nexus:vault:close":
    case "nexus:vault:commit":
    case "nexus:vault:list":
    case "nexus:vault:read-all":
    case "nexus:vault:delete-list":
    case "nexus:vault:projection-opening-list":
      sessionRequest(channel, value);
      break;
    case "nexus:vault:read":
    case "nexus:vault:read-binary":
    case "nexus:vault:resource-url":
      pathRequest(channel, value);
      break;
    case "nexus:vault:projection-write-acquire": {
      const parsed = pathRequest(channel, value);
      stringField(channel, "request", parsed, "projectionOpeningOperationId", { optional: true });
      break;
    }
    case "nexus:vault:revoke-resource-url": {
      const parsed = sessionRequest(channel, value);
      stringField(channel, "request", parsed, "registrationId");
      break;
    }
    case "nexus:vault:write": {
      const parsed = pathRequest(channel, value);
      stringField(channel, "request", parsed, "content", { nonEmpty: false });
      if (parsed.expectedVersion !== null) {
        stringField(channel, "request", parsed, "expectedVersion", { optional: true });
      }
      stringField(channel, "request", parsed, "operationId", { optional: true });
      stringField(channel, "request", parsed, "projectionWritePermit", { optional: true });
      break;
    }
    case "nexus:vault:write-binary": {
      const parsed = pathRequest(channel, value);
      if (!(parsed.content instanceof Uint8Array)) fail(channel, "request", "expected content to be Uint8Array");
      if (parsed.expectedVersion !== null) {
        stringField(channel, "request", parsed, "expectedVersion", { optional: true });
      }
      stringField(channel, "request", parsed, "operationId", { optional: true });
      stringField(channel, "request", parsed, "projectionWritePermit", { optional: true });
      break;
    }
    case "nexus:vault:create-folder": {
      const parsed = pathRequest(channel, value);
      stringField(channel, "request", parsed, "operationId", { optional: true });
      break;
    }
    case "nexus:vault:rename": {
      const parsed = pathRequest(channel, value);
      stringField(channel, "request", parsed, "destination");
      stringField(channel, "request", parsed, "operationId", { optional: true });
      break;
    }
    case "nexus:vault:trash": {
      const parsed = pathRequest(channel, value);
      stringField(channel, "request", parsed, "operationId", { optional: true });
      break;
    }
    case "nexus:vault:projection-write-release": {
      const parsed = sessionRequest(channel, value);
      stringField(channel, "request", parsed, "permitId");
      break;
    }
    case "nexus:vault:projection-opening-reserve": {
      const parsed = pathRequest(channel, value);
      stringField(channel, "request", parsed, "documentId");
      stringField(channel, "request", parsed, "operationId");
      if (parsed.recoveryOwner !== undefined) {
        assertProjectionOpeningOwner(channel, "request", parsed.recoveryOwner);
      }
      break;
    }
    case "nexus:vault:projection-opening-commit":
    case "nexus:vault:projection-opening-release":
    {
      const parsed = pathRequest(channel, value);
      stringField(channel, "request", parsed, "documentId");
      stringField(channel, "request", parsed, "operationId");
      break;
    }
    case "nexus:vault:delete-release": {
      const parsed = pathRequest(channel, value);
      stringField(channel, "request", parsed, "operationId");
      break;
    }
    case "nexus:vault:delete-reserve": {
      const parsed = pathRequest(channel, value);
      stringField(channel, "request", parsed, "operationId");
      if (parsed.state !== undefined && parsed.state !== "precommit" && parsed.state !== "committed") {
        fail(channel, "request", "expected state to be precommit or committed");
      }
      break;
    }
    case "nexus:storage:load": {
      const parsed = record(channel, "request", value);
      stringField(channel, "request", parsed, "pluginId");
      break;
    }
    case "nexus:storage:save": {
      const parsed = record(channel, "request", value);
      stringField(channel, "request", parsed, "pluginId");
      numberField(channel, "request", parsed, "expectedRevision");
      if (!("data" in parsed)) fail(channel, "request", "expected data field");
      break;
    }
    case "nexus:host:open-external": {
      const parsed = record(channel, "request", value);
      stringField(channel, "request", parsed, "instanceCapability");
      stringField(channel, "request", parsed, "url");
      assertOnlyKeys(channel, "request", parsed, ["instanceCapability", "url"]);
      break;
    }
    case "nexus:host:activate-plugin": {
      const parsed = record(channel, "request", value);
      stringField(channel, "request", parsed, "pluginId");
      assertOnlyKeys(channel, "request", parsed, ["pluginId"]);
      break;
    }
    case "nexus:host:revoke-plugin": {
      const parsed = record(channel, "request", value);
      stringField(channel, "request", parsed, "instanceCapability");
      assertOnlyKeys(channel, "request", parsed, ["instanceCapability"]);
      break;
    }
    default:
      fail(String(channel), "request", "unknown channel");
  }
  return value as PluginIpcRequest<C>;
}

export function parsePluginIpcResponse<C extends PluginIpcChannel>(
  channel: C,
  value: unknown,
): PluginIpcResponse<C> {
  switch (channel) {
    case "nexus:vault:pick":
    case "nexus:vault:restore": {
      if (value === null) break;
      const parsed = record(channel, "response", value);
      stringField(channel, "response", parsed, "sessionId");
      stringField(channel, "response", parsed, "vaultId");
      stringField(channel, "response", parsed, "name");
      break;
    }
    case "nexus:vault:close":
    case "nexus:vault:commit":
    case "nexus:vault:revoke-resource-url":
    case "nexus:vault:projection-write-release":
    case "nexus:host:revoke-plugin":
    case "nexus:host:open-external":
    case "nexus:host:shutdown-complete": {
      const parsed = record(channel, "response", value);
      if (parsed.ok !== true) fail(channel, "response", "expected ok to equal true");
      break;
    }
    case "nexus:host:activate-plugin": {
      const parsed = record(channel, "response", value);
      stringField(channel, "response", parsed, "instanceCapability");
      break;
    }
    case "nexus:vault:list":
      if (!Array.isArray(value)) fail(channel, "response", "expected an array");
      for (const node of value) assertNode(channel, node);
      break;
    case "nexus:vault:read":
      assertVersionedFile(channel, "response", value, false);
      break;
    case "nexus:vault:read-binary":
      assertVersionedFile(channel, "response", value, true);
      break;
    case "nexus:vault:read-all":
      if (!Array.isArray(value)) fail(channel, "response", "expected an array");
      for (const file of value) assertVersionedFile(channel, "response", file, false);
      break;
    case "nexus:vault:write":
    case "nexus:vault:write-binary":
    case "nexus:vault:create-folder":
    case "nexus:vault:rename":
      assertMutation(channel, value);
      break;
    case "nexus:vault:trash":
      assertMutation(channel, value, true);
      break;
    case "nexus:vault:projection-write-acquire":
    case "nexus:vault:delete-reserve": {
      const parsed = record(channel, "response", value);
      stringField(channel, "response", parsed, "path");
      stringField(
        channel,
        "response",
        parsed,
        channel === "nexus:vault:projection-write-acquire" ? "permitId" : "operationId",
      );
      break;
    }
    case "nexus:vault:projection-opening-reserve":
    case "nexus:vault:projection-opening-commit":
      assertProjectionOpeningFence(channel, value);
      break;
    case "nexus:vault:projection-opening-release":
    case "nexus:vault:delete-release": {
      const parsed = record(channel, "response", value);
      if (typeof parsed.released !== "boolean") fail(channel, "response", "expected released to be boolean");
      break;
    }
    case "nexus:vault:delete-list": {
      if (!Array.isArray(value)) fail(channel, "response", "expected an array");
      for (const candidate of value) {
        const parsed = record(channel, "response", candidate);
        stringField(channel, "response", parsed, "path");
        stringField(channel, "response", parsed, "operationId");
        if (parsed.state !== "precommit" && parsed.state !== "committed") {
          fail(channel, "response", "expected state to be precommit or committed");
        }
      }
      break;
    }
    case "nexus:vault:projection-opening-list": {
      if (!Array.isArray(value)) fail(channel, "response", "expected an array");
      for (const candidate of value) assertProjectionOpeningFence(channel, candidate);
      break;
    }
    case "nexus:vault:resource-url": {
      const parsed = record(channel, "response", value);
      stringField(channel, "response", parsed, "url");
      stringField(channel, "response", parsed, "registrationId");
      break;
    }
    case "nexus:storage:load": {
      const parsed = record(channel, "response", value);
      if (typeof parsed.found !== "boolean") fail(channel, "response", "expected found to be boolean");
      const revision = numberField(channel, "response", parsed, "revision");
      if (!("data" in parsed)) fail(channel, "response", "expected data field");
      if (parsed.corrupt !== undefined && typeof parsed.corrupt !== "boolean") {
        fail(channel, "response", "expected corrupt to be boolean");
      }
      if (parsed.corrupt === true && (parsed.found || revision !== 0 || parsed.data !== null)) {
        fail(channel, "response", "corrupt storage cannot be reported as available or missing data");
      }
      if (!parsed.found && (revision !== 0 || parsed.data !== null)) {
        fail(channel, "response", "missing storage must have revision zero and null data");
      }
      assertOnlyKeys(channel, "response", parsed, ["found", "corrupt", "revision", "data"]);
      break;
    }
    case "nexus:storage:save": {
      const parsed = record(channel, "response", value);
      if (typeof parsed.ok !== "boolean") fail(channel, "response", "expected ok to be boolean");
      numberField(channel, "response", parsed, "revision");
      break;
    }
    case "nexus:secrets:status": {
      const parsed = record(channel, "response", value);
      if (parsed.status !== "unsupported") fail(channel, "response", "expected unsupported status");
      stringField(channel, "response", parsed, "reason");
      break;
    }
    default:
      fail(String(channel), "response", "unknown channel");
  }
  return value as PluginIpcResponse<C>;
}

export function parsePluginIpcEvent<C extends PluginIpcEventChannel>(
  channel: C,
  value: unknown,
): PluginIpcEventContract[C] {
  const parsed = record(channel, "event", value);
  if (channel === "nexus:vault:changed") {
    stringField(channel, "event", parsed, "sessionId");
    stringField(channel, "event", parsed, "path", { nonEmpty: false });
    stringField(channel, "event", parsed, "oldPath", { optional: true });
    stringField(channel, "event", parsed, "version", { optional: true });
    stringField(channel, "event", parsed, "operationId", { optional: true });
    if (!["create", "modify", "rename", "delete", "rescan"].includes(String(parsed.kind))) {
      fail(channel, "event", "invalid change kind");
    }
    if (parsed.origin !== "host" && parsed.origin !== "external") {
      fail(channel, "event", "invalid change origin");
    }
  } else if (parsed.reason !== "window-close" && parsed.reason !== "app-quit") {
    fail(channel, "event", "invalid shutdown reason");
  }
  return value as PluginIpcEventContract[C];
}
