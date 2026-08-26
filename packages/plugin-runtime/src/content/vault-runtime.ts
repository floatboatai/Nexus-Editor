import { NexusPluginError } from "@floatboat/nexus-plugin-api";
import type {
  ComponentId,
  ContentVersion,
  ContentWriteFailure,
  ContentWriteResult,
  FileId,
  FileOperationOrigin,
  ManagedResource,
  NexusAbstractFile,
  NexusDiagnostic,
  NexusFile,
  NexusFolder,
  OperationId,
  PluginId,
  ResourceOwner,
  ServiceResult,
  TypedEvents,
  VaultDeleteOptions,
  VaultEventMap,
  VaultPath,
  VaultReadOptions,
  VaultRenameOptions,
  VaultService,
  VaultWriteOptions,
} from "@floatboat/nexus-plugin-api";

import { TypedEventRegistry } from "../events/typed-event-registry";
import { VaultPathPolicy, type VaultPathPolicyOptions } from "./path-policy";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function asFileId(value: string): FileId {
  return value as FileId;
}

function asOperationId(value: string): OperationId {
  return value as OperationId;
}

function asContentVersion(value: number): ContentVersion {
  return `v${value}`;
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? path : path.slice(index + 1);
}

function splitExtension(name: string): { basename: string; extension: string } {
  const index = name.lastIndexOf(".");
  return index <= 0
    ? { basename: name, extension: "" }
    : { basename: name.slice(0, index), extension: name.slice(index + 1) };
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return cloneBytes(bytes).buffer as ArrayBuffer;
}

function errorCause(error: unknown): NexusDiagnostic["cause"] {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { message: String(error) };
}

function diagnostic(
  code: NexusDiagnostic["code"],
  message: string,
  file?: NexusAbstractFile,
  cause?: unknown,
  owner?: ResourceOwner,
): NexusDiagnostic {
  return Object.freeze({
    code,
    severity: "error",
    phase: code === "callback-failed" ? "callback" : "runtime",
    message,
    ...(owner ? { plugin: { id: owner.pluginId, version: "unknown" } } : {}),
    resourceId: file ? `nexus.vault:file:${file.id}` : "nexus.vault",
    ...(file ? { details: { fileId: file.id, path: file.path } } : {}),
    ...(cause === undefined ? {} : { cause: errorCause(cause) }),
  });
}

interface MemoryNodeState {
  readonly runtime: MemoryVaultRuntime;
  path: VaultPath;
  valid: boolean;
}

const memoryNodeStates = new WeakMap<object, MemoryNodeState>();
interface MemoryFileState {
  currentBytes: Uint8Array;
  cachedBytes: Uint8Array;
  modifiedAt: number;
  version: ContentVersion;
}
const memoryFileStates = new WeakMap<object, MemoryFileState>();

function nodeState(node: object): MemoryNodeState {
  const state = memoryNodeStates.get(node);
  if (!state) throw new TypeError("Unknown in-memory Vault node");
  return state;
}

abstract class MemoryNexusNodeBase {
  abstract readonly kind: "file" | "folder";

  constructor(
    runtime: MemoryVaultRuntime,
    readonly id: FileId,
    path: VaultPath,
  ) {
    memoryNodeStates.set(this, { runtime, path, valid: true });
  }

  get path(): VaultPath {
    return nodeState(this).path;
  }

  get name(): string {
    return basename(this.path);
  }

  get parent(): NexusFolder | null {
    if (!this.path) return null;
    return nodeState(this).runtime.getFolderByNormalizedPath(dirname(this.path));
  }

  get valid(): boolean {
    return nodeState(this).valid;
  }
}

class MemoryNexusFileNode extends MemoryNexusNodeBase implements NexusFile {
  readonly kind = "file" as const;

  constructor(
    runtime: MemoryVaultRuntime,
    id: FileId,
    path: VaultPath,
    bytes: Uint8Array,
    readonly createdAt: number,
    version: ContentVersion,
  ) {
    super(runtime, id, path);
    memoryFileStates.set(this, {
      currentBytes: cloneBytes(bytes),
      cachedBytes: cloneBytes(bytes),
      modifiedAt: createdAt,
      version,
    });
  }

  get basename(): string {
    return splitExtension(this.name).basename;
  }

  get extension(): string {
    return splitExtension(this.name).extension;
  }

  get size(): number {
    return fileState(this).currentBytes.byteLength;
  }

  get modifiedAt(): number {
    return fileState(this).modifiedAt;
  }

  get version(): ContentVersion {
    return fileState(this).version;
  }
}

class MemoryNexusFolderNode extends MemoryNexusNodeBase implements NexusFolder {
  readonly kind = "folder" as const;

