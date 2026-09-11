import type {
  ContributionRegistration,
  EditorContext,
  EditorDomEventHookOptions,
  EditorDomEventType,
  EditorDomEventHandler,
  EditorExtensionFactory,
  EditorExtensionOptions,
  EditorHostEventMap,
  EditorHostService,
  EditorId,
  EditorInputTargetAdapter,
  EditorSurfaceContext,
  ManagedResource,
  NexusDiagnostic,
  NexusFile,
  NexusView,
  RegistrationId,
  RegistrationResult,
  RegistrationState,
  ResourceOwner,
  Subscription,
  TypedEvents,
  VaultPath,
  WindowContext,
  WorkspaceLeaf,
} from "@floatboat/nexus-plugin-api";
import {
  MAX_PLUGIN_PRIORITY,
  MIN_PLUGIN_PRIORITY,
} from "@floatboat/nexus-plugin-api";
import type {
  EditorAPI,
  EditorContributionRegistration,
} from "@floatboat/nexus-core";

export interface EditorHostAttachOptions {
  readonly editor: EditorAPI;
  readonly editorId?: EditorId;
  readonly surface: EditorSurfaceContext;
  readonly file?: NexusFile | null;
  readonly sourcePath?: VaultPath | null;
  readonly view?: NexusView | null;
  readonly leaf?: WorkspaceLeaf | null;
  readonly window?: WindowContext | null;
}

export interface EditorHostContextPatch {
  readonly surface?: EditorSurfaceContext;
  readonly file?: NexusFile | null;
  readonly sourcePath?: VaultPath | null;
  readonly view?: NexusView | null;
  readonly leaf?: WorkspaceLeaf | null;
  readonly window?: WindowContext | null;
}

export interface EditorHostAttachment {
  readonly editorId: EditorId;
  readonly context: EditorContext;
  readonly ready: Promise<void>;
  readonly detached: boolean;
  updateContext(patch: EditorHostContextPatch): Promise<EditorContext>;
  markRecent(): void;
  detach(): Promise<void>;
}

export type EditorHostManagedRegistration = ContributionRegistration &
  ManagedResource & {
  /** Resolves after the contribution has been committed to every attached editor. */
  activate(): Promise<void>;
};

export type EditorHostResourceRegistrar = (resource: ManagedResource) => void;

export interface EditorHostRegistryOptions {
  readonly reportDiagnostic?: (diagnostic: NexusDiagnostic) => void;
  readonly editorIdPrefix?: string;
}

interface Deferred<T = void> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

interface EditorRecord {
  context: EditorContext;
  attached: boolean;
  ready: boolean;
  isolated: boolean;
  readonly detachedSignal: Deferred;
  readonly physical: Map<string, EditorContributionRegistration>;
}

interface ContributionEntry {
  readonly key: string;
  readonly localId: string;
  readonly globalId: string;
  readonly owner: ResourceOwner;
  readonly ownerId: string;
  readonly priority: number;
  readonly sequence: number;
  readonly matches: (context: EditorContext) => boolean;
  readonly install: (context: EditorContext) => EditorContributionRegistration | null;
  state: RegistrationState;
}

interface JournalItem {
  readonly record: EditorRecord;
  readonly registration: EditorContributionRegistration;
}

interface EventEntry<K extends keyof EditorHostEventMap = keyof EditorHostEventMap> {
  readonly key: string;
  readonly event: K;
  readonly handler: (payload: EditorHostEventMap[K]) => void;
  readonly owner: ResourceOwner;
  readonly priority: number;
  readonly sequence: number;
  state: RegistrationState;
}

function deferred<T = void>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function asRegistrationId(value: string): RegistrationId {
  return value as RegistrationId;
}

function asEditorId(value: string): EditorId {
  return value as EditorId;
}

function ownerId(owner: ResourceOwner): string {
  return String(owner.pluginId);
}

