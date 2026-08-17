import type {
  JsonValue,
  ManagedResource,
  NexusDiagnostic,
  PluginDataSaveOptions,
  PluginDataSaveResult,
  PluginDataSnapshot,
  PluginId,
  PluginStorageEventMap,
  PluginStorageService,
  RegistrationId,
  ResourceOwner,
  SecretDescriptor,
  SecretStorageService,
  ServiceResult,
  TypedEvents,
} from "@floatboat/nexus-plugin-api";

import { TypedEventRegistry } from "./events/typed-event-registry";

export type PluginStorageBackendReadResult =
  | { readonly status: "missing" }
  | { readonly status: "available"; readonly serialized: string; readonly version: string }
  | {
      readonly status: "corrupt";
      /** Preserved by the backend for explicit host/user recovery; never exposed to plugins. */
      readonly raw: string;
      readonly version: string | null;
      readonly cause?: unknown;
    };

export type PluginStorageBackendWriteResult =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly currentVersion: string | null };

export interface PluginStorageBackendChange {
  readonly pluginId: PluginId;
  readonly version: string;
  readonly schemaVersion: number | null;
}

export interface PluginStorageBackend {
  read(pluginId: PluginId): Promise<PluginStorageBackendReadResult>;
  write(
    pluginId: PluginId,
    serialized: string,
    expectedVersion?: string,
  ): Promise<PluginStorageBackendWriteResult>;
  subscribe?(listener: (change: PluginStorageBackendChange) => void): () => void;
}

export interface PluginStorageRuntimeOptions {
  readonly backend?: PluginStorageBackend;
  readonly reportDiagnostic?: (diagnostic: NexusDiagnostic) => void;
}

interface StoredEnvelope {
  readonly schemaVersion: number | null;
  readonly data: JsonValue;
}

interface StorageRecord {
  cache: PluginDataSnapshot | null | undefined;
  corruption?: NexusDiagnostic;
  tail: Promise<void>;
  readonly events: TypedEventRegistry<PluginStorageEventMap>;
}

function diagnostic(
  pluginId: PluginId,
  code: NexusDiagnostic["code"],
  message: string,
  cause?: unknown,
): NexusDiagnostic {
  return Object.freeze({
    code,
    severity: "error",
    phase: "runtime",
    message,
    plugin: { id: pluginId, version: "unknown" },
    resourceId: `${pluginId}:storage`,
    ...(cause === undefined
      ? {}
      : {
          cause: cause instanceof Error
            ? { name: cause.name, message: cause.message }
            : { message: String(cause) },
        }),
  });
}

function cloneJson<TValue extends JsonValue>(value: TValue): TValue {
  validateJson(value, new WeakSet<object>());
  return JSON.parse(JSON.stringify(value)) as TValue;
}

function validateJson(value: unknown, seen: WeakSet<object>): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Plugin data numbers must be finite");
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`Plugin data contains non-JSON value '${typeof value}'`);
  }
  if (seen.has(value)) throw new TypeError("Plugin data must not contain cycles");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) validateJson(item, seen);
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Plugin data objects must use a plain object prototype");
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new TypeError(`Plugin data key '${key}' is not allowed`);
      }
      validateJson(item, seen);
    }
  }
  seen.delete(value);
}

function cloneSnapshot<TData extends JsonValue>(
  snapshot: PluginDataSnapshot<TData>,
): PluginDataSnapshot<TData> {
  return Object.freeze({
    data: snapshot.data === null ? null : cloneJson(snapshot.data),
    version: snapshot.version,
    schemaVersion: snapshot.schemaVersion,
  });
}

function parseEnvelope(serialized: string): StoredEnvelope {
  const parsed: unknown = JSON.parse(serialized);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Plugin storage envelope must be an object");
  }
  const record = parsed as Record<string, unknown>;
  const schemaVersion = record.schemaVersion;
  if (
    schemaVersion !== null &&
    (!Number.isInteger(schemaVersion) || (schemaVersion as number) < 0)
  ) {
    throw new TypeError("Plugin storage schemaVersion must be a non-negative integer or null");
  }
  validateJson(record.data, new WeakSet<object>());
  return {
    schemaVersion: schemaVersion as number | null,
    data: record.data,
  };
}