  get children(): readonly NexusAbstractFile[] {
    if (!this.valid) return Object.freeze([]);
    return nodeState(this).runtime.childrenOf(this.path);
  }
}

type MemoryNexusNode = MemoryNexusFileNode | MemoryNexusFolderNode;

function fileState(file: MemoryNexusFileNode): MemoryFileState {
  const state = memoryFileStates.get(file);
  if (!state) throw new TypeError("Unknown in-memory Vault file");
  return state;
}

function readFileBytes(
  file: MemoryNexusFileNode,
  consistency: "latest" | "cached",
): Uint8Array {
  const state = fileState(file);
  return cloneBytes(consistency === "cached" ? state.cachedBytes : state.currentBytes);
}

function replaceFileBytes(
  file: MemoryNexusFileNode,
  bytes: Uint8Array,
  version: ContentVersion,
  modifiedAt: number,
): void {
  const state = fileState(file);
  const snapshot = cloneBytes(bytes);
  state.currentBytes = snapshot;
  state.cachedBytes = cloneBytes(snapshot);
  state.version = version;
  state.modifiedAt = modifiedAt;
}

function advanceFileVersion(
  file: MemoryNexusFileNode,
  version: ContentVersion,
  modifiedAt: number,
): void {
  const state = fileState(file);
  state.version = version;
  state.modifiedAt = modifiedAt;
}

export type VaultCommit =
  | {
      readonly type: "create";
      readonly file: NexusAbstractFile;
      readonly version?: ContentVersion;
      readonly origin: FileOperationOrigin;
      readonly bytes?: Uint8Array;
    }
  | {
      readonly type: "modify";
      readonly file: NexusFile;
      readonly version: ContentVersion;
      readonly origin: FileOperationOrigin;
      readonly bytes: Uint8Array;
    }
  | {
      readonly type: "rename";
      readonly file: NexusAbstractFile;
      readonly oldPath: VaultPath;
      readonly version?: ContentVersion;
      readonly origin: FileOperationOrigin;
      readonly bytes?: Uint8Array;
    }
  | {
      readonly type: "delete";
      readonly fileId: FileId;
      readonly path: VaultPath;
      readonly version?: ContentVersion;
      readonly origin: FileOperationOrigin;
    };

export type HostVaultChange =
  | {
      readonly type: "create" | "modify";
      readonly path: string;
      readonly data: string | Uint8Array;
      readonly operationId?: string;
    }
  | {
      readonly type: "create-folder";
      readonly path: string;
      readonly operationId?: string;
    }
  | {
      readonly type: "rename";
      readonly path: string;
      readonly destination: string;
      readonly operationId?: string;
    }
  | {
      readonly type: "delete";
      readonly path: string;
      readonly operationId?: string;
    };

export type HostVaultChangeResult =
  | { readonly ok: true; readonly deduplicated: true }
  | { readonly ok: true; readonly deduplicated: false; readonly operationId: OperationId }
  | { readonly ok: false; readonly diagnostic: NexusDiagnostic };

export interface MemoryVaultRuntimeOptions extends VaultPathPolicyOptions {
  readonly now?: () => number;
  readonly reportDiagnostic?: (diagnostic: NexusDiagnostic) => void;
  readonly trashRoot?: string;
  readonly initialFiles?: Readonly<Record<string, string | Uint8Array>>;
  readonly allowPermanentDelete?: (owner: ResourceOwner) => boolean;
}

/** Host-neutral, identity-preserving Vault implementation for adapters and tests. */
export class MemoryVaultRuntime implements ManagedResource {
  private readonly pathPolicy: VaultPathPolicy;
  private readonly now: () => number;
  private readonly reportDiagnostic: (diagnostic: NexusDiagnostic) => void;
  private readonly trashRoot: VaultPath;
  private readonly allowPermanentDelete: (owner: ResourceOwner) => boolean;
  private readonly nodesByPath = new Map<VaultPath, MemoryNexusNode>();
  private readonly nodesById = new Map<FileId, MemoryNexusNode>();
  private readonly writeTails = new Map<string, Promise<void>>();
  private readonly commitListeners = new Set<(commit: VaultCommit) => void>();
  private readonly knownOperationIds = new Set<OperationId>();
  private readonly knownOperationOrder: OperationId[] = [];
  private readonly eventRegistry = new TypedEventRegistry<VaultEventMap>({
    serviceId: "nexus.vault.events",
    events: { create: null, modify: null, rename: null, delete: null },
  });
  private fileSequence = 0;
  private operationSequence = 0;
  private revision = 0;
  private disposed = false;