function cloneContext(
  editorId: EditorId,
  options: EditorHostAttachOptions,
): EditorContext {
  return Object.freeze({
    editorId,
    editor: options.editor,
    contributions: options.editor.getContributionSink(),
    file: options.file ?? null,
    sourcePath: options.sourcePath ?? options.file?.path ?? null,
    view: options.view ?? null,
    leaf: options.leaf ?? null,
    window: options.window ?? null,
    surface: Object.freeze({ ...options.surface }),
  });
}

function normalizePriority(priority: number | undefined): number {
  const value = priority ?? 0;
  if (
    !Number.isInteger(value) ||
    value < MIN_PLUGIN_PRIORITY ||
    value > MAX_PLUGIN_PRIORITY
  ) {
    throw new RangeError(
      `Editor contribution priority must be an integer between ${MIN_PLUGIN_PRIORITY} and ${MAX_PLUGIN_PRIORITY}`,
    );
  }
  return value;
}

function validateLocalId(localId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(localId)) {
    throw new TypeError(
      "Editor contribution id must start with an alphanumeric character and contain only alphanumerics, '.', '_' or '-'",
    );
  }
}

function diagnostic(
  code: NexusDiagnostic["code"],
  phase: NexusDiagnostic["phase"],
  message: string,
  entry?: ContributionEntry,
  severity: NexusDiagnostic["severity"] = "error",
  cause?: unknown,
): NexusDiagnostic {
  return {
    code,
    phase,
    severity,
    message,
    plugin: entry
      ? { id: entry.owner.pluginId, version: "unknown" }
      : undefined,
    resourceId: entry?.globalId,
    cause:
      cause instanceof Error
        ? { name: cause.name, message: cause.message }
        : cause === undefined
          ? undefined
          : { message: String(cause) },
  };
}

export class EditorContributionCommitError extends Error {
  readonly rollbackErrors: readonly unknown[];

  constructor(message: string, cause: unknown, rollbackErrors: readonly unknown[]) {
    super(message, { cause });
    this.name = "EditorContributionCommitError";
    this.rollbackErrors = rollbackErrors;
  }
}

class ManagedEditorSubscription implements Subscription, ManagedResource {
  private disposePromise: Promise<void> | null = null;

  constructor(
    private readonly entry: EventEntry,
    private readonly remove: (entry: EventEntry) => void,
  ) {}

  get id(): RegistrationId {
    return asRegistrationId(this.entry.key);
  }

  get owner(): ResourceOwner {
    return this.entry.owner;
  }

  get state(): RegistrationState {
    return this.entry.state;
  }

  get disposed(): boolean {
    return this.entry.state === "disposed";
  }

  get eventName(): string {
    return String(this.entry.event);
  }

  activate(): void {
    if (this.entry.state === "staged") this.entry.state = "active";
  }

  quiesce(): void {
    if (this.entry.state === "staged" || this.entry.state === "active") {
      this.entry.state = "quiescing";
    }
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.quiesce();
    this.entry.state = "disposed";
    this.remove(this.entry);
    this.disposePromise = Promise.resolve();
    return this.disposePromise;
  }
}

/**
 * Runtime-owned registry for editor instances and owner-scoped contributions.
 * "Recent" remains an independent nullable hint and emits only on identity
 * changes so consumers can update per-window projections without polling.
 */
export class EditorHostRegistry {
  private readonly records = new Map<EditorId, EditorRecord>();
  private readonly attachedByEditor = new WeakMap<EditorAPI, EditorRecord>();
  private readonly usedEditorIds = new Set<EditorId>();
  private readonly activeEntries = new Map<string, ContributionEntry>();
  private readonly reservedContributionIds = new Set<string>();
  private readonly eventEntries = new Map<string, EventEntry>();
  private readonly reportDiagnostic: (diagnostic: NexusDiagnostic) => void;
  private readonly editorIdPrefix: string;
  private mutationTail: Promise<void> = Promise.resolve();
  private editorSequence = 0;
  private contributionSequence = 0;
  private registrationSequence = 0;
  private eventSequence = 0;
  private recentEditorId: EditorId | null = null;