function serializeEnvelope(data: JsonValue, schemaVersion: number | null): string {
  if (schemaVersion !== null && (!Number.isInteger(schemaVersion) || schemaVersion < 0)) {
    throw new TypeError("Plugin storage schemaVersion must be a non-negative integer");
  }
  return JSON.stringify({ schemaVersion, data: cloneJson(data) });
}

function asRegistrationId(value: string): RegistrationId {
  return value as RegistrationId;
}

interface MemoryRecord {
  readonly serialized: string;
  readonly version: string;
  readonly schemaVersion: number | null;
  readonly corrupt: boolean;
}

/** Deterministic backend for browser hosts, contract tests, and plugin fixtures. */
export class MemoryPluginStorageBackend implements PluginStorageBackend {
  private readonly records = new Map<PluginId, MemoryRecord>();
  private readonly listeners = new Set<(change: PluginStorageBackendChange) => void>();
  private revision = 0;

  async read(pluginId: PluginId): Promise<PluginStorageBackendReadResult> {
    const record = this.records.get(pluginId);
    if (!record) return { status: "missing" };
    if (record.corrupt) {
      return {
        status: "corrupt",
        raw: record.serialized,
        version: record.version,
      };
    }
    return {
      status: "available",
      serialized: record.serialized,
      version: record.version,
    };
  }

  async write(
    pluginId: PluginId,
    serialized: string,
    expectedVersion?: string,
  ): Promise<PluginStorageBackendWriteResult> {
    const current = this.records.get(pluginId);
    if (expectedVersion !== undefined && current?.version !== expectedVersion) {
      return { ok: false, currentVersion: current?.version ?? null };
    }
    const envelope = parseEnvelope(serialized);
    const version = String(++this.revision);
    this.records.set(pluginId, {
      serialized,
      version,
      schemaVersion: envelope.schemaVersion,
      corrupt: false,
    });
    return { ok: true, version };
  }