  constructor(options: MemoryVaultRuntimeOptions = {}) {
    this.pathPolicy = new VaultPathPolicy({ resolver: options.resolver });
    this.now = options.now ?? (() => Date.now());
    this.reportDiagnostic = options.reportDiagnostic ?? (() => undefined);
    this.trashRoot = this.pathPolicy.normalize(options.trashRoot ?? ".trash");
    this.allowPermanentDelete = options.allowPermanentDelete ?? (() => false);
    const root = new MemoryNexusFolderNode(this, this.nextFileId(), "" as VaultPath);
    Object.freeze(root);
    this.nodesByPath.set(root.path, root);
    this.nodesById.set(root.id, root);
    for (const [path, data] of Object.entries(options.initialFiles ?? {})) {
      this.seed(path, data);
    }
  }

  createService(
    owner: ResourceOwner,
    registerResource: (resource: ManagedResource) => void,
  ): VaultService {
    this.assertRunning();
    const events = this.eventRegistry.createEvents(owner, registerResource);
    const service: VaultService = {
      events,
      getAbstractFileByPath: (path) => this.getAbstractFileByPath(path),
      getFileByPath: (path) => this.getFileByPath(path),
      getFolderByPath: (path) => this.getFolderByPath(path),
      read: (file, options) => this.read(file, options),
      readBinary: (file, options) => this.readBinary(file, options),
      create: (path, data, options) => this.createForOwner(owner, path, data, options),
      createBinary: (path, data, options) =>
        this.createForOwner(owner, path, new Uint8Array(data.slice(0)), options),
      createFolder: (path) => this.createFolderForOwner(owner, path),
      modify: (file, data, options) =>
        this.modifyForOwner(owner, file, textEncoder.encode(data), options),
      modifyBinary: (file, data, options) =>
        this.modifyForOwner(owner, file, new Uint8Array(data.slice(0)), options),
      append: (file, data, options) => this.appendForOwner(owner, file, data, options),
      process: (file, transform, options) =>
        this.processForOwner(owner, file, transform, options),
      rename: (file, destination, options) =>
        this.renameForOwner(owner, file, destination, options),
      trash: (file) => this.trashForOwner(owner, file),
      delete: (file, options) => this.deleteForOwner(owner, file, options),
    };
    return Object.freeze(service);
  }

  get events(): TypedEvents<VaultEventMap> {
    throw new Error("Use createService(owner, registerResource) for owner-bound events");
  }

  getAbstractFileByPath(path: VaultPath | string): NexusAbstractFile | null {
    this.assertRunning();
    return this.nodesByPath.get(this.pathPolicy.normalize(path)) ?? null;
  }

  getFileByPath(path: VaultPath | string): NexusFile | null {
    const node = this.getAbstractFileByPath(path);
    return node?.kind === "file" ? node : null;
  }

  getFolderByPath(path: VaultPath | string): NexusFolder | null {
    const node = this.getAbstractFileByPath(path);
    return node?.kind === "folder" ? node : null;
  }

  getFolderByNormalizedPath(path: string): NexusFolder | null {
    const node = this.nodesByPath.get(path as VaultPath);
    return node?.kind === "folder" && node.valid ? node : null;
  }

  getFileById(id: FileId): NexusFile | null {
    const node = this.nodesById.get(id);
    return node?.kind === "file" && node.valid ? node : null;
  }

  ownsFile(file: NexusFile): boolean {
    return file.valid && this.nodesById.get(file.id) === file;
  }

  childrenOf(path: VaultPath): readonly NexusAbstractFile[] {
    const parentPath = path as string;
    return Object.freeze(
      [...this.nodesByPath.values()]
        .filter((node) => node.valid && node.path !== path && dirname(node.path) === parentPath)
        .sort((left, right) => left.path.localeCompare(right.path)),
    );
  }

  listFiles(): readonly NexusFile[] {
    return Object.freeze(
      [...this.nodesByPath.values()]
        .filter((node): node is MemoryNexusFileNode => node.kind === "file" && node.valid)
        .sort((left, right) => left.path.localeCompare(right.path)),
    );
  }

  async read(file: NexusFile, options: VaultReadOptions = {}): Promise<string> {
    const node = this.requireFile(file);
    try {
      return textDecoder.decode(readFileBytes(node, options.consistency ?? "latest"));
    } catch (error) {
      throw new NexusPluginError(
        diagnostic("unsupported-operation", "File is not valid UTF-8 text", file, error),
      );
    }
  }

  async readBinary(file: NexusFile, options: VaultReadOptions = {}): Promise<ArrayBuffer> {
    return toArrayBuffer(readFileBytes(this.requireFile(file), options.consistency ?? "latest"));
  }