  constructor(options: EditorHostRegistryOptions = {}) {
    this.reportDiagnostic = options.reportDiagnostic ?? (() => undefined);
    this.editorIdPrefix = options.editorIdPrefix ?? "editor";
  }

  attach(options: EditorHostAttachOptions): EditorHostAttachment {
    if (this.attachedByEditor.has(options.editor)) {
      throw new Error("The EditorAPI instance is already attached");
    }
    const editorId = options.editorId ?? this.nextEditorId();
    if (this.usedEditorIds.has(editorId)) {
      throw new Error(`Editor id '${editorId}' has already been used`);
    }

    const record: EditorRecord = {
      context: cloneContext(editorId, options),
      attached: true,
      ready: false,
      isolated: false,
      detachedSignal: deferred(),
      physical: new Map(),
    };
    this.usedEditorIds.add(editorId);
    this.records.set(editorId, record);
    this.attachedByEditor.set(options.editor, record);

    const ready = this.enqueue(async () => {
      if (!record.attached) return;
      const journal: JournalItem[] = [];
      try {
        for (const entry of this.sortedActiveEntries()) {
          const installed = await this.installEntry(entry, record);
          if (installed) journal.push(installed);
        }
      } catch (error) {
        const rollbackErrors = await this.rollback(journal);
        this.removeRecord(record);
        if (rollbackErrors.length > 0) this.isolateRollbackFailures(rollbackErrors);
        throw new EditorContributionCommitError(
          `Failed to attach editor '${editorId}'`,
          error,
          rollbackErrors.map((item) => item.error),
        );
      }
      if (!record.attached) return;
      record.ready = true;
      this.emit("attached", record.context);
    });

    let detachPromise: Promise<void> | null = null;
    const attachment: EditorHostAttachment = {
      editorId,
      get context() {
        return record.context;
      },
      ready,
      get detached() {
        return !record.attached;
      },
      updateContext: (patch) => this.updateContext(record, patch),
      markRecent: () => this.markRecent(editorId),
      detach: () => {
        if (detachPromise) return detachPromise;
        this.removeRecord(record);
        detachPromise = this.disposeRecord(record);
        return detachPromise;
      },
    };
    return attachment;
  }

  get(editorId: EditorId): EditorContext | undefined {
    const record = this.records.get(editorId);
    return record?.attached && !record.isolated ? record.context : undefined;
  }

  list(): readonly EditorContext[] {
    return Array.from(this.records.values())
      .filter((record) => record.attached && !record.isolated)
      .map((record) => record.context);
  }

  getRecent(): EditorContext | null {
    return this.recentEditorId ? this.get(this.recentEditorId) ?? null : null;
  }

  markRecent(editorId: EditorId): void {
    const editor = this.get(editorId);
    if (!editor || this.recentEditorId === editorId) return;
    this.recentEditorId = editorId;
    this.emit("recentChanged", { editor });
  }

  createService(
    owner: ResourceOwner,
    registerResource: EditorHostResourceRegistrar,
  ): EditorHostService {
    const events: TypedEvents<EditorHostEventMap> = {
      on: (event, handler, options) => {
        const subscription = this.subscribe(
          owner,
          event,
          handler,
          options?.priority,
        );
        registerResource(subscription);
        return subscription;
      },
    };
    return {
      events,
      get: (editorId) => this.get(editorId),
      list: () => this.list(),
      getRecent: () => this.getRecent(),
      registerEditorExtension: (extension, options) => {
        const result = this.registerEditorExtension(owner, extension, options);
        if (result.ok) registerResource(result.registration);
        return result;
      },
      registerDomEvent: (event, handler, options) => {
        const result = this.registerDomEvent(owner, event, handler, options);
        if (result.ok) registerResource(result.registration);
        return result;
      },
      registerInputTarget: (root, target, options) => {
        const result = this.registerInputTarget(owner, root, target, options);
        if (result.ok) registerResource(result.registration);
        return result;
      },
    };
  }