  subscribe(listener: (change: PluginStorageBackendChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Simulates a host-confirmed external write and notifies runtime caches. */
  putExternal(pluginId: PluginId, data: JsonValue, schemaVersion: number | null = null): string {
    const serialized = serializeEnvelope(data, schemaVersion);
    const version = String(++this.revision);
    this.records.set(pluginId, { serialized, version, schemaVersion, corrupt: false });
    this.notify({ pluginId, version, schemaVersion });
    return version;
  }

  /** Preserves invalid source text so a later save cannot silently erase it. */
  putCorrupt(pluginId: PluginId, raw: string): string {
    const version = String(++this.revision);
    this.records.set(pluginId, {
      serialized: raw,
      version,
      schemaVersion: null,
      corrupt: true,
    });
    this.notify({ pluginId, version, schemaVersion: null });
    return version;
  }

  getRaw(pluginId: PluginId): string | undefined {
    return this.records.get(pluginId)?.serialized;
  }

  private notify(change: PluginStorageBackendChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }
}

/** Application-level owner of isolated, versioned plugin data services. */
export class PluginStorageRuntime implements ManagedResource {
  private readonly backend: PluginStorageBackend;
  private readonly reportDiagnostic: (diagnostic: NexusDiagnostic) => void;
  private readonly records = new Map<PluginId, StorageRecord>();
  private readonly unsubscribeBackend?: () => void;
  private disposed = false;

  constructor(options: PluginStorageRuntimeOptions = {}) {
    this.backend = options.backend ?? new MemoryPluginStorageBackend();
    this.reportDiagnostic = options.reportDiagnostic ?? (() => undefined);
    this.unsubscribeBackend = this.backend.subscribe?.((change) => {
      const record = this.records.get(change.pluginId);
      if (!record || this.disposed) return;
      record.cache = undefined;
      record.corruption = undefined;
      record.events.emit("externalChange", {
        version: change.version,
        schemaVersion: change.schemaVersion,
      });
    });
  }

  createService(
    owner: ResourceOwner,
    registerResource: (resource: ManagedResource) => void,
  ): PluginStorageService {
    if (this.disposed) throw new Error("Plugin storage runtime has been disposed");
    const pluginId = owner.pluginId;
    const record = this.record(pluginId);
    const events: TypedEvents<PluginStorageEventMap> = record.events.createEvents(
      owner,
      registerResource,
    );
    return Object.freeze({
      events,
      loadData: <TData extends JsonValue>() =>
        this.enqueue(record, () => this.loadCurrent<TData>(pluginId, record)),
      saveData: <TData extends JsonValue>(data: TData, options?: PluginDataSaveOptions) => {
        let serialized: string;
        try {
          serialized = serializeEnvelope(data, options?.schemaVersion ?? null);
        } catch (error) {
          const item = diagnostic(
            pluginId,
            "storage-serialization-failed",
            "Plugin data could not be serialized",
            error,
          );
          this.reportDiagnostic(item);
          return Promise.resolve({ ok: false as const, diagnostic: item });
        }
        return this.enqueue(record, async () => {
          try {
            await this.loadCurrent(pluginId, record, true);
          } catch (error) {
            const item = this.storageCorruptionDiagnostic(error);
            if (item) return { ok: false as const, diagnostic: item };
            throw error;
          }
          return this.saveSerialized(pluginId, record, serialized, options);
        });
      },
      migrateData: <TData extends JsonValue>(options: {
        readonly targetSchemaVersion: number;
        readonly migrate: (
          current: PluginDataSnapshot<JsonValue>,
        ) => TData | Promise<TData>;
      }) => this.enqueue(record, () => this.migrate(pluginId, record, options)),
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeBackend?.();
    await Promise.all([...this.records.values()].map((record) => record.tail));
    this.records.clear();
  }

  private record(pluginId: PluginId): StorageRecord {
    let record = this.records.get(pluginId);
    if (!record) {
      record = {
        cache: undefined,
        tail: Promise.resolve(),
        events: new TypedEventRegistry<PluginStorageEventMap>({
          serviceId: `${pluginId}:storage-events`,
          events: { externalChange: null, corrupt: null },
          reportDiagnostic: this.reportDiagnostic,
        }),
      };
      this.records.set(pluginId, record);
    }
    return record;
  }

  private enqueue<T>(record: StorageRecord, operation: () => Promise<T>): Promise<T> {
    const result = record.tail.then(operation, operation);
    record.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async loadCurrent<TData extends JsonValue>(
    pluginId: PluginId,
    record: StorageRecord,
    force = false,
  ): Promise<PluginDataSnapshot<TData>> {
    if (!force && record.cache !== undefined) {
      return cloneSnapshot(record.cache as PluginDataSnapshot<TData>);
    }
    const loaded = await this.backend.read(pluginId);
    if (loaded.status === "missing") {
      const empty = Object.freeze({ data: null, version: null, schemaVersion: null });
      record.cache = empty;
      record.corruption = undefined;
      return empty as PluginDataSnapshot<TData>;
    }
    if (loaded.status === "corrupt") {
      this.throwStorageCorruption(pluginId, record, loaded.cause);
    }
    try {
      const envelope = parseEnvelope(loaded.serialized);
      const snapshot: PluginDataSnapshot = Object.freeze({
        data: cloneJson(envelope.data),
        version: loaded.version,
        schemaVersion: envelope.schemaVersion,
      });
      record.cache = snapshot;
      record.corruption = undefined;
      return cloneSnapshot(snapshot as PluginDataSnapshot<TData>);
    } catch (error) {
      this.throwStorageCorruption(pluginId, record, error);
    }
  }

  private throwStorageCorruption(
    pluginId: PluginId,
    record: StorageRecord,
    cause?: unknown,
  ): never {
    const existing = record.corruption;
    const item = existing ?? diagnostic(
      pluginId,
      "storage-corrupt",
      "Stored plugin data is corrupt; the original data has been preserved",
      cause,
    );
    record.cache = undefined;
    record.corruption = item;
    if (!existing) {
      this.reportDiagnostic(item);
      record.events.emit("corrupt", { diagnostic: item, recoveryAvailable: true });
    }
    throw Object.assign(new Error(item.message), { diagnostic: item });
  }

  private storageCorruptionDiagnostic(error: unknown): NexusDiagnostic | null {
    if (typeof error !== "object" || error === null || !("diagnostic" in error)) return null;
    const item = (error as { readonly diagnostic?: unknown }).diagnostic;
    if (typeof item !== "object" || item === null || !("code" in item)) return null;
    return item.code === "storage-corrupt" ? (item as NexusDiagnostic) : null;
  }

  private async saveSerialized(
    pluginId: PluginId,
    record: StorageRecord,
    serialized: string,
    options: PluginDataSaveOptions | undefined,
  ): Promise<ServiceResult<PluginDataSaveResult>> {
    const result = await this.backend.write(
      pluginId,
      serialized,
      options?.expectedVersion,
    );
    if (!result.ok) {
      const item = diagnostic(
        pluginId,
        "file-version-conflict",
        `Plugin data version conflict (current version: ${result.currentVersion ?? "missing"})`,
      );
      this.reportDiagnostic(item);
      record.cache = undefined;
      return { ok: false, diagnostic: item };
    }
    const envelope = parseEnvelope(serialized);
    record.cache = Object.freeze({
      data: cloneJson(envelope.data),
      version: result.version,
      schemaVersion: envelope.schemaVersion,
    });
    return {
      ok: true,
      value: Object.freeze({
        version: result.version,
        schemaVersion: envelope.schemaVersion,
      }),
    };
  }

  private async migrate<TData extends JsonValue>(
    pluginId: PluginId,
    record: StorageRecord,
    options: {
      readonly targetSchemaVersion: number;
      readonly migrate: (
        current: PluginDataSnapshot<JsonValue>,
      ) => TData | Promise<TData>;
    },
  ): Promise<ServiceResult<PluginDataSnapshot<TData>>> {
    if (!Number.isInteger(options.targetSchemaVersion) || options.targetSchemaVersion < 0) {
      const item = diagnostic(
        pluginId,
        "storage-migration-failed",
        "Migration target schema version must be a non-negative integer",
      );
      return { ok: false, diagnostic: item };
    }
    try {
      const current = await this.loadCurrent<JsonValue>(pluginId, record, true);
      if (current.schemaVersion === options.targetSchemaVersion) {
        return { ok: true, value: cloneSnapshot(current as PluginDataSnapshot<TData>) };
      }
      if (
        current.schemaVersion !== null &&
        current.schemaVersion > options.targetSchemaVersion
      ) {
        throw new RangeError("Plugin data cannot be migrated to an older schema version");
      }
      const migrated = await options.migrate(cloneSnapshot(current));
      const serialized = serializeEnvelope(migrated, options.targetSchemaVersion);
      const saved = await this.saveSerialized(pluginId, record, serialized, {
        schemaVersion: options.targetSchemaVersion,
        ...(current.version === null ? {} : { expectedVersion: current.version }),
      });
      if (!saved.ok) return saved;
      return {
        ok: true,
        value: cloneSnapshot(record.cache as PluginDataSnapshot<TData>),
      };
    } catch (error) {
      const existing = error && typeof error === "object" && "diagnostic" in error
        ? (error as { diagnostic: NexusDiagnostic }).diagnostic
        : null;
      const item = existing ?? diagnostic(
        pluginId,
        "storage-migration-failed",
        "Plugin data migration failed",
        error,
      );
      this.reportDiagnostic(item);
      return { ok: false, diagnostic: item };
    }
  }
}

/** Explicit fallback for hosts without a platform-backed secure store. */
export class UnsupportedSecretStorage implements SecretStorageService {
  constructor(private readonly reason = "This host does not provide secure secret storage") {}

  get(_key: string): Promise<ServiceResult<string | null>> {
    return Promise.resolve(this.unsupported());
  }

  set(_key: string, _value: string): Promise<ServiceResult<void>> {
    return Promise.resolve(this.unsupported());
  }

  delete(_key: string): Promise<ServiceResult<boolean>> {
    return Promise.resolve(this.unsupported());
  }

  list(): Promise<ServiceResult<readonly SecretDescriptor[]>> {
    return Promise.resolve(this.unsupported());
  }

  private unsupported<T>(): ServiceResult<T> {
    return {
      ok: false,
      diagnostic: {
        code: "capability-unsupported",
        severity: "error",
        phase: "runtime",
        message: this.reason,
      },
    };
  }
}