  readBytesSnapshot(file: NexusFile): Uint8Array {
    return readFileBytes(this.requireFile(file), "latest");
  }

  onCommit(listener: (commit: VaultCommit) => void): () => void {
    this.commitListeners.add(listener);
    return () => this.commitListeners.delete(listener);
  }

  hasOperation(operationId: string): boolean {
    return this.knownOperationIds.has(asOperationId(operationId));
  }

  async confirmExternalChange(change: HostVaultChange): Promise<HostVaultChangeResult> {
    this.assertRunning();
    const operationId = change.operationId
      ? asOperationId(change.operationId)
      : this.nextOperationId();
    return this.confirmHostChange(change, { kind: "external", operationId });
  }

  /**
   * Applies a mutation already committed by a host backend to the public
   * identity/event mirror. Host adapters use this after durable I/O succeeds
   * so plugins never observe a successful in-memory write that failed on disk.
   */
  async confirmHostChange(
    change: HostVaultChange,
    origin: FileOperationOrigin,
  ): Promise<HostVaultChangeResult> {
    this.assertRunning();
    const operationId = origin.operationId;
    if (change.operationId !== undefined && change.operationId !== operationId) {
      return {
        ok: false,
        diagnostic: diagnostic(
          "unsupported-operation",
          "Host Vault change operation ID does not match its origin",
        ),
      };
    }
    if (this.knownOperationIds.has(operationId)) return { ok: true, deduplicated: true };
    try {
      if (change.type === "create") {
        const result = await this.createInternal(change.path, change.data, origin);
        return result.ok
          ? { ok: true, deduplicated: false, operationId }
          : result;
      }
      if (change.type === "create-folder") {
        const result = await this.createFolderInternal(change.path, origin);
        return result.ok
          ? { ok: true, deduplicated: false, operationId }
          : result;
      }
      const node = this.getAbstractFileByPath(change.path);
      if (!node) {
        return {
          ok: false,
          diagnostic: diagnostic("file-invalid-reference", "External change targets a missing file"),
        };
      }
      if (change.type === "modify") {
        if (node.kind !== "file") {
          return {
            ok: false,
            diagnostic: diagnostic("unsupported-operation", "Cannot modify a folder", node),
          };
        }
        const result = await this.modifyInternal(node, change.data, {}, origin);
        return result.ok
          ? { ok: true, deduplicated: false, operationId }
          : result;
      }
      if (change.type === "rename") {
        const result = await this.renameInternal(node, change.destination, {}, origin);
        return result.ok
          ? { ok: true, deduplicated: false, operationId }
          : result;
      }
      const result = await this.deleteInternal(node, origin);
      return result.ok
        ? { ok: true, deduplicated: false, operationId }
        : result;
    } catch (error) {
      const item = error instanceof NexusPluginError
        ? error.diagnostic
        : diagnostic("unsupported-operation", "External Vault change failed", undefined, error);
      this.reportDiagnostic(item);
      return { ok: false, diagnostic: item };
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.all([...this.writeTails.values()]);
    this.commitListeners.clear();
  }

  private seed(path: string, data: string | Uint8Array): void {
    const normalized = this.requireNonEmptyPath(path);
    this.ensureParentFolders(normalized);
    if (this.nodesByPath.has(normalized)) {
      throw new Error(`Initial Vault path '${normalized}' is duplicated`);
    }
    const version = this.nextVersion();
    const node = new MemoryNexusFileNode(
      this,
      this.nextFileId(),
      normalized,
      typeof data === "string" ? textEncoder.encode(data) : data,
      this.now(),
      version,
    );
    Object.freeze(node);
    this.nodesByPath.set(normalized, node);
    this.nodesById.set(node.id, node);
  }

  private createForOwner(
    owner: ResourceOwner,
    path: VaultPath,
    data: string | Uint8Array,
    options: VaultWriteOptions = {},
  ): Promise<ContentWriteResult> {
    const origin = this.pluginOrigin(owner, options.origin);
    return this.createInternal(path, data, origin, options);
  }

  private createInternal(
    path: string,
    data: string | Uint8Array,
    origin: FileOperationOrigin,
    options: VaultWriteOptions = {},
  ): Promise<ContentWriteResult> {
    let normalized: VaultPath;
    try {
      this.assertRunning();
      normalized = this.requireNonEmptyPath(path);
    } catch (error) {
      return Promise.resolve(this.failureFrom(error));
    }
    return this.enqueue(`path:${normalized}`, async () => {
      if (this.nodesByPath.has(normalized)) {
        const existing = this.nodesByPath.get(normalized)!;
        return this.failure(
          "unsupported-operation",
          `Vault path '${normalized}' already exists`,
          existing,
          existing.kind === "file" ? existing.version : undefined,
        );
      }
      if (options.expectedVersion !== undefined) {
        return this.failure(
          "file-version-conflict",
          "Expected version cannot match a missing file",
        );
      }
      const parentFailure = this.ensureParentFoldersResult(normalized, origin);
      if (parentFailure) return parentFailure;
      const bytes = typeof data === "string" ? textEncoder.encode(data) : cloneBytes(data);
      const version = this.nextVersion();
      const node = new MemoryNexusFileNode(
        this,
        this.nextFileId(),
        normalized,
        bytes,
        this.now(),
        version,
      );
      Object.freeze(node);
      this.nodesByPath.set(normalized, node);
      this.nodesById.set(node.id, node);
      this.emitCommit({ type: "create", file: node, version, origin, bytes });
      return Object.freeze({ ok: true, file: node, version, operationId: origin.operationId });
    });
  }

  private createFolderForOwner(
    owner: ResourceOwner,
    path: VaultPath,
  ): Promise<ServiceResult<NexusFolder>> {
    return this.createFolderInternal(path, this.pluginOrigin(owner));
  }

  private createFolderInternal(
    path: string,
    origin: FileOperationOrigin,
  ): Promise<ServiceResult<NexusFolder>> {
    let normalized: VaultPath;
    try {
      this.assertRunning();
      normalized = this.requireNonEmptyPath(path);
    } catch (error) {
      return Promise.resolve({ ok: false, diagnostic: this.failureFrom(error).diagnostic });
    }
    return this.enqueue(`path:${normalized}`, async () => {
      const existing = this.nodesByPath.get(normalized);
      if (existing) {
        if (existing.kind === "folder") {
          this.rememberOperation(origin.operationId);
          return { ok: true, value: existing };
        }
        return {
          ok: false,
          diagnostic: diagnostic(
            "unsupported-operation",
            `Vault path '${normalized}' is already a file`,
            existing,
          ),
        };
      }
      const parentFailure = this.ensureParentFoldersResult(normalized, origin);
      if (parentFailure) return parentFailure;
      const folder = this.createFolderNode(normalized);
      this.emitCommit({ type: "create", file: folder, origin });
      return { ok: true, value: folder };
    });
  }

  private modifyForOwner(
    owner: ResourceOwner,
    file: NexusFile,
    data: Uint8Array,
    options: VaultWriteOptions = {},
  ): Promise<ContentWriteResult> {
    return this.modifyInternal(file, data, options, this.pluginOrigin(owner, options.origin));
  }

  private modifyInternal(
    file: NexusFile,
    data: string | Uint8Array,
    options: VaultWriteOptions,
    origin: FileOperationOrigin,
  ): Promise<ContentWriteResult> {
    let node: MemoryNexusFileNode;
    try {
      node = this.requireFile(file);
    } catch (error) {
      return Promise.resolve(this.failureFrom(error));
    }
    return this.enqueue(`file:${node.id}`, async () => {
      const current = this.validFile(node);
      if (!current) return this.invalidReferenceFailure(node);
      if (options.expectedVersion !== undefined && current.version !== options.expectedVersion) {
        return this.failure(
          "file-version-conflict",
          "File changed after the caller read it",
          current,
          current.version,
        );
      }
      const bytes = typeof data === "string" ? textEncoder.encode(data) : cloneBytes(data);
      const version = this.nextVersion();
      replaceFileBytes(current, bytes, version, this.now());
      this.emitCommit({ type: "modify", file: current, version, origin, bytes });
      return Object.freeze({ ok: true, file: current, version, operationId: origin.operationId });
    });
  }

  private appendForOwner(
    owner: ResourceOwner,
    file: NexusFile,
    data: string,
    options: VaultWriteOptions = {},
  ): Promise<ContentWriteResult> {
    let node: MemoryNexusFileNode;
    try {
      node = this.requireFile(file);
    } catch (error) {
      return Promise.resolve(this.failureFrom(error));
    }
    return this.enqueue(`file:${node.id}`, async () => {
      const current = this.validFile(node);
      if (!current) return this.invalidReferenceFailure(node);
      if (options.expectedVersion !== undefined && current.version !== options.expectedVersion) {
        return this.failure(
          "file-version-conflict",
          "File changed after the caller read it",
          current,
          current.version,
        );
      }
      const existing = readFileBytes(current, "latest");
      const suffix = textEncoder.encode(data);
      const combined = new Uint8Array(existing.length + suffix.length);
      combined.set(existing);
      combined.set(suffix, existing.length);
      const version = this.nextVersion();
      replaceFileBytes(current, combined, version, this.now());
      const origin = this.pluginOrigin(owner, options.origin);
      this.emitCommit({ type: "modify", file: current, version, origin, bytes: combined });
      return Object.freeze({ ok: true, file: current, version, operationId: origin.operationId });
    });
  }

  private processForOwner(
    owner: ResourceOwner,
    file: NexusFile,
    transform: (current: string) => string,
    options: Omit<VaultWriteOptions, "expectedVersion"> = {},
  ): Promise<ContentWriteResult> {
    let node: MemoryNexusFileNode;
    try {
      node = this.requireFile(file);
    } catch (error) {
      return Promise.resolve(this.failureFrom(error));
    }
    return this.enqueue(`file:${node.id}`, async () => {
      const current = this.validFile(node);
      if (!current) return this.invalidReferenceFailure(node);
      let transformed: string;
      try {
        const source = textDecoder.decode(readFileBytes(current, "latest"));
        transformed = transform(source);
        if (typeof transformed !== "string") {
          throw new TypeError("Vault process transform must return a string synchronously");
        }
      } catch (error) {
        const item = diagnostic(
          "callback-failed",
          "Vault process transform failed; content was not changed",
          current,
          error,
          owner,
        );
        this.reportDiagnostic(item);
        return { ok: false, diagnostic: item };
      }
      const bytes = textEncoder.encode(transformed);
      const previous = readFileBytes(current, "latest");
      const origin = this.pluginOrigin(owner, options.origin);
      if (bytesEqual(bytes, previous)) {
        return Object.freeze({
          ok: true,
          file: current,
          version: current.version,
          operationId: origin.operationId,
        });
      }
      const version = this.nextVersion();
      replaceFileBytes(current, bytes, version, this.now());
      this.emitCommit({ type: "modify", file: current, version, origin, bytes });
      return Object.freeze({ ok: true, file: current, version, operationId: origin.operationId });
    });
  }

  private renameForOwner(
    owner: ResourceOwner,
    file: NexusAbstractFile,
    destination: VaultPath,
    options: VaultRenameOptions = {},
  ): Promise<ServiceResult<NexusAbstractFile>> {
    return this.renameInternal(file, destination, options, this.pluginOrigin(owner, options.origin));
  }

  private renameInternal(
    file: NexusAbstractFile,
    destination: string,
    options: VaultRenameOptions,
    origin: FileOperationOrigin,
  ): Promise<ServiceResult<NexusAbstractFile>> {
    let node: MemoryNexusNode;
    let normalized: VaultPath;
    try {
      node = this.requireNode(file);
      normalized = this.requireNonEmptyPath(destination);
    } catch (error) {
      return Promise.resolve({ ok: false, diagnostic: this.failureFrom(error).diagnostic });
    }
    return this.enqueue(`file:${node.id}`, async () => {
      if (!node.valid) {
        return { ok: false, diagnostic: this.invalidReferenceFailure(node).diagnostic };
      }
      if (
        node.kind === "file" &&
        options.expectedVersion !== undefined &&
        node.version !== options.expectedVersion
      ) {
        return {
          ok: false,
          diagnostic: this.failure(
            "file-version-conflict",
            "File changed after the caller read it",
            node,
            node.version,
          ).diagnostic,
        };
      }
      if (node.kind === "folder" && normalized.startsWith(`${node.path}/`)) {
        return {
          ok: false,
          diagnostic: diagnostic(
            "path-outside-authorized-root",
            "A folder cannot be moved into itself",
            node,
          ),
        };
      }
      if (this.nodesByPath.has(normalized)) {
        return {
          ok: false,
          diagnostic: diagnostic(
            "unsupported-operation",
            `Vault destination '${normalized}' already exists`,
            node,
          ),
        };
      }
      const parentFailure = this.ensureParentFoldersResult(normalized, origin);
      if (parentFailure) return parentFailure;
      const oldPath = node.path;
      const moved = [node, ...this.descendantsOf(node.path)];
      const oldPaths = moved.map((item) => item.path);
      for (const item of moved) this.nodesByPath.delete(item.path);
      for (let index = 0; index < moved.length; index += 1) {
        const item = moved[index];
        const itemOldPath = oldPaths[index];
        const next = `${normalized}${itemOldPath.slice(oldPath.length)}` as VaultPath;
        nodeState(item).path = next;
        this.nodesByPath.set(next, item);
      }
      let version: ContentVersion | undefined;
      let bytes: Uint8Array | undefined;
      if (node.kind === "file") {
        version = this.nextVersion();
        advanceFileVersion(node, version, this.now());
        bytes = readFileBytes(node, "latest");
      }
      this.emitCommit({
        type: "rename",
        file: node,
        oldPath,
        ...(version ? { version } : {}),
        origin,
        ...(bytes ? { bytes } : {}),
      });
      return { ok: true, value: node };
    });
  }

  private async trashForOwner(
    owner: ResourceOwner,
    file: NexusAbstractFile,
  ): Promise<ServiceResult<{ readonly recoverable: true }>> {
    let node: MemoryNexusNode;
    try {
      node = this.requireNode(file);
    } catch (error) {
      return { ok: false, diagnostic: this.failureFrom(error).diagnostic };
    }
    let target = `${this.trashRoot}/${node.path}`;
    let suffix = 1;
    while (this.getAbstractFileByPath(target)) {
      target = `${this.trashRoot}/${node.path}.${suffix++}`;
    }
    const moved = await this.renameInternal(node, target, {}, this.pluginOrigin(owner));
    return moved.ok
      ? { ok: true, value: Object.freeze({ recoverable: true as const }) }
      : moved;
  }

  private deleteForOwner(
    owner: ResourceOwner,
    file: NexusAbstractFile,
    _options: VaultDeleteOptions,
  ): Promise<ServiceResult<void>> {
    if (!this.allowPermanentDelete(owner)) {
      return Promise.resolve({
        ok: false,
        diagnostic: diagnostic(
          "permission-denied",
          "Permanent deletion requires an explicit host permission",
          file,
        ),
      });
    }
    return this.deleteInternal(file, this.pluginOrigin(owner));
  }

  private deleteInternal(
    file: NexusAbstractFile,
    origin: FileOperationOrigin,
  ): Promise<ServiceResult<void>> {
    let node: MemoryNexusNode;
    try {
      node = this.requireNode(file);
    } catch (error) {
      return Promise.resolve({ ok: false, diagnostic: this.failureFrom(error).diagnostic });
    }
    return this.enqueue(`file:${node.id}`, async () => {
      if (!node.valid) {
        return { ok: false, diagnostic: this.invalidReferenceFailure(node).diagnostic };
      }
      const removed = [node, ...this.descendantsOf(node.path)].reverse();
      for (const item of removed) {
        const path = item.path;
        const version = item.kind === "file" ? item.version : undefined;
        this.nodesByPath.delete(path);
        this.nodesById.delete(item.id);
        nodeState(item).valid = false;
        this.emitCommit({
          type: "delete",
          fileId: item.id,
          path,
          ...(version ? { version } : {}),
          origin,
        });
      }
      return { ok: true, value: undefined };
    });
  }

  private ensureParentFolders(path: VaultPath, origin?: FileOperationOrigin): void {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const parentPath = parts.slice(0, index).join("/") as VaultPath;
      const existing = this.nodesByPath.get(parentPath);
      if (existing?.kind === "file") {
        throw new NexusPluginError(
          diagnostic("unsupported-operation", `Vault parent '${parentPath}' is a file`, existing),
        );
      }
      if (existing) continue;
      const folder = this.createFolderNode(parentPath);
      if (origin) {
        this.rememberOperation(origin.operationId);
        this.eventRegistry.emit("create", { file: folder, origin });
      }
    }
  }