  registerEditorExtension(
    owner: ResourceOwner,
    extension: ReturnType<EditorExtensionFactory> | EditorExtensionFactory,
    options: EditorExtensionOptions,
  ): RegistrationResult<EditorHostManagedRegistration> {
    try {
      validateLocalId(options.id);
      const priority = normalizePriority(options.priority);
      return this.createContribution(
        owner,
        options.id,
        priority,
        (context) => options.matches?.(context) ?? true,
        (context) => {
          const resolved = typeof extension === "function" ? extension(context) : extension;
          return context.contributions.registerExtension(ownerId(owner), resolved);
        },
      );
    } catch (error) {
      return {
        ok: false,
        diagnostic: diagnostic(
          "registration-conflict",
          "runtime",
          error instanceof Error ? error.message : String(error),
          undefined,
          "error",
          error,
        ),
      };
    }
  }

  registerDomEvent<K extends EditorDomEventType>(
    owner: ResourceOwner,
    event: K,
    handler: EditorDomEventHandler<K>,
    options: EditorDomEventHookOptions & {
      readonly matches?: (context: EditorContext) => boolean;
    } = {},
  ): RegistrationResult<EditorHostManagedRegistration> {
    const localId = `dom-${event}-${++this.registrationSequence}`;
    try {
      const priority = normalizePriority(options.priority);
      return this.createContribution(
        owner,
        localId,
        priority,
        (context) => options.matches?.(context) ?? true,
        (context) => context.contributions.registerDomEvent(
          ownerId(owner),
          event,
          (domEvent, coreContext) =>
            handler(domEvent, {
              ...context,
              surface: Object.freeze({
                ...context.surface,
                kind: coreContext.surface,
              }),
              inputTarget: coreContext.inputTarget
                ? {
                    id: coreContext.inputTarget.id ?? "anonymous",
                    kind: coreContext.inputTarget.kind,
                    getSelectedText: () => coreContext.inputTarget!.getSelectedText(),
                    ...(coreContext.inputTarget.captureSelection
                      ? { captureSelection: coreContext.inputTarget.captureSelection.bind(coreContext.inputTarget) }
                      : {}),
                    replaceSelection: (text) =>
                      coreContext.replaceTargetSelection(text)
                        ? { ok: true, value: undefined }
                        : {
                            ok: false,
                            diagnostic: {
                              code: "input-target-unsupported",
                              severity: "error",
                              phase: "runtime",
                              message: "The active editor surface cannot replace its selection",
                            },
                          },
                    ...("copySelection" in coreContext.inputTarget &&
                    typeof coreContext.inputTarget.copySelection === "function"
                      ? { copySelection: () => coreContext.inputTarget!.copySelection!() }
                      : {}),
                  }
                : null,
              replaceTargetSelection: (text) =>
                coreContext.replaceTargetSelection(text)
                  ? { ok: true, value: undefined }
                  : {
                      ok: false,
                      diagnostic: {
                        code: "input-target-unsupported",
                        severity: "error",
                        phase: "runtime",
                        message: "The active editor surface cannot replace its selection",
                      },
                    },
            }),
          options,
        ),
      );
    } catch (error) {
      return {
        ok: false,
        diagnostic: diagnostic(
          "registration-conflict",
          "runtime",
          error instanceof Error ? error.message : String(error),
          undefined,
          "error",
          error,
        ),
      };
    }
  }

  registerInputTarget(
    owner: ResourceOwner,
    root: HTMLElement,
    target: EditorInputTargetAdapter,
    options: { readonly editorId?: EditorId } = {},
  ): RegistrationResult<EditorHostManagedRegistration> {
    const localId = `input-target-${++this.registrationSequence}`;
    return this.createContribution(
      owner,
      localId,
      0,
      (context) =>
        (!options.editorId || context.editorId === options.editorId) &&
        context.surface.root.contains(root),
      (context) => context.contributions.registerInputTarget(ownerId(owner), root, {
          id: target.id,
          kind: target.kind,
          getSelectedText: () => target.getSelectedText(),
          replaceSelection: (text) => target.replaceSelection(text).ok,
          ...(target.captureSelection ? { captureSelection: target.captureSelection.bind(target) } : {}),
          ...(target.copySelection
            ? { copySelection: () => target.copySelection!() }
            : {}),
        }),
    );
  }

