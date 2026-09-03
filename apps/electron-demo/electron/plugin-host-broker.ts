import { createHash, randomUUID } from "node:crypto";
import { constants, existsSync, watch, type FSWatcher } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  PLUGIN_HOST_PERMISSIONS,
  type IpcContentVersion,
  type PluginHostPermissionId,
  type PluginHostPermissionStatus,
  type PluginStorageSnapshot,
  type PluginVaultChangeEvent,
  type PluginVaultFile,
  type PluginVaultMutation,
  type PluginVaultNode,
  type PluginVaultProjectionOpeningFence,
  type PluginVaultProjectionOpeningOwner,
  type PluginVaultSession,
  type VaultSessionId,
  type VaultId,
} from "../src/shared/plugin-ipc";

const SUPPORTED_TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", ".svn", ".hg"]);
const SESSION_ID_PATTERN = /^[a-f0-9-]{16,}$/i;
const PLUGIN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;

export type PluginHostBrokerErrorCode =
  | "sender-not-authorized"
  | "host-permission-denied"
  | "host-operation-unsupported"
  | "external-url-invalid"
  | "external-protocol-denied"
  | "vault-session-invalid"
  | "vault-path-invalid"
  | "vault-path-escape"
  | "vault-version-conflict"
  | "vault-delete-reserved"
  | "vault-write-permit-invalid"
  | "vault-projection-opening-conflict"
  | "plugin-id-invalid"
  | "plugin-storage-corrupt"
  | "plugin-storage-read-failed"
  | "plugin-storage-invalid";

export class PluginHostBrokerError extends Error {
  constructor(
    readonly code: PluginHostBrokerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PluginHostBrokerError";
  }
}

export interface SenderIdentity {
  readonly id: number;
  readonly url: string;
}

export interface ExternalNavigationBrokerOptions {
  readonly isSenderAuthorized: (sender: SenderIdentity) => boolean;
  readonly openExternal: (url: string) => Promise<void>;
  readonly resolvePluginPolicy: (pluginId: string) => PluginHostPermissionPolicy | null;
  readonly instanceCapability?: () => string;
}

export interface PluginHostPermissionPolicy {
  /** Permission declarations from the manifest trusted by the main process. */
  readonly declaredPermissions: readonly PluginHostPermissionId[];
  /** User/administrator decisions owned by the main process. */
  readonly grantedPermissions: readonly PluginHostPermissionId[];
}

interface ActivePluginInstance {
  readonly capability: string;
  readonly pluginId: string;
  readonly senderId: number;
  readonly grants: ReadonlySet<PluginHostPermissionId>;
}

const EXTERNAL_PROTOCOL_PERMISSIONS = Object.freeze({
  "https:": PLUGIN_HOST_PERMISSIONS.externalUrl,
  "mailto:": PLUGIN_HOST_PERMISSIONS.externalProtocol,
} as const satisfies Readonly<Record<string, PluginHostPermissionId>>);

export class ElectronExternalNavigationBroker {
  private readonly instances = new Map<string, ActivePluginInstance>();
  private readonly instancesBySender = new Map<number, Map<string, string>>();
  private readonly closedSenders = new Set<number>();

  constructor(private readonly options: ExternalNavigationBrokerOptions) {}

  activatePlugin(sender: SenderIdentity, pluginId: string): string {
    this.assertSender(sender);
    const id = this.normalizePluginId(pluginId);
    const existing = this.instancesBySender.get(sender.id)?.get(id);
    if (existing) return existing;
    const policy = this.options.resolvePluginPolicy(id);
    if (!policy) {
      throw new PluginHostBrokerError(
        "host-permission-denied",
        `Plugin '${id}' is not registered in the main-process plugin manifest registry.`,
      );
    }
    const declared = new Set(policy.declaredPermissions);
    const grants = new Set(policy.grantedPermissions);
    if (grants.has(PLUGIN_HOST_PERMISSIONS.systemShell)) {
      throw new PluginHostBrokerError(
        "host-operation-unsupported",
        "Generic system shell access is not exposed by this host.",
      );
    }
    for (const permission of grants) {
      if (!declared.has(permission)) {
        throw new PluginHostBrokerError(
          "host-permission-denied",
          `External navigation permission '${permission}' was not declared by plugin '${id}'.`,
        );
      }
    }
    const capability = (this.options.instanceCapability ?? randomUUID)();
    if (!SESSION_ID_PATTERN.test(capability) || this.instances.has(capability)) {
      throw new PluginHostBrokerError(
        "host-permission-denied",
        "Plugin instance capability factory returned an invalid or duplicate value.",
      );
    }
    this.instances.set(capability, Object.freeze({
      capability,
      pluginId: id,
      senderId: sender.id,
      grants: Object.freeze(grants),
    }));
    const senderInstances = this.instancesBySender.get(sender.id) ?? new Map<string, string>();
    senderInstances.set(id, capability);
    this.instancesBySender.set(sender.id, senderInstances);
    return capability;
  }

  revokePlugin(sender: SenderIdentity, instanceCapability: string): void {
    this.assertSender(sender);
    const instance = this.requireInstance(sender, instanceCapability);
    this.instances.delete(instance.capability);
    const senderInstances = this.instancesBySender.get(sender.id);
    senderInstances?.delete(instance.pluginId);
    if (senderInstances?.size === 0) this.instancesBySender.delete(sender.id);
  }

  closeSender(senderId: number): void {
    this.closedSenders.add(senderId);
    for (const capability of this.instancesBySender.get(senderId)?.values() ?? []) {
      this.instances.delete(capability);
    }
    this.instancesBySender.delete(senderId);
  }

  permissionStatus(
    sender: SenderIdentity,
    instanceCapability: string,
    permission: PluginHostPermissionId,
  ): PluginHostPermissionStatus {
    if (
      !Number.isSafeInteger(sender.id) ||
      this.closedSenders.has(sender.id) ||
      !this.options.isSenderAuthorized(sender)
    ) return "denied";
    if (permission === PLUGIN_HOST_PERMISSIONS.systemShell) return "unsupported";
    const instance = this.instances.get(instanceCapability);
    return instance?.senderId === sender.id && instance.grants.has(permission) ? "granted" : "denied";
  }

  async open(sender: SenderIdentity, instanceCapability: string, rawUrl: string): Promise<void> {
    this.assertSender(sender);
    const instance = this.requireInstance(sender, instanceCapability);
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new PluginHostBrokerError("external-url-invalid", "External URL is not absolute and valid.");
    }
    const permission = EXTERNAL_PROTOCOL_PERMISSIONS[
      url.protocol as keyof typeof EXTERNAL_PROTOCOL_PERMISSIONS
    ];
    if (!permission) {
      throw new PluginHostBrokerError(
        "external-protocol-denied",
        `External URL protocol '${url.protocol}' is not allowed.`,
      );
    }
    if (!instance.grants.has(permission)) {
      throw new PluginHostBrokerError(
        "host-permission-denied",
        `External navigation permission '${permission}' was not granted to plugin '${instance.pluginId}'.`,
      );
    }
    await this.options.openExternal(url.toString());
  }

  private assertSender(sender: SenderIdentity): void {
    if (
      !Number.isSafeInteger(sender.id) ||
      this.closedSenders.has(sender.id) ||
      !this.options.isSenderAuthorized(sender)
    ) {
      throw new PluginHostBrokerError(
        "sender-not-authorized",
        "IPC sender is not an authorized application window.",
      );
    }
  }

  private requireInstance(sender: SenderIdentity, capability: string): ActivePluginInstance {
    const instance = this.instances.get(capability);
    if (!instance || instance.senderId !== sender.id) {
      throw new PluginHostBrokerError(
        "host-permission-denied",
        "Plugin instance capability is missing, revoked, or belongs to another window.",
      );
    }
    return instance;
  }

  private normalizePluginId(pluginId: string): string {
    const normalized = pluginId.trim().toLowerCase();
    if (!PLUGIN_ID_PATTERN.test(normalized)) {
      throw new PluginHostBrokerError("plugin-id-invalid", "Plugin ID is not valid for host authorization.");
    }
    return normalized;
  }
}