  private ensureParentFoldersResult(
    path: VaultPath,
    origin: FileOperationOrigin,
  ): ContentWriteFailure | null {
    try {
      this.ensureParentFolders(path, origin);
      return null;
    } catch (error) {
      return this.failureFrom(error);
    }
  }

  private createFolderNode(path: VaultPath): MemoryNexusFolderNode {
    const folder = new MemoryNexusFolderNode(this, this.nextFileId(), path);
    Object.freeze(folder);
    this.nodesByPath.set(path, folder);
    this.nodesById.set(folder.id, folder);
    return folder;
  }

  private descendantsOf(path: VaultPath): MemoryNexusNode[] {
    const prefix = `${path}/`;
    return [...this.nodesByPath.values()]
      .filter((node) => node.valid && node.path.startsWith(prefix))
      .sort((left, right) => left.path.length - right.path.length);
  }

  private requireNode(file: NexusAbstractFile): MemoryNexusNode {
    this.assertRunning();
    if (!(file instanceof MemoryNexusNodeBase) || nodeState(file).runtime !== this) {
      throw new NexusPluginError(
        diagnostic("file-invalid-reference", "File reference belongs to another Vault"),
      );
    }
    const current = this.nodesById.get(file.id);
    if (!file.valid || current !== file) {
      throw new NexusPluginError(
        diagnostic("file-invalid-reference", "File reference is no longer valid", file),
      );
    }
    return file as MemoryNexusNode;
  }