  private createContribution(
    owner: ResourceOwner,
    localId: string,
    priority: number,
    matches: ContributionEntry["matches"],
    install: ContributionEntry["install"],
  ): RegistrationResult<EditorHostManagedRegistration> {
    const globalId = `${ownerId(owner)}:${localId}`;
    if (this.reservedContributionIds.has(globalId)) {
      return {
        ok: false,
        diagnostic: {
          code: "registration-conflict",
          severity: "error",
          phase: "runtime",
          message: `Editor contribution '${globalId}' is already registered`,
          plugin: { id: owner.pluginId, version: "unknown" },
          resourceId: globalId,
        },
      };
    }
    this.reservedContributionIds.add(globalId);
    const entry: ContributionEntry = {
      key: `editor-registration:${++this.registrationSequence}`,
      localId,
      globalId,
      owner,
      ownerId: ownerId(owner),
      priority,
      sequence: this.contributionSequence++,
      matches,
      install,
      state: "staged",
    };
    return {
      ok: true,
      registration: this.createManagedRegistration(entry),
    };
  }

  private createManagedRegistration(entry: ContributionEntry): EditorHostManagedRegistration {
    let activation: Promise<void> | null = null;
    let disposal: Promise<void> | null = null;
    const activate = (): Promise<void> => {
      if (activation) return activation;
      activation = this.enqueue(async () => {
        if (entry.state !== "staged") return;
        const journal: JournalItem[] = [];
        try {
          for (const record of Array.from(this.records.values())) {
            if (!record.attached || record.isolated) continue;
            const installed = await this.installEntry(entry, record);
            if (installed) journal.push(installed);
          }
        } catch (error) {
          const rollbackErrors = await this.rollback(journal);
          if (rollbackErrors.length > 0) this.isolateRollbackFailures(rollbackErrors);
          this.reportDiagnostic(
            diagnostic(
              "callback-failed",
              "loading",
              `Failed to commit editor contribution '${entry.globalId}'`,
              entry,
              "error",
              error,
            ),
          );
          throw new EditorContributionCommitError(
            `Failed to commit editor contribution '${entry.globalId}'`,
            error,
            rollbackErrors.map((item) => item.error),
          );
        }
        if (entry.state !== "staged") {
          await this.rollback(journal);
          return;
        }
        entry.state = "active";
        this.activeEntries.set(entry.key, entry);
      });
      return activation;
    };
    const quiesce = (): void => {
      if (entry.state === "staged" || entry.state === "active") {
        entry.state = "quiescing";
        this.activeEntries.delete(entry.key);
      }
    };
    const dispose = (): Promise<void> => {
      if (disposal) return disposal;
      quiesce();
      disposal = this.enqueue(async () => {
        const errors: unknown[] = [];
        const records = Array.from(this.records.values()).reverse();
        for (const record of records) {
          const physical = record.physical.get(entry.key);
          if (!physical) continue;
          record.physical.delete(entry.key);
          try {
            await physical.dispose();
          } catch (error) {
            errors.push(error);
            this.reportDiagnostic(
              diagnostic(
                "lifecycle-cleanup-failed",
                "unloading",
                `Failed to remove editor contribution '${entry.globalId}' from '${record.context.editorId}'`,
                entry,
                "error",
                error,
              ),
            );
          }
        }
        entry.state = "disposed";
        this.reservedContributionIds.delete(entry.globalId);
        if (errors.length > 0) {
          throw new AggregateError(
            errors,
            `Failed to completely dispose editor contribution '${entry.globalId}'`,
          );
        }
      });
      return disposal;
    };
    return {
      id: asRegistrationId(entry.key),
      owner: entry.owner,
      localId: entry.localId,
      globalId: entry.globalId,
      priority: entry.priority,
      get state() {
        return entry.state;
      },
      get disposed() {
        return entry.state === "disposed";
      },
      activate,
      quiesce,
      dispose,
    };
  }