export interface VaultBrokerOptions {
  readonly isSenderAuthorized: (sender: SenderIdentity) => boolean;
  readonly trashItem: (absolutePath: string) => Promise<void>;
  readonly onChange?: (senderId: number, event: PluginVaultChangeEvent) => void;
  readonly watchFactory?: (
    root: string,
    callback: (eventType: string, filename: string | Buffer | null) => void,
  ) => { close(): void };
  readonly operationId?: () => string;
  readonly sessionId?: () => string;
  readonly now?: () => number;
  readonly statPath?: typeof stat;
  readonly lstatPath?: typeof lstat;
  readonly realpathPath?: typeof realpath;
  readonly openPath?: typeof open;
  readonly projectionWritePermitTtlMs?: number;
  readonly projectionOpeningTtlMs?: number;
  readonly setTimeoutFn?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

interface FileIdentity {
  readonly dev: string;
  readonly ino: string;
}

type VaultFileHandle = Awaited<ReturnType<typeof open>>;

interface AuthorizedPathLease {
  readonly session: VaultSessionRecord;
  readonly normalizedPath: string;
  readonly operationPath: string;
  readonly canonicalParent: string;
  readonly parentHandle: VaultFileHandle;
  readonly parentIdentity: FileIdentity;
  readonly leafIdentity: FileIdentity | null;
}

interface PendingEcho {
  readonly operationId: string;
  readonly expiresAt: number;
  readonly versioned: boolean;
  readonly expectedVersion?: IpcContentVersion;
}

interface VaultSessionRecord {
  readonly id: VaultSessionId;
  readonly vaultId: VaultId;
  readonly senderId: number;
  readonly root: string;
  readonly canonicalRoot: string;
  readonly rootIdentity: FileIdentity;
  readonly name: string;
  readonly watcher: { close(): void } | null;
  readonly pendingEchoes: Map<string, PendingEcho>;
  readonly watcherVersions: Map<string, IpcContentVersion>;
  readonly resourceTokens: Set<string>;
  readonly resourceCapability: string;
  watcherSnapshot: Map<string, WatchSnapshotEntry>;
  committed: boolean;
  closed: boolean;
}

interface WatchSnapshotEntry {
  readonly path: string;
  readonly kind: "file" | "folder";
  readonly identity: string;
}

interface ResourceRecord {
  readonly token: string;
  readonly sessionId: VaultSessionId;
  readonly senderId: number;
  readonly vaultPath: string;
}

interface VaultDeletionFenceRecord {
  readonly operationId: string;
  readonly path: string;
  readonly state: "precommit" | "committed";
}

interface ProjectionWritePermitRecord {
  readonly permitId: string;
  readonly vaultId: VaultId;
  readonly senderId: number;
  readonly sessionId: VaultSessionId;
  readonly path: string;
  readonly finishLane: () => void;
  expiryTimer?: ReturnType<typeof setTimeout>;
  activeCalls: number;
  releaseRequested: boolean;
  used: boolean;
}

interface ProjectionOpeningFenceRecord {
  readonly operationId: string;
  readonly vaultId: VaultId;
  readonly ownerSenderId: number;
  readonly ownerSessionId: VaultSessionId;
  senderId: number;
  sessionId: VaultSessionId;
  readonly path: string;
  readonly documentId: string;
  state: "precommit" | "committed";
  expiryTimer?: ReturnType<typeof setTimeout>;
  expired: boolean;
}

function asSessionId(value: string): VaultSessionId {
  return value as VaultSessionId;
}

function asVaultId(value: string): VaultId {
  return value as VaultId;
}

function asVersion(value: string): IpcContentVersion {
  return value as IpcContentVersion;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function fileIdentity(info: { readonly dev: bigint | number; readonly ino: bigint | number }): FileIdentity {
  return Object.freeze({ dev: String(info.dev), ino: String(info.ino) });
}

function stableVaultId(canonicalRoot: string, identity: FileIdentity): VaultId {
  return asVaultId(createHash("sha256")
    .update("nexus-vault-identity-v2\0", "utf8")
    .update(canonicalRoot, "utf8")
    .update("\0", "utf8")
    .update(identity.dev, "utf8")
    .update("\0", "utf8")
    .update(identity.ino, "utf8")
    .digest("hex"));
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isSymbolicLinkLoopError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ELOOP";
}

/** Strict POSIX-style path accepted at the renderer/main trust boundary. */
export function normalizeVaultRelativePath(input: string, allowRoot = false): string {
  if (typeof input !== "string" || input.includes("\0")) {
    throw new PluginHostBrokerError("vault-path-invalid", "Vault path must be a string without NUL bytes.");
  }
  if (input.includes("\\") || path.posix.isAbsolute(input) || /^[a-z]:/i.test(input)) {
    throw new PluginHostBrokerError("vault-path-invalid", "Vault path must be a POSIX-style relative path.");
  }
  if (input === "") {
    if (allowRoot) return "";
    throw new PluginHostBrokerError("vault-path-invalid", "Vault path cannot be empty.");
  }
  const segments = input.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new PluginHostBrokerError("vault-path-invalid", "Vault path cannot contain empty, dot, or parent segments.");
  }
  const normalized = path.posix.normalize(input);
  if (normalized !== input || normalized.startsWith("../")) {
    throw new PluginHostBrokerError("vault-path-invalid", "Vault path is not canonical.");
  }
  return normalized;
}

function relativeFromRoot(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function contentVersion(content: Uint8Array): IpcContentVersion {
  return asVersion(`sha256:${createHash("sha256").update(content).digest("hex")}`);
}

function operationId(factory: () => string, requested?: string): string {
  if (requested !== undefined && requested.trim().length > 0) return requested;
  return factory();
}

function projectionDocumentId(value: string): string {
  if (typeof value !== "string") {
    throw new PluginHostBrokerError(
      "vault-projection-opening-conflict",
      "The collaboration DocumentId must be a string.",
    );
  }
  const normalized = value.trim().normalize("NFC");
  if (normalized.length === 0 || normalized.length > 256 || normalized.includes("\0")) {
    throw new PluginHostBrokerError(
      "vault-projection-opening-conflict",
      "The collaboration DocumentId is invalid.",
    );
  }
  return normalized;
}

function atomicTemporaryPath(target: string): string {
  return path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
}

async function atomicWrite(target: string, data: string | Uint8Array): Promise<void> {
  const temporary = atomicTemporaryPath(target);
  try {
    await writeFile(temporary, data);
    await rename(temporary, target);
  } catch (error) {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(temporary);
    } catch {
      // The original write error is the actionable one.
    }
    throw error;
  }
}

function defaultWatchFactory(
  root: string,
  callback: (eventType: string, filename: string | Buffer | null) => void,
): FSWatcher {
  try {
    return watch(root, { recursive: true }, callback);
  } catch {
    return watch(root, callback);
  }
}

export class ElectronVaultBroker {
  private readonly sessions = new Map<VaultSessionId, VaultSessionRecord>();
  private readonly sessionsBySender = new Map<number, Set<VaultSessionId>>();
  private readonly resources = new Map<string, ResourceRecord>();
  private readonly isSenderAuthorized: VaultBrokerOptions["isSenderAuthorized"];
  private readonly trashItem: VaultBrokerOptions["trashItem"];
  private readonly onChange?: VaultBrokerOptions["onChange"];
  private readonly watchFactory: NonNullable<VaultBrokerOptions["watchFactory"]>;
  private readonly createOperationId: () => string;
  private readonly createSessionId: () => string;
  private readonly now: () => number;
  private readonly statPath: typeof stat;
  private readonly lstatPath: typeof lstat;
  private readonly realpathPath: typeof realpath;
  private readonly openPath: typeof open;
  private readonly projectionWritePermitTtlMs: number;
  private readonly projectionOpeningTtlMs: number;
  private readonly setTimeoutFn: NonNullable<VaultBrokerOptions["setTimeoutFn"]>;
  private readonly clearTimeoutFn: NonNullable<VaultBrokerOptions["clearTimeoutFn"]>;
  private readonly senderGenerations = new Map<number, number>();
  private readonly closedSenders = new Set<number>();
  private readonly mutationTails = new Map<VaultId, Promise<void>>();
  private readonly deletionFences = new Map<VaultId, Map<string, VaultDeletionFenceRecord>>();
  private readonly projectionWritePermits = new Map<string, ProjectionWritePermitRecord>();
  private readonly projectionOpeningFences = new Map<VaultId, Map<string, ProjectionOpeningFenceRecord>>();
  private allGeneration = 0;
  private closedAll = false;