  private requireFile(file: NexusFile): MemoryNexusFileNode {
    const node = this.requireNode(file);
    if (node.kind !== "file") {
      throw new NexusPluginError(
        diagnostic("unsupported-operation", "Operation requires a file", node),
      );
    }
    return node;
  }

  private validFile(file: MemoryNexusFileNode): MemoryNexusFileNode | null {
    return file.valid && this.nodesById.get(file.id) === file ? file : null;
  }

  private requireNonEmptyPath(path: string): VaultPath {
    const normalized = this.pathPolicy.normalize(path);
    if (!normalized) {
      throw new NexusPluginError(
        diagnostic("path-outside-authorized-root", "Vault file path must not be empty"),
      );
    }
    return normalized;
  }

  private pluginOrigin(owner: ResourceOwner, requested?: string): FileOperationOrigin {
    // `origin` is a caller label, not authority to choose a globally unique
    // operation ID. The runtime always issues the ID used for echo dedupe.
    void requested;
    return Object.freeze({
      kind: "plugin" as const,
      pluginId: owner.pluginId,
      operationId: this.nextOperationId(),
    });
  }

  private emitCommit(commit: VaultCommit): void {
    this.rememberOperation(commit.origin.operationId);
    if (commit.type === "create") {
      this.eventRegistry.emit("create", {
        file: commit.file,
        version: commit.version,
        origin: commit.origin,
      });
    } else if (commit.type === "modify") {
      this.eventRegistry.emit("modify", {
        file: commit.file,
        version: commit.version,
        origin: commit.origin,
      });
    } else if (commit.type === "rename") {
      this.eventRegistry.emit("rename", {
        file: commit.file,
        oldPath: commit.oldPath,
        ...(commit.version ? { version: commit.version } : {}),
        origin: commit.origin,
      });
    } else {
      this.eventRegistry.emit("delete", {
        fileId: commit.fileId,
        path: commit.path,
        ...(commit.version ? { version: commit.version } : {}),
        origin: commit.origin,
      });
    }
    for (const listener of [...this.commitListeners]) {
      try {
        listener(commit);
      } catch (error) {
        this.reportDiagnostic(
          diagnostic(
            "callback-failed",
            "A host Vault commit observer failed after content was committed",
            commit.type === "delete" ? undefined : commit.file,
            error,
          ),
        );
      }
    }
  }