  private async installEntry(
    entry: ContributionEntry,
    record: EditorRecord,
  ): Promise<JournalItem | null> {
    if (!record.attached || record.isolated) return null;
    if (!entry.matches(record.context)) return null;
    const registration = entry.install(record.context);
    if (!registration) return null;
    record.physical.set(entry.key, registration);

    const outcome = await Promise.race([
      registration.ready.then(
        () => ({ kind: "ready" as const }),
        (error: unknown) => ({ kind: "error" as const, error }),
      ),
      record.detachedSignal.promise.then(() => ({ kind: "detached" as const })),
    ]);
    if (outcome.kind === "detached" || !record.attached) {
      record.physical.delete(entry.key);
      void registration.dispose().catch((error) => {
        this.reportDiagnostic(
          diagnostic(
            "lifecycle-cleanup-failed",
            "unloading",
            `Failed to remove contribution from detached editor '${record.context.editorId}'`,
            entry,
            "error",
            error,
          ),
        );
      });
      return null;
    }
    if (outcome.kind === "error") {
      record.physical.delete(entry.key);
      try {
        await registration.dispose();
      } catch (cleanupError) {
        this.isolate(record, entry, cleanupError);
      }
      throw outcome.error;
    }
    return { record, registration };
  }

  private async rollback(
    journal: readonly JournalItem[],
  ): Promise<Array<{ record: EditorRecord; error: unknown }>> {
    const errors: Array<{ record: EditorRecord; error: unknown }> = [];
    for (const item of Array.from(journal).reverse()) {
      for (const [key, physical] of item.record.physical) {
        if (physical === item.registration) item.record.physical.delete(key);
      }
      try {
        await item.registration.dispose();
      } catch (error) {
        errors.push({ record: item.record, error });
      }
    }
    return errors;
  }

  private isolateRollbackFailures(
    failures: readonly { record: EditorRecord; error: unknown }[],
  ): void {
    for (const failure of failures) {
      this.isolate(failure.record, undefined, failure.error);
    }
  }

  private isolate(
    record: EditorRecord,
    entry: ContributionEntry | undefined,
    error: unknown,
  ): void {
    record.isolated = true;
    this.removeRecord(record);
    this.reportDiagnostic(
      diagnostic(
        "lifecycle-cleanup-failed",
        "rollback",
        `Editor '${record.context.editorId}' was isolated after contribution rollback failed`,
        entry,
        "fatal",
        error,
      ),
    );
  }

  private removeRecord(record: EditorRecord): void {
    if (!record.attached) return;
    record.attached = false;
    record.detachedSignal.resolve();
    this.records.delete(record.context.editorId);
    this.attachedByEditor.delete(record.context.editor);
    if (this.recentEditorId === record.context.editorId) {
      this.recentEditorId = null;
      this.emit("recentChanged", { editor: null });
    }
    if (record.ready) this.emit("detached", { editorId: record.context.editorId });
  }

  private async disposeRecord(record: EditorRecord): Promise<void> {
    const errors: unknown[] = [];
    const registrations = Array.from(record.physical.values()).reverse();
    record.physical.clear();
    for (const registration of registrations) {
      try {
        await registration.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `Failed to detach editor '${record.context.editorId}' cleanly`,
      );
    }
  }