  constructor(options: VaultBrokerOptions) {
    this.isSenderAuthorized = options.isSenderAuthorized;
    this.trashItem = options.trashItem;
    this.onChange = options.onChange;
    this.watchFactory = options.watchFactory ?? defaultWatchFactory;
    this.createOperationId = options.operationId ?? randomUUID;
    this.createSessionId = options.sessionId ?? randomUUID;
    this.now = options.now ?? Date.now;
    this.statPath = options.statPath ?? stat;
    this.lstatPath = options.lstatPath ?? lstat;
    this.realpathPath = options.realpathPath ?? realpath;
    this.openPath = options.openPath ?? open;
    this.projectionWritePermitTtlMs = options.projectionWritePermitTtlMs ?? 30_000;
    this.projectionOpeningTtlMs = options.projectionOpeningTtlMs ?? 60_000;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  async openSession(sender: SenderIdentity, root: string): Promise<PluginVaultSession> {
    this.assertSender(sender);
    const senderGeneration = this.senderGenerations.get(sender.id) ?? 0;
    const allGeneration = this.allGeneration;
    const absoluteRoot = path.resolve(root);
    const info = await this.statPath(absoluteRoot);
    if (!info.isDirectory()) {
      throw new PluginHostBrokerError("vault-path-invalid", "Authorized Vault root is not a directory.");
    }
    const canonicalRoot = await this.realpathPath(absoluteRoot);
    const canonicalRootInfo = await this.statPath(canonicalRoot, { bigint: true });
    if (!canonicalRootInfo.isDirectory()) {
      throw new PluginHostBrokerError("vault-path-invalid", "Authorized Vault root is not a directory.");
    }
    this.assertOpenStillCurrent(sender, senderGeneration, allGeneration);
    const rawId = this.createSessionId();
    if (!SESSION_ID_PATTERN.test(rawId)) {
      throw new PluginHostBrokerError("vault-session-invalid", "Session ID factory returned an invalid identifier.");
    }
    const id = asSessionId(rawId);
    const record: VaultSessionRecord = {
      id,
      vaultId: stableVaultId(canonicalRoot, fileIdentity(canonicalRootInfo)),
      senderId: sender.id,
      root: absoluteRoot,
      canonicalRoot,
      rootIdentity: fileIdentity(canonicalRootInfo),
      name: path.basename(absoluteRoot),
      watcher: null,
      pendingEchoes: new Map(),
      watcherVersions: new Map(),
      resourceTokens: new Set(),
      resourceCapability: randomUUID(),
      watcherSnapshot: await this.captureWatcherSnapshot(absoluteRoot),
      committed: false,
      closed: false,
    };
    this.assertOpenStillCurrent(sender, senderGeneration, allGeneration);
    const watcher = this.watchFactory(absoluteRoot, (eventType, filename) => {
      void this.handleWatcherEvent(record, eventType, filename);
    });
    if (!this.openIsCurrent(sender, senderGeneration, allGeneration)) {
      try { watcher.close(); } catch { /* Nothing else was published yet. */ }
      throw new PluginHostBrokerError("vault-session-invalid", "Vault session open was canceled by host shutdown.");
    }
    Object.assign(record, { watcher });
    this.sessions.set(id, record);
    const senderSessions = this.sessionsBySender.get(sender.id) ?? new Set<VaultSessionId>();
    senderSessions.add(id);
    this.sessionsBySender.set(sender.id, senderSessions);
    return Object.freeze({
      sessionId: id,
      vaultId: record.vaultId,
      name: record.name,
    });
  }

  async acquireProjectionWrite(
    sender: SenderIdentity,
    sessionId: VaultSessionId,
    vaultPath: string,
    projectionOpeningOperationId?: string,
  ): Promise<{ readonly permitId: string; readonly path: string }> {
    const session = this.requireSession(sender, sessionId);
    const normalized = normalizeVaultRelativePath(vaultPath);
    const previous = this.mutationTails.get(session.vaultId) ?? Promise.resolve();
    let finishLane!: () => void;
    const laneHeld = new Promise<void>((resolve) => { finishLane = resolve; });
    const acquired = previous.then(() => {
      this.assertSessionRecordCurrent(session);
      this.assertPathsNotDeletionFenced(session.vaultId, [normalized]);
      this.assertPathsNotProjectionOpeningFenced(
        session,
        [normalized],
        projectionOpeningOperationId,
      );
      let permitId: string;
      do permitId = operationId(this.createOperationId);
      while (this.projectionWritePermits.has(permitId));
      const record: ProjectionWritePermitRecord = {
        permitId,
        vaultId: session.vaultId,
        senderId: sender.id,
        sessionId,
        path: normalized,
        finishLane,
        activeCalls: 0,
        releaseRequested: false,
        used: false,
      };
      this.projectionWritePermits.set(permitId, record);
      record.expiryTimer = this.setTimeoutFn(() => {
        record.releaseRequested = true;
        this.finishProjectionWritePermit(record);
      }, this.projectionWritePermitTtlMs);
      record.expiryTimer.unref?.();
      return Object.freeze({ permitId, path: normalized });
    });
    this.publishMutationTail(session.vaultId, acquired.then(() => laneHeld, () => undefined));
    return acquired;
  }

  reserveProjectionOpening(
    sender: SenderIdentity,
    sessionId: VaultSessionId,
    vaultPath: string,
    rawDocumentId: string,
    requestedOperationId: string,
    recoveryOwner?: PluginVaultProjectionOpeningOwner,
  ): Promise<PluginVaultProjectionOpeningFence> {
    const session = this.requireSession(sender, sessionId);
    const normalized = normalizeVaultRelativePath(vaultPath);
    const documentId = projectionDocumentId(rawDocumentId);
    const openingOperationId = operationId(() => "", requestedOperationId);
    if (recoveryOwner !== undefined && (
      !Number.isSafeInteger(recoveryOwner.senderId) ||
      recoveryOwner.senderId <= 0 ||
      typeof recoveryOwner.sessionId !== "string" ||
      recoveryOwner.sessionId.length === 0
    )) {
      throw new PluginHostBrokerError(
        "vault-projection-opening-conflict",
        "The original projection opening owner is invalid.",
      );
    }
    return this.enqueueMutation(session, () => {
      this.assertPathsNotDeletionFenced(session.vaultId, [normalized]);
      const fences = this.projectionOpeningFences.get(session.vaultId) ??
        new Map<string, ProjectionOpeningFenceRecord>();
      const sameOperation = fences.get(openingOperationId);
      if (sameOperation) {
        if (
          sameOperation.path !== normalized ||
          sameOperation.documentId !== documentId ||
          sameOperation.ownerSenderId !== (recoveryOwner?.senderId ?? sender.id) ||
          sameOperation.ownerSessionId !== (recoveryOwner?.sessionId ?? session.id)
        ) {
          throw new PluginHostBrokerError(
            "vault-projection-opening-conflict",
            "The projection opening operation is no longer valid for this Vault path.",
          );
        }
        const heldByAnotherSession = sameOperation.senderId !== sender.id ||
          sameOperation.sessionId !== session.id;
        if (heldByAnotherSession && !sameOperation.expired) {
          throw new PluginHostBrokerError(
            "vault-projection-opening-conflict",
            "A live renderer still owns this projection opening.",
          );
        }
        if (heldByAnotherSession || sameOperation.expired) {
          if (recoveryOwner === undefined) {
            throw new PluginHostBrokerError(
              "vault-projection-opening-conflict",
              "Rebinding a projection opening requires its exact immutable owner.",
            );
          }
          sameOperation.senderId = sender.id;
          sameOperation.sessionId = session.id;
          sameOperation.expired = false;
          this.armProjectionOpeningFence(sameOperation);
        }
        return this.projectionOpeningStatus(sameOperation);
      }
      if ([...fences.values()].some((fence) => pathsOverlap(fence.path, normalized))) {
        throw new PluginHostBrokerError(
          "vault-projection-opening-conflict",
          "An overlapping collaboration join is already opening this Vault path.",
        );
      }
      const record: ProjectionOpeningFenceRecord = {
        operationId: openingOperationId,
        vaultId: session.vaultId,
        ownerSenderId: recoveryOwner?.senderId ?? sender.id,
        ownerSessionId: recoveryOwner?.sessionId ?? session.id,
        senderId: sender.id,
        sessionId: session.id,
        path: normalized,
        documentId,
        state: "precommit",
        expired: false,
      };
      fences.set(openingOperationId, record);
      this.projectionOpeningFences.set(session.vaultId, fences);
      this.armProjectionOpeningFence(record);
      return this.projectionOpeningStatus(record);
    });
  }

  commitProjectionOpening(
    sender: SenderIdentity,
    sessionId: VaultSessionId,
    vaultPath: string,
    rawDocumentId: string,
    requestedOperationId: string,
  ): Promise<PluginVaultProjectionOpeningFence> {
    const session = this.requireSession(sender, sessionId);
    const normalized = normalizeVaultRelativePath(vaultPath);
    const documentId = projectionDocumentId(rawDocumentId);
    const openingOperationId = operationId(() => "", requestedOperationId);
    return this.enqueueMutation(session, () => {
      const fence = this.projectionOpeningFences.get(session.vaultId)?.get(openingOperationId);
      if (
        !fence ||
        fence.path !== normalized ||
        fence.documentId !== documentId ||
        fence.senderId !== sender.id ||
        fence.sessionId !== session.id ||
        fence.expired
      ) {
        throw new PluginHostBrokerError(
          "vault-projection-opening-conflict",
          "The projection opening cannot be committed without its exact active precommit fence.",
        );
      }
      fence.state = "committed";
      return this.projectionOpeningStatus(fence);
    });
  }

  async listProjectionOpenings(
    sender: SenderIdentity,
    sessionId: VaultSessionId,
  ): Promise<readonly PluginVaultProjectionOpeningFence[]> {
    const session = this.requireSession(sender, sessionId);
    return Object.freeze([...(this.projectionOpeningFences.get(session.vaultId)?.values() ?? [])]
      .map((fence) => this.projectionOpeningStatus(fence)));
  }

  releaseProjectionOpening(
    sender: SenderIdentity,
    sessionId: VaultSessionId,
    vaultPath: string,
    rawDocumentId: string,
    requestedOperationId: string,
  ): Promise<boolean> {
    const session = this.requireSession(sender, sessionId);
    const normalized = normalizeVaultRelativePath(vaultPath);
    const documentId = projectionDocumentId(rawDocumentId);
    const openingOperationId = operationId(() => "", requestedOperationId);
    return this.enqueueMutation(session, () => {
      const fences = this.projectionOpeningFences.get(session.vaultId);
      const fence = fences?.get(openingOperationId);
      if (!fence) return false;
      if (
        fence.path !== normalized ||
        fence.documentId !== documentId ||
        fence.senderId !== sender.id ||
        fence.sessionId !== session.id
      ) {
        throw new PluginHostBrokerError(
          "vault-projection-opening-conflict",
          "The projection opening operation does not match this Vault path and owner.",
        );
      }
      this.removeProjectionOpeningFence(fence);
      return true;
    });
  }

  releaseProjectionWrite(
    sender: SenderIdentity,
    sessionId: VaultSessionId,
    permitId: string,
  ): void {
    const session = this.requireSession(sender, sessionId);
    if (!this.projectionWritePermits.has(permitId)) return;
    const permit = this.requireProjectionWritePermit(sender, session, permitId);
    permit.releaseRequested = true;
    this.finishProjectionWritePermit(permit);
  }

  reserveDeletion(
    sender: SenderIdentity,
    sessionId: VaultSessionId,
    vaultPath: string,
    requestedOperationId: string,
    state: "precommit" | "committed" = "committed",
  ): Promise<{ readonly path: string; readonly operationId: string }> {
    const session = this.requireSession(sender, sessionId);
    const normalized = normalizeVaultRelativePath(vaultPath);
    const reservationOperationId = operationId(() => "", requestedOperationId);
    return this.enqueueMutation(session, () => {
      this.assertPathsNotProjectionOpeningFenced(session, [normalized]);
      const fences = this.deletionFences.get(session.vaultId) ?? new Map<string, VaultDeletionFenceRecord>();
      const sameOperation = fences.get(reservationOperationId);
      if (sameOperation) {
        if (sameOperation.path !== normalized) {
          throw new PluginHostBrokerError(
            "vault-delete-reserved",
            "The deletion operation is already reserved for another Vault path.",
          );
        }
        if (state === "committed" && sameOperation.state === "precommit") {
          fences.set(reservationOperationId, Object.freeze({
            operationId: reservationOperationId,
            path: normalized,
            state: "committed",
          }));
        }
        return Object.freeze({ path: normalized, operationId: reservationOperationId });
      }
      if ([...fences.values()].some((fence) => pathsOverlap(fence.path, normalized))) {
        throw new PluginHostBrokerError(
          "vault-delete-reserved",
          "An overlapping Vault path deletion is already reserved.",
        );
      }
      fences.set(reservationOperationId, Object.freeze({
        operationId: reservationOperationId,
        path: normalized,
        state,
      }));
      this.deletionFences.set(session.vaultId, fences);
      return Object.freeze({ path: normalized, operationId: reservationOperationId });
    });
  }

  async listDeletionFences(
    sender: SenderIdentity,
    sessionId: VaultSessionId,
  ): Promise<readonly {
    readonly path: string;
    readonly operationId: string;
    readonly state: "precommit" | "committed";
  }[]> {
    const session = this.requireSession(sender, sessionId);
    return Object.freeze([...(this.deletionFences.get(session.vaultId)?.values() ?? [])].map((fence) =>
      Object.freeze({ path: fence.path, operationId: fence.operationId, state: fence.state })));
  }

  releaseDeletion(
    sender: SenderIdentity,
    sessionId: VaultSessionId,
    vaultPath: string,
    requestedOperationId: string,
  ): Promise<boolean> {
    const session = this.requireSession(sender, sessionId);
    const normalized = normalizeVaultRelativePath(vaultPath);
    const reservationOperationId = operationId(() => "", requestedOperationId);
    return this.enqueueMutation(session, () => {
      const fences = this.deletionFences.get(session.vaultId);
      const fence = fences?.get(reservationOperationId);
      if (!fence) return false;
      if (fence.path !== normalized) {
        throw new PluginHostBrokerError(
          "vault-delete-reserved",
          "The deletion operation does not match this Vault path.",
        );
      }
      fences!.delete(reservationOperationId);
      if (fences!.size === 0) this.deletionFences.delete(session.vaultId);
      return true;
    });
  }

  closeSession(sender: SenderIdentity, sessionId: VaultSessionId): void {
    const session = this.requireSession(sender, sessionId);
    this.closeRecord(session);
  }

  commitSession(sender: SenderIdentity, sessionId: VaultSessionId): { readonly root: string } {
    const session = this.requireSession(sender, sessionId);
    session.committed = true;
    return Object.freeze({ root: session.root });
  }

  closeSender(senderId: number): void {
    this.closedSenders.add(senderId);
    this.senderGenerations.set(senderId, (this.senderGenerations.get(senderId) ?? 0) + 1);
    for (const sessionId of [...(this.sessionsBySender.get(senderId) ?? [])]) {
      const session = this.sessions.get(sessionId);
      if (session) this.closeRecord(session);
    }
  }

  closeAll(): void {
    this.closedAll = true;
    this.allGeneration += 1;
    for (const session of [...this.sessions.values()]) this.closeRecord(session);
  }

  activeSessionCount(): number {
    return this.sessions.size;
  }

  async list(sender: SenderIdentity, sessionId: VaultSessionId): Promise<readonly PluginVaultNode[]> {
    const session = this.requireSession(sender, sessionId);
    return this.scanDirectory(session, session.root);
  }

  async read(sender: SenderIdentity, sessionId: VaultSessionId, vaultPath: string): Promise<PluginVaultFile> {
    const session = this.requireSession(sender, sessionId);
    const data = await this.readAuthorizedBytes(session, vaultPath);
    return Object.freeze({
      path: normalizeVaultRelativePath(vaultPath),
      content: data.toString("utf8"),
      version: contentVersion(data),
    });
  }

  async readBinary(
    sender: SenderIdentity,
    sessionId: VaultSessionId,
    vaultPath: string,
  ): Promise<{ readonly path: string; readonly content: Uint8Array; readonly version: IpcContentVersion }> {
    const session = this.requireSession(sender, sessionId);
    const data = await this.readAuthorizedBytes(session, vaultPath);
    return Object.freeze({
      path: normalizeVaultRelativePath(vaultPath),
      content: new Uint8Array(data),
      version: contentVersion(data),
    });
  }

  async readAll(sender: SenderIdentity, sessionId: VaultSessionId): Promise<readonly PluginVaultFile[]> {
    const session = this.requireSession(sender, sessionId);
    const relativePaths: string[] = [];
    await this.collectTextFiles(session, session.root, relativePaths);
    const output: PluginVaultFile[] = [];
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < relativePaths.length) {
        const index = cursor++;
        try {
          output[index] = await this.read(sender, sessionId, relativePaths[index]);
        } catch {
          // An external deletion during the snapshot does not fail other files.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(32, relativePaths.length) }, worker));
    return Object.freeze(output.filter(Boolean));
  }

  async write(
    sender: SenderIdentity,
    sessionId: VaultSessionId,
    vaultPath: string,
    data: string | Uint8Array,
    options: {
      readonly expectedVersion?: IpcContentVersion | null;
      readonly operationId?: string;
      readonly projectionWritePermit?: string;
    } = {},
  ): Promise<PluginVaultMutation> {
    const session = this.requireSession(sender, sessionId);
    const normalized = normalizeVaultRelativePath(vaultPath);
    if (options.projectionWritePermit !== undefined) {
      const permit = this.requireProjectionWritePermit(sender, session, options.projectionWritePermit, normalized);
      if (permit.used) {
        throw new PluginHostBrokerError("vault-write-permit-invalid", "Projection write permit was already used.");
      }
      permit.used = true;
      permit.activeCalls += 1;
      try {
        return await this.writeAuthorized(session, normalized, data, options);
      } finally {
        permit.activeCalls -= 1;
        this.finishProjectionWritePermit(permit);
      }
    }
    return this.enqueueMutation(session, () => {
      this.assertPathsNotDeletionFenced(session.vaultId, [normalized]);
      this.assertPathsNotProjectionOpeningFenced(session, [normalized]);
      return this.writeAuthorized(session, normalized, data, options);
    });
  }

  private async writeAuthorized(
    session: VaultSessionRecord,
    normalized: string,
    data: string | Uint8Array,
    options: { readonly expectedVersion?: IpcContentVersion | null; readonly operationId?: string },
  ): Promise<PluginVaultMutation> {
    const lease = await this.acquireAuthorizedPathLease(session, normalized, true);
    try {
      const existed = lease.leafIdentity !== null;
      if (options.expectedVersion === null) {
        if (existed) {
          throw new PluginHostBrokerError("vault-version-conflict", "Expected the Vault file to be absent.");
        }
      } else if (options.expectedVersion !== undefined) {
        if (!existed) {
          throw new PluginHostBrokerError("vault-version-conflict", "Expected version does not exist.");
        }
        const current = contentVersion(await this.readAuthorizedBytes(session, normalized));
        if (current !== options.expectedVersion) {
          throw new PluginHostBrokerError("vault-version-conflict", "Vault file version changed before write.");
        }
      }
      const nextOperationId = operationId(this.createOperationId, options.operationId);
      const bytes = typeof data === "string" ? Buffer.from(data) : data;
      const nextVersion = contentVersion(bytes);
      this.expectWatcherEcho(session, normalized, nextOperationId, nextVersion);
      try {
        await this.atomicWriteAuthorized(lease, data);
      } catch (error) {
        session.pendingEchoes.delete(normalized);
        throw error;
      }
      session.watcherVersions.set(normalized, nextVersion);
      const mutation = Object.freeze({
        path: normalized,
        version: nextVersion,
        operationId: nextOperationId,
      });
      this.emitChange(session, {
        kind: existed ? "modify" : "create",
        path: normalized,
        version: mutation.version,
        operationId: nextOperationId,
        origin: "host",
      });
      return mutation;
    } finally {
      await lease.parentHandle.close().catch(() => undefined);
    }
  }

  async createFolder(
    sender: SenderIdentity,
    sessionId: VaultSessionId,
    vaultPath: string,
    requestedOperationId?: string,
  ): Promise<PluginVaultMutation> {
    const session = this.requireSession(sender, sessionId);
    const normalized = normalizeVaultRelativePath(vaultPath);
    return this.enqueueMutation(session, () => {
      this.assertPathsNotDeletionFenced(session.vaultId, [normalized]);
      this.assertPathsNotProjectionOpeningFenced(session, [normalized]);
      return this.createFolderAuthorized(session, normalized, requestedOperationId);
    });
  }

  private async createFolderAuthorized(
    session: VaultSessionRecord,
    normalized: string,
    requestedOperationId?: string,
  ): Promise<PluginVaultMutation> {
    const lease = await this.acquireAuthorizedPathLease(session, normalized, true);
    try {
      const nextOperationId = operationId(this.createOperationId, requestedOperationId);
      this.expectWatcherEcho(session, normalized, nextOperationId);
      try {
        await this.assertLeaseCurrent(lease);
        await mkdir(lease.operationPath);
        const createdIdentity = await this.readLeafIdentity(lease.operationPath);
        if (createdIdentity === null) {
          throw new PluginHostBrokerError("vault-path-escape", "Vault folder disappeared before commit.");
        }
        await this.assertCommittedLeaf(lease, createdIdentity);
      } catch (error) {
        session.pendingEchoes.delete(normalized);
        throw error;
      }
      const mutation = Object.freeze({ path: normalized, operationId: nextOperationId });
      this.emitChange(session, { kind: "create", path: normalized, operationId: nextOperationId, origin: "host" });
      return mutation;
    } finally {
      await lease.parentHandle.close().catch(() => undefined);
    }
  }

  async rename(
    sender: SenderIdentity,
    sessionId: VaultSessionId,
    vaultPath: string,
    destination: string,
    requestedOperationId?: string,
  ): Promise<PluginVaultMutation> {
    const session = this.requireSession(sender, sessionId);
    const sourcePath = normalizeVaultRelativePath(vaultPath);
    const destinationPath = normalizeVaultRelativePath(destination);
    return this.enqueueMutation(session, () => {
      this.assertPathsNotDeletionFenced(session.vaultId, [sourcePath, destinationPath]);
      this.assertPathsNotProjectionOpeningFenced(session, [sourcePath, destinationPath]);
      return this.renameAuthorized(session, sourcePath, destinationPath, requestedOperationId);
    });
  }

  private async renameAuthorized(
    session: VaultSessionRecord,
    sourcePath: string,
    destinationPath: string,
    requestedOperationId?: string,
  ): Promise<PluginVaultMutation> {
    const source = await this.acquireAuthorizedPathLease(session, sourcePath, false);
    let target: AuthorizedPathLease | null = null;
    try {
      target = await this.acquireAuthorizedPathLease(session, destinationPath, true);
      const nextOperationId = operationId(this.createOperationId, requestedOperationId);
      this.expectWatcherEcho(session, sourcePath, nextOperationId);
      this.expectWatcherEcho(session, destinationPath, nextOperationId);
      try {
        await this.assertLeaseCurrent(source);
        await this.assertLeaseCurrent(target);
        await rename(source.operationPath, target.operationPath);
        await this.assertCommittedLeaf(target, source.leafIdentity);
        if (source.operationPath !== target.operationPath) await this.assertCommittedSourceRemoved(source);
      } catch (error) {
        session.pendingEchoes.delete(sourcePath);
        session.pendingEchoes.delete(destinationPath);
        throw error;
      }
      const mutation = Object.freeze({ path: destinationPath, operationId: nextOperationId });
      this.emitChange(session, {
        kind: "rename",
        path: destinationPath,
        oldPath: sourcePath,
        operationId: nextOperationId,
        origin: "host",
      });
      return mutation;
    } finally {
      await source.parentHandle.close().catch(() => undefined);
      await target?.parentHandle.close().catch(() => undefined);
    }
  }

  async trash(
    sender: SenderIdentity,
    sessionId: VaultSessionId,
    vaultPath: string,
    requestedOperationId?: string,
  ): Promise<PluginVaultMutation & { readonly recoverable: true }> {
    const session = this.requireSession(sender, sessionId);
    const normalized = normalizeVaultRelativePath(vaultPath);
    return this.enqueueMutation(session, () => {
      this.assertPathsNotProjectionOpeningFenced(session, [normalized]);
      this.assertPathsNotDeletionFenced(
        session.vaultId,
        [normalized],
        requestedOperationId === undefined ? undefined : { operationId: requestedOperationId, path: normalized },
      );
      return this.trashAuthorized(session, normalized, requestedOperationId);
    });
  }

  private async trashAuthorized(
    session: VaultSessionRecord,
    normalized: string,
    requestedOperationId?: string,
  ): Promise<PluginVaultMutation & { readonly recoverable: true }> {
    const lease = await this.acquireAuthorizedPathLease(session, normalized, false);
    const stagingPath = path.join(
      lease.canonicalParent,
      `.nexus-trash-${randomUUID()}-${path.basename(lease.operationPath)}`,
    );
    let staged = false;
    try {
      const nextOperationId = operationId(this.createOperationId, requestedOperationId);
      this.expectWatcherEcho(session, normalized, nextOperationId);
      try {
        await this.assertLeaseCurrent(lease);
        await this.assertMissingLeaf(lease, stagingPath);
        await rename(lease.operationPath, stagingPath);
        staged = true;
        await this.assertCommittedPath(lease, stagingPath, lease.leafIdentity);
        await this.trashItem(stagingPath);
        if (await this.readLeafIdentity(stagingPath) !== null) {
          throw new PluginHostBrokerError("vault-path-invalid", "Recoverable trash provider left its target in place.");
        }
        staged = false;
      } catch (error) {
        session.pendingEchoes.delete(normalized);
        if (staged) await this.restoreStagedTrash(lease, stagingPath);
        throw error;
      }
      const mutation = Object.freeze({ path: normalized, operationId: nextOperationId, recoverable: true as const });
      this.emitChange(session, { kind: "delete", path: normalized, operationId: nextOperationId, origin: "host" });
      return mutation;
    } finally {
      await lease.parentHandle.close().catch(() => undefined);
    }
  }

  async createResourceUrl(
    sender: SenderIdentity,
    sessionId: VaultSessionId,
    vaultPath: string,
  ): Promise<{ readonly url: string; readonly registrationId: string }> {
    const session = this.requireSession(sender, sessionId);
    const sessionCapability = session.resourceCapability;
    await this.resolveAuthorizedPath(session, vaultPath, false);
    const currentSession = this.requireSession(sender, sessionId);
    if (currentSession !== session || currentSession.resourceCapability !== sessionCapability) {
      throw new PluginHostBrokerError(
        "vault-session-invalid",
        "Vault session changed while the resource URL was being registered.",
      );
    }
    const normalized = normalizeVaultRelativePath(vaultPath);
    const token = randomUUID();
    session.resourceTokens.add(token);
    this.resources.set(token, { token, sessionId, senderId: sender.id, vaultPath: normalized });
    return Object.freeze({
      url: `nexus-vault://resource/${sessionCapability}/${token}`,
      registrationId: token,
    });
  }

  revokeResourceUrl(
    sender: SenderIdentity,
    sessionId: VaultSessionId,
    registrationId: string,
  ): void {
    const session = this.requireSession(sender, sessionId);
    const resource = this.resources.get(registrationId);
    if (!resource || resource.sessionId !== sessionId) {
      throw new PluginHostBrokerError(
        "vault-session-invalid",
        "Resource URL registration is missing or belongs to another Vault session.",
      );
    }
    session.resourceTokens.delete(registrationId);
    this.resources.delete(registrationId);
  }

  async readResource(
    senderId: number,
    sessionCapability: string,
    token: string,
  ): Promise<{ readonly path: string; readonly content: Uint8Array } | null> {
    const resolved = await this.resolveResourceRecord(senderId, sessionCapability, token);
    if (!resolved) return null;
    const { resource, session, canonicalPath } = resolved;
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await this.openPath(
        canonicalPath,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
      );
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile()) return null;

      // Re-resolve after opening and compare the live path to the opened inode.
      // Content is read only from this handle, so later path swaps cannot retarget it.
      const revalidatedPath = await this.realpathPath(canonicalPath);
      if (!isInside(session.canonicalRoot, revalidatedPath)) return null;
      const revalidated = await this.statPath(revalidatedPath, { bigint: true });
      if (opened.dev !== revalidated.dev || opened.ino !== revalidated.ino) return null;
      if (!this.resourceIsCurrent(senderId, sessionCapability, token, resource, session)) return null;

      const content = await handle.readFile();
      await handle.close();
      handle = null;
      if (!this.resourceIsCurrent(senderId, sessionCapability, token, resource, session)) return null;
      return Object.freeze({
        path: revalidatedPath,
        content,
      });
    } catch {
      return null;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private async resolveResourceRecord(
    senderId: number,
    sessionCapability: string,
    token: string,
  ): Promise<{
    readonly resource: ResourceRecord;
    readonly session: VaultSessionRecord;
    readonly canonicalPath: string;
  } | null> {
    const resource = this.resources.get(token);
    if (!resource) return null;
    const session = this.sessions.get(resource.sessionId);
    if (!session || !this.resourceIsCurrent(senderId, sessionCapability, token, resource, session)) return null;
    try {
      const absolutePath = await this.resolveAuthorizedPath(session, resource.vaultPath, false);
      const canonicalPath = await this.realpathPath(absolutePath);
      if (
        !isInside(session.canonicalRoot, canonicalPath) ||
        !this.resourceIsCurrent(senderId, sessionCapability, token, resource, session)
      ) return null;
      return { resource, session, canonicalPath };
    } catch {
      return null;
    }
  }

  private resourceIsCurrent(
    senderId: number,
    sessionCapability: string,
    token: string,
    resource: ResourceRecord,
    session: VaultSessionRecord,
  ): boolean {
    return !this.closedAll &&
      !this.closedSenders.has(senderId) &&
      !session.closed &&
      this.sessions.get(session.id) === session &&
      session.senderId === senderId &&
      resource.senderId === senderId &&
      resource.sessionId === session.id &&
      session.resourceCapability === sessionCapability &&
      this.resources.get(token) === resource &&
      resource.token === token &&
      session.resourceTokens.has(token);
  }

  private assertSender(sender: SenderIdentity): void {
    if (
      !Number.isSafeInteger(sender.id) ||
      this.closedAll ||
      this.closedSenders.has(sender.id) ||
      !this.isSenderAuthorized(sender)
    ) {
      throw new PluginHostBrokerError("sender-not-authorized", "IPC sender is not an authorized application window.");
    }
  }

  private openIsCurrent(sender: SenderIdentity, senderGeneration: number, allGeneration: number): boolean {
    return !this.closedAll &&
      !this.closedSenders.has(sender.id) &&
      this.allGeneration === allGeneration &&
      (this.senderGenerations.get(sender.id) ?? 0) === senderGeneration &&
      this.isSenderAuthorized(sender);
  }

  private assertOpenStillCurrent(
    sender: SenderIdentity,
    senderGeneration: number,
    allGeneration: number,
  ): void {
    if (!this.openIsCurrent(sender, senderGeneration, allGeneration)) {
      throw new PluginHostBrokerError("vault-session-invalid", "Vault session open was canceled by host shutdown.");
    }
  }

  private requireSession(sender: SenderIdentity, sessionId: VaultSessionId): VaultSessionRecord {
    this.assertSender(sender);
    const session = this.sessions.get(sessionId);
    if (!session || session.closed || session.senderId !== sender.id) {
      throw new PluginHostBrokerError("vault-session-invalid", "Vault session is missing or belongs to another sender.");
    }
    return session;
  }

  private assertSessionRecordCurrent(session: VaultSessionRecord): void {
    if (session.closed || this.sessions.get(session.id) !== session) {
      throw new PluginHostBrokerError("vault-session-invalid", "Vault session closed during mutation coordination.");
    }
  }

  private publishMutationTail(vaultId: VaultId, task: Promise<unknown>): void {
    const tail = task.then(() => undefined, () => undefined);
    this.mutationTails.set(vaultId, tail);
    void tail.then(() => {
      if (this.mutationTails.get(vaultId) === tail) this.mutationTails.delete(vaultId);
    });
  }

  private enqueueMutation<T>(session: VaultSessionRecord, operation: () => T | Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(session.vaultId) ?? Promise.resolve();
    const task = previous.then(() => {
      this.assertSessionRecordCurrent(session);
      return operation();
    });
    this.publishMutationTail(session.vaultId, task);
    return task;
  }

  private assertPathsNotDeletionFenced(
    vaultId: VaultId,
    paths: readonly string[],
    allowed?: { readonly operationId: string; readonly path: string },
  ): void {
    const conflict = [...(this.deletionFences.get(vaultId)?.values() ?? [])].find((fence) =>
      paths.some((candidate) => pathsOverlap(candidate, fence.path)) && !(
        allowed?.operationId === fence.operationId &&
        allowed.path === fence.path &&
        paths.length === 1 &&
        paths[0] === fence.path
      ));
    if (conflict) {
      throw new PluginHostBrokerError(
        "vault-delete-reserved",
        "A Vault mutation is blocked by an active path deletion reservation.",
      );
    }
  }

  private assertPathsNotProjectionOpeningFenced(
    session: VaultSessionRecord,
    paths: readonly string[],
    allowedOperationId?: string,
  ): void {
    const fences = this.projectionOpeningFences.get(session.vaultId);
    if (allowedOperationId !== undefined) {
      const allowed = fences?.get(allowedOperationId);
      if (
        !allowed ||
        allowed.expired ||
        allowed.state !== "committed" ||
        allowed.senderId !== session.senderId ||
        allowed.sessionId !== session.id ||
        paths.length !== 1 ||
        paths[0] !== allowed.path
      ) {
        throw new PluginHostBrokerError(
          "vault-projection-opening-conflict",
          "The collaboration join opening capability is missing, expired, or belongs to another session.",
        );
      }
    }
    const conflict = [...(fences?.values() ?? [])].find((fence) =>
      paths.some((candidate) => pathsOverlap(candidate, fence.path)) &&
      fence.operationId !== allowedOperationId);
    if (conflict) {
      throw new PluginHostBrokerError(
        "vault-projection-opening-conflict",
        "A Vault mutation is blocked while collaboration is joining this path.",
      );
    }
  }

  private removeProjectionOpeningFence(fence: ProjectionOpeningFenceRecord): void {
    const fences = this.projectionOpeningFences.get(fence.vaultId);
    if (fences?.get(fence.operationId) !== fence) return;
    fences.delete(fence.operationId);
    if (fence.expiryTimer !== undefined) this.clearTimeoutFn(fence.expiryTimer);
    if (fences.size === 0) this.projectionOpeningFences.delete(fence.vaultId);
  }

  private armProjectionOpeningFence(fence: ProjectionOpeningFenceRecord): void {
    if (fence.expiryTimer !== undefined) this.clearTimeoutFn(fence.expiryTimer);
    fence.expiryTimer = this.setTimeoutFn(() => {
      // Expiry revokes the opening capability but deliberately retains the
      // path fence. Recovery must present the immutable original owner before
      // rebinding it to a current renderer session.
      fence.expired = true;
    }, this.projectionOpeningTtlMs);
    fence.expiryTimer.unref?.();
  }

  private projectionOpeningStatus(
    fence: ProjectionOpeningFenceRecord,
  ): PluginVaultProjectionOpeningFence {
    return Object.freeze({
      operationId: fence.operationId,
      vaultId: fence.vaultId,
      path: fence.path,
      documentId: fence.documentId,
      owner: Object.freeze({
        senderId: fence.ownerSenderId,
        sessionId: fence.ownerSessionId,
      }),
      state: fence.state,
      active: !fence.expired,
    });
  }

  private requireProjectionWritePermit(
    sender: SenderIdentity,
    session: VaultSessionRecord,
    permitId: string,
    expectedPath?: string,
  ): ProjectionWritePermitRecord {
    const permit = this.projectionWritePermits.get(permitId);
    if (
      !permit ||
      permit.senderId !== sender.id ||
      permit.sessionId !== session.id ||
      permit.vaultId !== session.vaultId ||
      (expectedPath !== undefined && permit.path !== expectedPath)
    ) {
      throw new PluginHostBrokerError(
        "vault-write-permit-invalid",
        "Projection write permit is missing or does not match this Vault mutation.",
      );
    }
    return permit;
  }

  private finishProjectionWritePermit(permit: ProjectionWritePermitRecord): void {
    if (!permit.releaseRequested || permit.activeCalls > 0) return;
    if (this.projectionWritePermits.get(permit.permitId) !== permit) return;
    this.projectionWritePermits.delete(permit.permitId);
    if (permit.expiryTimer !== undefined) this.clearTimeoutFn(permit.expiryTimer);
    permit.finishLane();
  }

  private closeRecord(session: VaultSessionRecord): void {
    if (session.closed) return;
    session.closed = true;
    try {
      session.watcher?.close();
    } catch {
      // Closing is idempotent and must continue releasing other resources.
    }
    for (const token of session.resourceTokens) this.resources.delete(token);
    session.resourceTokens.clear();
    session.pendingEchoes.clear();
    session.watcherVersions.clear();
    for (const permit of this.projectionWritePermits.values()) {
      if (permit.sessionId !== session.id) continue;
      permit.releaseRequested = true;
      this.finishProjectionWritePermit(permit);
    }
    for (const fence of [...(this.projectionOpeningFences.get(session.vaultId)?.values() ?? [])]) {
      if (fence.sessionId !== session.id) continue;
      // A renderer exit cannot prove whether Projection Base or Enrollment
      // crossed its durable boundary. Keep the fence fail-closed for exact
      // reconciliation by a surviving/new renderer.
      fence.expired = true;
      if (fence.expiryTimer !== undefined) this.clearTimeoutFn(fence.expiryTimer);
      fence.expiryTimer = undefined;
    }
    this.sessions.delete(session.id);
    const senderSessions = this.sessionsBySender.get(session.senderId);
    senderSessions?.delete(session.id);
    if (senderSessions?.size === 0) this.sessionsBySender.delete(session.senderId);
  }

  private async acquireAuthorizedPathLease(
    session: VaultSessionRecord,
    vaultPath: string,
    allowMissingLeaf: boolean,
  ): Promise<AuthorizedPathLease> {
    const normalizedPath = normalizeVaultRelativePath(vaultPath);
    const lexicalPath = path.resolve(session.root, ...normalizedPath.split("/"));
    if (!isInside(session.root, lexicalPath)) {
      throw new PluginHostBrokerError("vault-path-escape", "Vault path escapes its authorized root.");
    }
    const canonicalParent = await this.realpathPath(path.dirname(lexicalPath));
    if (!isInside(session.canonicalRoot, canonicalParent)) {
      throw new PluginHostBrokerError("vault-path-escape", "Vault parent follows a symbolic link outside its authorized root.");
    }
    const parentHandle = await this.openPath(
      canonicalParent,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const parentInfo = await parentHandle.stat({ bigint: true });
      if (!parentInfo.isDirectory()) {
        throw new PluginHostBrokerError("vault-path-invalid", "Vault path parent is not a directory.");
      }
      const operationPath = path.join(canonicalParent, path.basename(lexicalPath));
      const leafIdentity = await this.readLeafIdentity(operationPath);
      if (leafIdentity === null && !allowMissingLeaf) {
        throw new PluginHostBrokerError("vault-path-invalid", "Vault path does not exist.");
      }
      const lease: AuthorizedPathLease = Object.freeze({
        session,
        normalizedPath,
        operationPath,
        canonicalParent,
        parentHandle,
        parentIdentity: fileIdentity(parentInfo),
        leafIdentity,
      });
      await this.assertLeaseCurrent(lease);
      return lease;
    } catch (error) {
      await parentHandle.close().catch(() => undefined);
      throw error;
    }
  }

  private async assertLeaseCurrent(lease: AuthorizedPathLease): Promise<void> {
    await this.assertAuthorizedRootCurrent(lease.session);
    const openedParent = await lease.parentHandle.stat({ bigint: true });
    if (!openedParent.isDirectory() || !sameFileIdentity(fileIdentity(openedParent), lease.parentIdentity)) {
      throw new PluginHostBrokerError("vault-path-escape", "Vault path parent changed during authorization.");
    }
    const revalidatedParent = await this.realpathPath(lease.canonicalParent);
    if (revalidatedParent !== lease.canonicalParent || !isInside(lease.session.canonicalRoot, revalidatedParent)) {
      throw new PluginHostBrokerError("vault-path-escape", "Vault path parent left its authorized root.");
    }
    const liveParent = await this.statPath(revalidatedParent, { bigint: true });
    if (!liveParent.isDirectory() || !sameFileIdentity(fileIdentity(liveParent), lease.parentIdentity)) {
      throw new PluginHostBrokerError("vault-path-escape", "Vault path parent was replaced during authorization.");
    }
    const liveLeaf = await this.readLeafIdentity(lease.operationPath);
    if (
      (lease.leafIdentity === null) !== (liveLeaf === null) ||
      (lease.leafIdentity !== null && liveLeaf !== null && !sameFileIdentity(lease.leafIdentity, liveLeaf))
    ) {
      throw new PluginHostBrokerError("vault-path-escape", "Vault path leaf was replaced during authorization.");
    }
  }

  private async assertAuthorizedRootCurrent(session: VaultSessionRecord): Promise<void> {
    if (session.closed || this.sessions.get(session.id) !== session) {
      throw new PluginHostBrokerError("vault-session-invalid", "Vault session closed during path authorization.");
    }
    const canonicalRoot = await this.realpathPath(session.canonicalRoot);
    if (canonicalRoot !== session.canonicalRoot) {
      throw new PluginHostBrokerError("vault-path-escape", "Authorized Vault root was replaced.");
    }
    const rootInfo = await this.statPath(canonicalRoot, { bigint: true });
    if (!rootInfo.isDirectory() || !sameFileIdentity(fileIdentity(rootInfo), session.rootIdentity)) {
      throw new PluginHostBrokerError("vault-path-escape", "Authorized Vault root identity changed.");
    }
  }

  private async readLeafIdentity(absolutePath: string): Promise<FileIdentity | null> {
    try {
      const info = await this.lstatPath(absolutePath, { bigint: true });
      if (info.isSymbolicLink()) {
        throw new PluginHostBrokerError(
          "vault-path-escape",
          "Vault operations do not follow symbolic-link leaves.",
        );
      }
      return fileIdentity(info);
    } catch (error) {
      if (isMissingPathError(error)) return null;
      throw error;
    }
  }

  private async readAuthorizedBytes(session: VaultSessionRecord, vaultPath: string): Promise<Buffer> {
    const lease = await this.acquireAuthorizedPathLease(session, vaultPath, false);
    let handle: VaultFileHandle | null = null;
    try {
      try {
        handle = await this.openPath(
          lease.operationPath,
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
        );
      } catch (error) {
        if (isSymbolicLinkLoopError(error)) {
          throw new PluginHostBrokerError("vault-path-escape", "Vault read target became a symbolic link.");
        }
        throw error;
      }
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || !sameFileIdentity(fileIdentity(opened), lease.leafIdentity!)) {
        throw new PluginHostBrokerError("vault-path-escape", "Vault read target changed while it was being opened.");
      }
      await this.assertLeaseCurrent(lease);
      const content = await handle.readFile();
      const finalIdentity = fileIdentity(await handle.stat({ bigint: true }));
      if (!sameFileIdentity(finalIdentity, lease.leafIdentity!)) {
        throw new PluginHostBrokerError("vault-path-escape", "Vault read target changed while it was being read.");
      }
      return content;
    } finally {
      await handle?.close().catch(() => undefined);
      await lease.parentHandle.close().catch(() => undefined);
    }
  }

  private async atomicWriteAuthorized(lease: AuthorizedPathLease, data: string | Uint8Array): Promise<void> {
    const temporaryPath = atomicTemporaryPath(lease.operationPath);
    let temporaryHandle: VaultFileHandle | null = null;
    let temporaryIdentity: FileIdentity | null = null;
    try {
      await this.assertLeaseCurrent(lease);
      await this.assertMissingLeaf(lease, temporaryPath);
      temporaryHandle = await this.openPath(
        temporaryPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      temporaryIdentity = fileIdentity(await temporaryHandle.stat({ bigint: true }));
      await this.assertCommittedPath(lease, temporaryPath, temporaryIdentity);
      await temporaryHandle.writeFile(data);
      await temporaryHandle.close();
      temporaryHandle = null;
      await this.assertLeaseCurrent(lease);
      await this.assertCommittedPath(lease, temporaryPath, temporaryIdentity);
      await rename(temporaryPath, lease.operationPath);
      await this.assertCommittedLeaf(lease, temporaryIdentity);
      temporaryIdentity = null;
    } finally {
      await temporaryHandle?.close().catch(() => undefined);
      if (temporaryIdentity !== null) await this.unlinkIfIdentityMatches(lease, temporaryPath, temporaryIdentity);
    }
  }

  private async assertMissingLeaf(lease: AuthorizedPathLease, absolutePath: string): Promise<void> {
    await this.assertAuthorizedPathParent(lease, absolutePath);
    if (await this.readLeafIdentity(absolutePath) !== null) {
      throw new PluginHostBrokerError("vault-path-escape", "Vault staging path unexpectedly exists.");
    }
  }

  private async assertCommittedLeaf(
    lease: AuthorizedPathLease,
    expectedIdentity: FileIdentity | null,
  ): Promise<void> {
    await this.assertCommittedPath(lease, lease.operationPath, expectedIdentity);
  }

  private async assertCommittedPath(
    lease: AuthorizedPathLease,
    absolutePath: string,
    expectedIdentity: FileIdentity | null,
  ): Promise<void> {
    await this.assertAuthorizedPathParent(lease, absolutePath);
    const liveIdentity = await this.readLeafIdentity(absolutePath);
    if (liveIdentity === null || (expectedIdentity !== null && !sameFileIdentity(liveIdentity, expectedIdentity))) {
      throw new PluginHostBrokerError("vault-path-escape", "Vault operation target changed before commit.");
    }
    const canonicalPath = await this.realpathPath(absolutePath);
    if (!isInside(lease.session.canonicalRoot, canonicalPath)) {
      throw new PluginHostBrokerError("vault-path-escape", "Vault operation target left its authorized root.");
    }
  }

  private async assertCommittedSourceRemoved(lease: AuthorizedPathLease): Promise<void> {
    await this.assertAuthorizedPathParent(lease, lease.operationPath);
    if (await this.readLeafIdentity(lease.operationPath) !== null) {
      throw new PluginHostBrokerError("vault-path-escape", "Vault rename source was replaced before commit.");
    }
  }

  private async assertAuthorizedPathParent(lease: AuthorizedPathLease, absolutePath: string): Promise<void> {
    if (path.dirname(absolutePath) !== lease.canonicalParent) {
      throw new PluginHostBrokerError("vault-path-escape", "Vault operation changed its authorized parent.");
    }
    await this.assertAuthorizedRootCurrent(lease.session);
    const canonicalParent = await this.realpathPath(path.dirname(absolutePath));
    if (canonicalParent !== lease.canonicalParent || !isInside(lease.session.canonicalRoot, canonicalParent)) {
      throw new PluginHostBrokerError("vault-path-escape", "Vault operation parent left its authorized root.");
    }
    const liveParent = await this.statPath(canonicalParent, { bigint: true });
    if (!liveParent.isDirectory() || !sameFileIdentity(fileIdentity(liveParent), lease.parentIdentity)) {
      throw new PluginHostBrokerError("vault-path-escape", "Vault operation parent was replaced.");
    }
  }

  private async restoreStagedTrash(lease: AuthorizedPathLease, stagingPath: string): Promise<void> {
    try {
      await this.assertCommittedPath(lease, stagingPath, lease.leafIdentity);
      if (await this.readLeafIdentity(lease.operationPath) !== null) return;
      await rename(stagingPath, lease.operationPath);
      await this.assertCommittedLeaf(lease, lease.leafIdentity);
    } catch {
      // Never risk moving an unverified replacement while recovering from a failed trash operation.
    }
  }

  private async unlinkIfIdentityMatches(
    lease: AuthorizedPathLease,
    absolutePath: string,
    expectedIdentity: FileIdentity,
  ): Promise<void> {
    try {
      await this.assertCommittedPath(lease, absolutePath, expectedIdentity);
      await unlink(absolutePath);
    } catch {
      // Cleanup must not unlink a replacement selected by a concurrent path swap.
    }
  }

  private async resolveAuthorizedPath(
    session: VaultSessionRecord,
    vaultPath: string,
    allowMissingLeaf: boolean,
  ): Promise<string> {
    const normalized = normalizeVaultRelativePath(vaultPath);
    const absolutePath = path.resolve(session.root, ...normalized.split("/"));
    if (!isInside(session.root, absolutePath)) {
      throw new PluginHostBrokerError("vault-path-escape", "Vault path escapes its authorized root.");
    }
    if (existsSync(absolutePath)) {
      const canonical = await this.realpathPath(absolutePath);
      if (!isInside(session.canonicalRoot, canonical)) {
        throw new PluginHostBrokerError("vault-path-escape", "Vault path follows a symbolic link outside its authorized root.");
      }
      return absolutePath;
    }
    if (!allowMissingLeaf) return absolutePath;
    const parent = path.dirname(absolutePath);
    const canonicalParent = await this.realpathPath(parent);
    if (!isInside(session.canonicalRoot, canonicalParent)) {
      throw new PluginHostBrokerError("vault-path-escape", "Vault parent follows a symbolic link outside its authorized root.");
    }
    return absolutePath;
  }

  private async scanDirectory(session: VaultSessionRecord, directory: string): Promise<readonly PluginVaultNode[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const nodes: PluginVaultNode[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name) || entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (!isInside(session.root, absolutePath)) continue;
      if (entry.isDirectory()) {
        const children = await this.scanDirectory(session, absolutePath);
        nodes.push(Object.freeze({
          name: entry.name,
          path: relativeFromRoot(session.root, absolutePath),
          kind: "folder" as const,
          children,
        }));
      } else if (entry.isFile() && SUPPORTED_TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        nodes.push(Object.freeze({
          name: entry.name,
          path: relativeFromRoot(session.root, absolutePath),
          kind: "file" as const,
        }));
      }
    }
    nodes.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    return Object.freeze(nodes);
  }

  private async collectTextFiles(
    session: VaultSessionRecord,
    directory: string,
    output: string[],
  ): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name) || entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (!isInside(session.root, absolutePath)) continue;
      if (entry.isDirectory()) {
        await this.collectTextFiles(session, absolutePath, output);
      } else if (entry.isFile() && SUPPORTED_TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        output.push(relativeFromRoot(session.root, absolutePath));
      }
    }
  }

  private async captureWatcherSnapshot(root: string): Promise<Map<string, WatchSnapshotEntry>> {
    const snapshot = new Map<string, WatchSnapshotEntry>();
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name) || entry.isSymbolicLink()) continue;
        const absolutePath = path.join(directory, entry.name);
        if (!isInside(root, absolutePath) || (!entry.isDirectory() && !entry.isFile())) continue;
        const kind = entry.isDirectory() ? "folder" as const : "file" as const;
        const relativePath = relativeFromRoot(root, absolutePath);
        try {
          const info = await this.statPath(absolutePath);
          snapshot.set(relativePath, Object.freeze({
            path: relativePath,
            kind,
            identity: `${kind}:${info.dev}:${info.ino}`,
          }));
        } catch {
          continue;
        }
        if (entry.isDirectory()) await visit(absolutePath);
      }
    };
    await visit(root);
    return snapshot;
  }

  private expectWatcherEcho(
    session: VaultSessionRecord,
    vaultPath: string,
    operation: string,
    expectedVersion?: IpcContentVersion,
  ): void {
    session.pendingEchoes.set(vaultPath, {
      operationId: operation,
      expiresAt: this.now() + 5_000,
      versioned: expectedVersion !== undefined,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
    });
  }

  private async handleWatcherEvent(
    session: VaultSessionRecord,
    eventType: string,
    filename: string | Buffer | null,
  ): Promise<void> {
    if (session.closed) return;
    let vaultPath = "";
    try {
      const raw = filename === null ? "" : filename.toString().split(path.sep).join("/");
      vaultPath = normalizeVaultRelativePath(raw, true);
    } catch {
      vaultPath = "";
    }
    if (this.isAtomicTemporaryPath(vaultPath)) return;
    if (eventType !== "change") {
      await this.handleWatcherRename(session);
      return;
    }
    let pending = session.pendingEchoes.get(vaultPath);
    if (pending && pending.expiresAt < this.now()) {
      session.pendingEchoes.delete(vaultPath);
      pending = undefined;
    }
    let version: IpcContentVersion | undefined;
    if (vaultPath !== "" && eventType === "change") {
      try {
        const absolutePath = await this.resolveAuthorizedPath(session, vaultPath, false);
        version = contentVersion(await readFile(absolutePath));
      } catch {
        // Rename/delete races are represented by a rescan event below.
      }
    }
    if (session.closed) return;
    pending = session.pendingEchoes.get(vaultPath);
    if (pending && pending.expiresAt >= this.now()) {
      if (!pending.versioned) {
        session.pendingEchoes.delete(vaultPath);
        return;
      }
      if (version === undefined || version === pending.expectedVersion) return;
      session.pendingEchoes.delete(vaultPath);
    }
    if (version !== undefined) {
      if (session.watcherVersions.get(vaultPath) === version) return;
      session.watcherVersions.set(vaultPath, version);
    }
    this.emitChange(session, {
      kind: version ? "modify" : "rescan",
      path: vaultPath,
      ...(version ? { version } : {}),
      origin: "external",
    });
  }

  private async handleWatcherRename(session: VaultSessionRecord): Promise<void> {
    let nextSnapshot: Map<string, WatchSnapshotEntry>;
    try {
      nextSnapshot = await this.captureWatcherSnapshot(session.root);
    } catch {
      if (!session.closed) this.emitChange(session, { kind: "rescan", path: "", origin: "external" });
      return;
    }
    if (session.closed) return;
    const previousSnapshot = session.watcherSnapshot;
    session.watcherSnapshot = nextSnapshot;
    const removed = [...previousSnapshot.values()].filter((entry) => !nextSnapshot.has(entry.path));
    const added = [...nextSnapshot.values()].filter((entry) => !previousSnapshot.has(entry.path));
    const addedByIdentity = new Map<string, WatchSnapshotEntry[]>();
    for (const entry of added) {
      const matches = addedByIdentity.get(entry.identity) ?? [];
      matches.push(entry);
      addedByIdentity.set(entry.identity, matches);
    }
    const renamed: Array<{ readonly from: WatchSnapshotEntry; readonly to: WatchSnapshotEntry }> = [];
    const pairedAdded = new Set<string>();
    const pairedRemoved = new Set<string>();
    for (const from of removed) {
      const matches = addedByIdentity.get(from.identity);
      if (matches?.length !== 1) continue;
      const to = matches[0];
      renamed.push({ from, to });
      pairedAdded.add(to.path);
      pairedRemoved.add(from.path);
    }
    // A directory rename already carries identity for all descendants; avoid duplicate nested rename events.
    const topLevelRenames = renamed.filter((candidate) => !renamed.some((ancestor) =>
      ancestor !== candidate &&
      ancestor.from.kind === "folder" &&
      candidate.from.path.startsWith(`${ancestor.from.path}/`) &&
      candidate.to.path.startsWith(`${ancestor.to.path}/`)
    ));
    for (const { from, to } of topLevelRenames) {
      if (this.consumeUnversionedEcho(session, from.path) || this.consumeUnversionedEcho(session, to.path)) {
        session.pendingEchoes.delete(from.path);
        session.pendingEchoes.delete(to.path);
        continue;
      }
      this.emitChange(session, {
        kind: "rename",
        path: to.path,
        oldPath: from.path,
        origin: "external",
      });
    }
    for (const entry of removed) {
      if (pairedRemoved.has(entry.path) || this.consumeUnversionedEcho(session, entry.path)) continue;
      session.watcherVersions.delete(entry.path);
      this.emitChange(session, { kind: "delete", path: entry.path, origin: "external" });
    }
    for (const entry of added) {
      if (pairedAdded.has(entry.path)) continue;
      let version: IpcContentVersion | undefined;
      if (entry.kind === "file") {
        try { version = contentVersion(await readFile(path.join(session.root, entry.path))); } catch { /* changed again */ }
      }
      const pending = session.pendingEchoes.get(entry.path);
      if (pending && pending.expiresAt >= this.now()) {
        if (!pending.versioned || (version !== undefined && pending.expectedVersion === version)) {
          session.pendingEchoes.delete(entry.path);
          continue;
        }
        session.pendingEchoes.delete(entry.path);
      }
      if (version) session.watcherVersions.set(entry.path, version);
      this.emitChange(session, {
        kind: "create",
        path: entry.path,
        ...(version ? { version } : {}),
        origin: "external",
      });
    }
  }

  private consumeUnversionedEcho(session: VaultSessionRecord, vaultPath: string): boolean {
    const pending = session.pendingEchoes.get(vaultPath);
    if (!pending) return false;
    if (pending.expiresAt < this.now()) {
      session.pendingEchoes.delete(vaultPath);
      return false;
    }
    if (pending.versioned) return false;
    session.pendingEchoes.delete(vaultPath);
    return true;
  }

  private isAtomicTemporaryPath(vaultPath: string): boolean {
    const name = vaultPath.slice(vaultPath.lastIndexOf("/") + 1);
    return /^\..+\.[a-f0-9-]{16,}\.tmp$/i.test(name);
  }

  private emitChange(
    session: VaultSessionRecord,
    event: Omit<PluginVaultChangeEvent, "sessionId">,
  ): void {
    this.onChange?.(session.senderId, Object.freeze({ sessionId: session.id, ...event }));
  }
}