  private rememberOperation(operationId: OperationId): void {
    if (this.knownOperationIds.has(operationId)) return;
    this.knownOperationIds.add(operationId);
    this.knownOperationOrder.push(operationId);
    while (this.knownOperationOrder.length > 1_024) {
      this.knownOperationIds.delete(this.knownOperationOrder.shift()!);
    }
  }

  private enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writeTails.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    this.writeTails.set(key, tail);
    void tail.finally(() => {
      if (this.writeTails.get(key) === tail) this.writeTails.delete(key);
    });
    return result;
  }

  private failure(
    code: NexusDiagnostic["code"],
    message: string,
    file?: NexusAbstractFile,
    currentVersion?: ContentVersion,
  ): ContentWriteFailure {
    const item = diagnostic(code, message, file);
    this.reportDiagnostic(item);
    return {
      ok: false,
      diagnostic: item,
      ...(currentVersion ? { currentVersion } : {}),
    };
  }

  private invalidReferenceFailure(file: NexusAbstractFile): ContentWriteFailure {
    return this.failure(
      "file-invalid-reference",
      "File reference is no longer valid",
      file,
      file.kind === "file" ? file.version : undefined,
    );
  }

  private failureFrom(error: unknown): ContentWriteFailure {
    if (error instanceof NexusPluginError) {
      this.reportDiagnostic(error.diagnostic);
      return { ok: false, diagnostic: error.diagnostic };
    }
    return this.failure("unsupported-operation", "Vault operation failed", undefined);
  }

  private nextFileId(): FileId {
    return asFileId(`file:${++this.fileSequence}`);
  }

  private nextOperationId(): OperationId {
    return asOperationId(`vault-operation:${++this.operationSequence}`);
  }

  private nextVersion(): ContentVersion {
    return asContentVersion(++this.revision);
  }

  private assertRunning(): void {
    if (this.disposed) throw new Error("Vault runtime has been disposed");
  }
}

/** Convenience owner for content hosts that do not have a lifecycle runtime. */
export function createContentOwner(pluginId: string): ResourceOwner {
  return {
    pluginId: pluginId as PluginId,
    componentId: `${pluginId}/content` as ComponentId,
  };
}