  private updateContext(
    record: EditorRecord,
    patch: EditorHostContextPatch,
  ): Promise<EditorContext> {
    return this.enqueue(async () => {
      if (!record.attached || record.isolated) {
        throw new Error(`Editor '${record.context.editorId}' is detached`);
      }
      const current = record.context;
      const next = Object.freeze({
        ...current,
        ...patch,
        surface: patch.surface
          ? Object.freeze({ ...patch.surface })
          : current.surface,
      });
      const prepared = new Map<string, EditorContributionRegistration>();
      const journal: EditorContributionRegistration[] = [];
      try {
        for (const entry of this.sortedActiveEntries()) {
          if (!entry.matches(next)) continue;
          const registration = entry.install(next);
          if (!registration) continue;
          journal.push(registration);
          const outcome = await Promise.race([
            registration.ready.then(
              () => ({ kind: "ready" as const }),
              (error: unknown) => ({ kind: "error" as const, error }),
            ),
            record.detachedSignal.promise.then(() => ({ kind: "detached" as const })),
          ]);
          if (outcome.kind === "detached" || !record.attached) {
            throw new Error(`Editor '${record.context.editorId}' detached during context update`);
          }
          if (outcome.kind === "error") throw outcome.error;
          prepared.set(entry.key, registration);
        }
      } catch (error) {
        const rollbackErrors: unknown[] = [];
        for (const registration of journal.reverse()) {
          try {
            await registration.dispose();
          } catch (cleanupError) {
            rollbackErrors.push(cleanupError);
          }
        }
        if (rollbackErrors.length > 0) {
          this.isolate(record, undefined, new AggregateError(rollbackErrors));
        }
        throw new EditorContributionCommitError(
          `Failed to update context for editor '${current.editorId}'`,
          error,
          rollbackErrors,
        );
      }

      const previous = [...record.physical.values()].reverse();
      record.context = next;
      record.physical.clear();
      for (const [key, registration] of prepared) record.physical.set(key, registration);
      const cleanupErrors: unknown[] = [];
      for (const registration of previous) {
        try {
          await registration.dispose();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (cleanupErrors.length > 0) {
        this.isolate(record, undefined, new AggregateError(cleanupErrors));
        throw new AggregateError(
          cleanupErrors,
          `Failed to replace contributions for editor '${current.editorId}'`,
        );
      }
      this.emit("contextChanged", next);
      return next;
    });
  }

  private subscribe<K extends keyof EditorHostEventMap>(
    owner: ResourceOwner,
    event: K,
    handler: (payload: EditorHostEventMap[K]) => void,
    priority: number | undefined,
  ): ManagedEditorSubscription {
    const key = `editor-event:${++this.eventSequence}`;
    const entry: EventEntry<K> = {
      key,
      event,
      handler,
      owner,
      priority: normalizePriority(priority),
      sequence: this.eventSequence,
      state: "staged",
    };
    const erasedEntry = entry as unknown as EventEntry;
    this.eventEntries.set(key, erasedEntry);
    return new ManagedEditorSubscription(erasedEntry, (item) => {
      this.eventEntries.delete(item.key);
    });
  }

  private emit<K extends keyof EditorHostEventMap>(
    event: K,
    payload: EditorHostEventMap[K],
  ): void {
    const entries = Array.from(this.eventEntries.values())
      .filter((entry) => entry.event === event && entry.state === "active")
      .sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
    for (const entry of entries) {
      if (entry.state !== "active") continue;
      try {
        (entry.handler as (value: EditorHostEventMap[K]) => void)(payload);
      } catch (error) {
        this.reportDiagnostic({
          code: "callback-failed",
          severity: "error",
          phase: "callback",
          message: `Editor host '${String(event)}' listener failed`,
          plugin: { id: entry.owner.pluginId, version: "unknown" },
          resourceId: entry.key,
          cause:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { message: String(error) },
        });
      }
    }
  }

  private sortedActiveEntries(): readonly ContributionEntry[] {
    return Array.from(this.activeEntries.values()).sort(
      (left, right) => right.priority - left.priority || left.sequence - right.sequence,
    );
  }

  private nextEditorId(): EditorId {
    do {
      this.editorSequence += 1;
    } while (this.usedEditorIds.has(asEditorId(`${this.editorIdPrefix}:${this.editorSequence}`)));
    return asEditorId(`${this.editorIdPrefix}:${this.editorSequence}`);
  }

  private enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