interface StorageEnvelope {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly data: unknown;
}

export class ElectronPluginStorageBroker {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly root: string,
    private readonly now: () => number = Date.now,
  ) {}

  async load(pluginId: string): Promise<PluginStorageSnapshot> {
    const id = this.normalizePluginId(pluginId);
    const file = this.filePath(id);
    if (!existsSync(file)) {
      let entries: string[];
      try {
        entries = await readdir(path.dirname(file));
      } catch (cause) {
        if ((cause as { readonly code?: unknown } | null)?.code === "ENOENT") {
          return Object.freeze({ found: false, revision: 0, data: null });
        }
        throw new PluginHostBrokerError(
          "plugin-storage-read-failed",
          "Plugin storage could not be inspected.",
        );
      }
      if (entries.some((entry) => entry.startsWith("data.json.corrupt-"))) {
        return Object.freeze({ found: false, corrupt: true, revision: 0, data: null });
      }
      return Object.freeze({ found: false, revision: 0, data: null });
    }
    let serialized: string;
    try {
      serialized = await readFile(file, "utf8");
    } catch {
      throw new PluginHostBrokerError(
        "plugin-storage-read-failed",
        "Plugin storage could not be read.",
      );
    }
    try {
      const envelope = this.parseEnvelope(JSON.parse(serialized));
      return Object.freeze({ found: true, revision: envelope.revision, data: structuredClone(envelope.data) });
    } catch {
      const corruptPath = `${file}.corrupt-${this.now()}`;
      try {
        await rename(file, corruptPath);
      } catch {
        // Preserve in place if the quarantine rename itself fails.
      }
      return Object.freeze({ found: false, corrupt: true, revision: 0, data: null });
    }
  }

  save(
    pluginId: string,
    expectedRevision: number,
    data: unknown,
  ): Promise<{ readonly ok: true; readonly revision: number } | { readonly ok: false; readonly revision: number }> {
    const id = this.normalizePluginId(pluginId);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new PluginHostBrokerError("plugin-storage-invalid", "Expected revision must be a non-negative integer.");
    }
    let serializable: unknown;
    try {
      serializable = JSON.parse(JSON.stringify(data));
    } catch {
      throw new PluginHostBrokerError("plugin-storage-invalid", "Plugin data must be JSON serializable.");
    }
    const prior = this.queues.get(id) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(async () => {
      await mkdir(path.dirname(this.filePath(id)), { recursive: true });
      const current = await this.load(id);
      if (current.corrupt) {
        throw new PluginHostBrokerError(
          "plugin-storage-corrupt",
          "Corrupt plugin storage must be recovered explicitly before it can be replaced.",
        );
      }
      if (current.revision !== expectedRevision) {
        return Object.freeze({ ok: false as const, revision: current.revision });
      }
      const revision = current.revision + 1;
      const envelope: StorageEnvelope = { schemaVersion: 1, revision, data: serializable };
      await atomicWrite(this.filePath(id), JSON.stringify(envelope, null, 2));
      return Object.freeze({ ok: true as const, revision });
    });
    this.queues.set(id, next);
    const releaseQueue = () => {
      if (this.queues.get(id) === next) this.queues.delete(id);
    };
    void next.then(releaseQueue, releaseQueue);
    return next;
  }

  pendingWriteCount(): number {
    return this.queues.size;
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.queues.values()]);
  }

  private normalizePluginId(pluginId: string): string {
    const normalized = pluginId.trim().toLowerCase();
    if (!PLUGIN_ID_PATTERN.test(normalized)) {
      throw new PluginHostBrokerError("plugin-id-invalid", "Plugin ID is not valid for storage partitioning.");
    }
    return normalized;
  }

  private filePath(pluginId: string): string {
    return path.join(this.root, pluginId, "data.json");
  }

  private parseEnvelope(value: unknown): StorageEnvelope {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new PluginHostBrokerError("plugin-storage-invalid", "Plugin storage envelope must be an object.");
    }
    const envelope = value as Partial<StorageEnvelope>;
    if (
      envelope.schemaVersion !== 1 ||
      !Number.isSafeInteger(envelope.revision) ||
      (envelope.revision ?? -1) < 0 ||
      !("data" in envelope)
    ) {
      throw new PluginHostBrokerError("plugin-storage-invalid", "Plugin storage envelope is invalid.");
    }
    return envelope as StorageEnvelope;
  }
}
