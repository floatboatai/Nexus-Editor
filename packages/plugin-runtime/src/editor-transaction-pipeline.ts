import type {
  ContributionRegistration,
  EditorContext,
  EditorId,
  EditorTransaction,
  EditorTransactionFilter,
  EditorTransactionService,
  EditorUpdateContext,
  ManagedResource,
  NexusDiagnostic,
  OperationId,
  RegistrationId,
  RegistrationResult,
  RegistrationState,
  ResourceOwner,
  ServiceResult,
} from "@floatboat/nexus-plugin-api";
import type {
  CoreEditorTransactionDispatchResult,
  CoreEditorTransactionFilter,
  CoreEditorTransactionFilterResult,
  CoreEditorUpdateListener,
  EditorContributionRegistration,
} from "@floatboat/nexus-core";

import {
  adoptAbandonedThenable,
  createDiagnostic,
  createTransactionFrame,
  DEFAULT_FILTER_REJECTION_REASON,
  DIAGNOSTIC_ATTRIBUTION_FAILED_MESSAGE,
  DISPOSED_MESSAGE,
  DESTROYED_REGISTRATION_MESSAGE,
  FILTER_CALLBACK_FAILED_MESSAGE,
  isThenable,
  LISTENER_ASYNC_RESULT_MESSAGE,
  LISTENER_CALLBACK_FAILED_MESSAGE,
  normalizeTransactionPriority,
  REENTRANT_DISPATCH_MESSAGE,
  toCoreDispatchTransaction,
  toCoreFilterResult,
  toFilterContext,
  toOperationId,
  toPluginTransaction,
  toRegistrationId,
  toUpdateContext,
  type TransactionFrame,
} from "./editor-transaction-adapters";

export interface EditorTransactionPipelineOptions {
  readonly reportDiagnostic?: (diagnostic: NexusDiagnostic) => void;
  /** 活取：切文件 / 换 surface 后必须反映最新上下文。 */
  readonly context: () => EditorContext;
}

type TransactionHookKind = "filter" | "listener";

const REGISTRATION_RESOURCE_FAILED_MESSAGE =
  "The host could not register the transaction hook resource";
const INVALID_DISPATCH_TRANSACTION_MESSAGE = "dispatch requires an editor transaction object";
const DISPATCH_FAILED_MESSAGE = "Editor transaction dispatch failed";

function isObjectLike(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

interface TransactionHookOptions {
  readonly key: string;
  readonly localId: string;
  readonly globalId: string;
  readonly owner: ResourceOwner;
  readonly kind: TransactionHookKind;
  readonly priority: number;
  /** Installs the physical core hook; called by activate(), never by register(). */
  readonly install: () => EditorContributionRegistration;
  readonly forget: (registration: TransactionHookRegistration) => void;
  readonly reportDiagnostic: (diagnostic: NexusDiagnostic) => void;
}

/**
 * Registration handle for one plugin transaction hook. It stays staged until the
 * owning component activates it, and mirrors the platform's staged -> active ->
 * quiescing -> disposed lifecycle.
 *
 * staged    - known to this service only; nothing has been installed into core yet.
 * active    - the core hook exists.
 * quiescing - already forgotten by the service, physical hook not released yet.
 * disposed  - released (idempotent).
 * 状态机：staged（只登记在本服务，未装 core 钩子）-> active（钩子已装）
 *   -> quiescing（已从本服务摘除、物理钩子尚在释放中）-> disposed（已释放，幂等）。
 * 关键约束：activate() 之前绝不接触 core —— 注册成功不等于已生效。
 */
class TransactionHookRegistration implements ContributionRegistration, ManagedResource {
  readonly key: string;
  readonly localId: string;
  readonly globalId: string;
  readonly owner: ResourceOwner;
  readonly kind: TransactionHookKind;
  readonly priority: number;
  private readonly options: TransactionHookOptions;
  private currentState: RegistrationState = "staged";
  private physical: EditorContributionRegistration | null = null;
  private physicalDisposal: Promise<void> | null = null;
  private disposal: Promise<void> | null = null;

  constructor(options: TransactionHookOptions) {
    this.options = options;
    this.key = options.key;
    this.localId = options.localId;
    this.globalId = options.globalId;
    this.owner = options.owner;
    this.kind = options.kind;
    this.priority = options.priority;
  }

  get id(): RegistrationId {
    return toRegistrationId(this.key);
  }

  get state(): RegistrationState {
    return this.currentState;
  }

  get disposed(): boolean {
    return this.currentState === "disposed";
  }

  activate(): void {
    if (this.currentState !== "staged") return;
    try {
      this.physical = this.options.install();
    } catch (error) {
      // A destroyed editor cannot host the hook. Report it, then let the platform
      // lifecycle handle the failed activation instead of degrading to a silent no-op.
      this.options.reportDiagnostic(
        createDiagnostic("unsupported-operation", DESTROYED_REGISTRATION_MESSAGE, {
          cause: error,
          owner: this.owner,
        }),
      );
      throw error;
    }
    this.currentState = "active";
  }

  quiesce(): void {
    if (this.currentState !== "staged" && this.currentState !== "active") return;
    this.currentState = "quiescing";
    this.options.forget(this);
    void this.releasePhysical().catch((error: unknown) => {
      this.options.reportDiagnostic(
        createDiagnostic("lifecycle-cleanup-failed", "Transaction hook cleanup failed", {
          cause: error,
          owner: this.owner,
        }),
      );
    });
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.quiesce();
    this.disposal = this.releasePhysical().then(
      () => {
        this.currentState = "disposed";
      },
      (error: unknown) => {
        // The hook still counts as released; the failure stays observable.
        this.currentState = "disposed";
        throw error;
      },
    );
    return this.disposal;
  }

  private releasePhysical(): Promise<void> {
    if (this.physicalDisposal) return this.physicalDisposal;
    const physical = this.physical;
    this.physical = null;
    this.physicalDisposal = physical ? Promise.resolve(physical.dispose()) : Promise.resolve();
    return this.physicalDisposal;
  }
}

/**
 * Owner-scoped factory for the nexus.editor-transactions capability of exactly one
 * attached editor. The host constructs one instance per attachEditor and disposes it
 * on detach, so registration and dispatch never have to resolve "the current editor".
 */
export class EditorTransactionPipeline implements ManagedResource {
  private readonly reportDiagnostic: (diagnostic: NexusDiagnostic) => void;
  private readonly resolveContext: () => EditorContext;
  private readonly editorId: EditorId;
  private readonly hooks = new Set<TransactionHookRegistration>();
  private sequence = 0;
  private operationSequence = 0;
  private frame: TransactionFrame | null = null;
  /**
   * Instance-level, deliberately not part of the frame: a commit the user typed has no
   * dispatch frame, yet its filters must not be able to re-enter the pipeline either.
   */
  private filterDepth = 0;
  private disposed = false;
  private disposal: Promise<void> | null = null;

  constructor(options: EditorTransactionPipelineOptions) {
    this.reportDiagnostic = options.reportDiagnostic ?? (() => undefined);
    this.resolveContext = options.context;
    this.editorId = options.context().editorId;
  }

  /**
   * A reporter supplied by the host is a consumer callback like any other: it can throw, and
   * its failure has nowhere left to go. Letting it escape would turn the reporting of one fault
   * into a second fault on the very path that was handling the first.
   */
  private reportSafely(diagnostic: NexusDiagnostic): void {
    try {
      this.reportDiagnostic(diagnostic);
    } catch {
      // Intentionally swallowed: the only channel able to report this is the one that failed.
    }
  }

  createService(
    owner: ResourceOwner,
    registerResource: (resource: ManagedResource) => void,
  ): EditorTransactionService {
    return {
      registerFilter: (filter, options) =>
        this.register(owner, registerResource, "filter", options, (priority) =>
          this.createFilterInstall(owner, filter, priority),
        ),
      registerUpdateListener: (listener, options) =>
        this.register(owner, registerResource, "listener", options, (priority) =>
          this.createListenerInstall(owner, listener, priority),
        ),
      dispatch: (editorId, transaction) => this.dispatch(owner, editorId, transaction),
    };
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    const registrations = [...this.hooks].reverse();
    this.hooks.clear();
    this.disposal = Promise.allSettled(
      registrations.map((registration) => registration.dispose()),
    ).then((results) => {
      const errors = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason);
      if (errors.length > 0) {
        throw new AggregateError(errors, "Editor transaction service cleanup failed");
      }
    });
    return this.disposal;
  }

  private register(
    owner: ResourceOwner,
    registerResource: (resource: ManagedResource) => void,
    kind: TransactionHookKind,
    options: { readonly priority?: number } | undefined,
    createInstall: (priority: number) => () => EditorContributionRegistration,
  ): RegistrationResult<ContributionRegistration> {
    if (this.disposed) {
      const diagnostic = createDiagnostic("unsupported-operation", DISPOSED_MESSAGE, { owner });
      this.reportSafely(diagnostic);
      return { ok: false, diagnostic };
    }

    let priority: number;
    try {
      priority = normalizeTransactionPriority(options?.priority);
    } catch (error) {
      const diagnostic = createDiagnostic(
        "registration-conflict",
        error instanceof Error ? error.message : String(error),
        { cause: error, owner },
      );
      this.reportSafely(diagnostic);
      return { ok: false, diagnostic };
    }

    const sequence = ++this.sequence;
    const localId = `${kind === "filter" ? "transaction-filter" : "update-listener"}-${sequence}`;
    const registration = new TransactionHookRegistration({
      key: `${kind}:${sequence}`,
      localId,
      globalId: `${owner.pluginId}:${localId}`,
      owner,
      kind,
      priority,
      install: createInstall(priority),
      forget: (item) => {
        this.hooks.delete(item);
      },
      reportDiagnostic: (diagnostic) => this.reportSafely(diagnostic),
    });

    this.hooks.add(registration);
    try {
      registerResource(registration);
    } catch (error) {
      // The registrar belongs to the host. If it refuses, the hook must not stay half-adopted:
      // drop it here and answer with a deterministic failure instead of a throw.
      this.hooks.delete(registration);
      const diagnostic = createDiagnostic("unsupported-operation", REGISTRATION_RESOURCE_FAILED_MESSAGE, {
        cause: error,
        owner,
      });
      this.reportSafely(diagnostic);
      return { ok: false, diagnostic };
    }
    return { ok: true, registration };
  }

  private createFilterInstall(
    owner: ResourceOwner,
    filter: EditorTransactionFilter,
    priority: number,
  ): () => EditorContributionRegistration {
    const adapter = this.createFilterAdapter(owner, filter);
    return () =>
      this.resolveContext().contributions.registerTransactionFilter(
        String(owner.pluginId),
        adapter,
        { priority },
      );
  }

  private createListenerInstall(
    owner: ResourceOwner,
    listener: (update: EditorUpdateContext) => void,
    priority: number,
  ): () => EditorContributionRegistration {
    const adapter = this.createListenerAdapter(owner, listener);
    return () =>
      this.resolveContext().contributions.registerUpdateListener(
        String(owner.pluginId),
        adapter,
        { priority },
      );
  }

  private createFilterAdapter(
    owner: ResourceOwner,
    filter: EditorTransactionFilter,
  ): CoreEditorTransactionFilter {
    return (coreContext): CoreEditorTransactionFilterResult => {
      const frame = this.frame;
      const transaction = toPluginTransaction(coreContext, frame);
      let value: unknown;
      this.filterDepth += 1;
      try {
        value = filter(toFilterContext(this.resolveContext(), transaction));
      } catch (error) {
        // A faulty filter is reported and skipped: the transaction the user (or another
        // plugin) asked for still commits, and the remaining hooks still run.
        this.reportSafely(
          createDiagnostic("callback-failed", FILTER_CALLBACK_FAILED_MESSAGE, {
            cause: error,
            owner,
          }),
        );
        return { action: "accept" };
      } finally {
        this.filterDepth -= 1;
      }
      const translation = toCoreFilterResult(value, {
        frame,
        getDocumentLength: () => this.resolveContext().editor.getDocument().length,
        onAbandoned: (reason) =>
          this.reportSafely(
            createDiagnostic("callback-failed", FILTER_CALLBACK_FAILED_MESSAGE, {
              cause: reason,
              owner,
            }),
          ),
      });
      if (translation.kind === "invalid") {
        this.reportSafely(
          createDiagnostic("callback-failed", translation.message, {
            cause: translation.cause,
            owner,
          }),
        );
        return { action: "accept" };
      }
      return translation.result;
    };
  }

  private createListenerAdapter(
    owner: ResourceOwner,
    listener: (update: EditorUpdateContext) => void,
  ): CoreEditorUpdateListener {
    return (coreUpdate) => {
      try {
        const transaction = toPluginTransaction(coreUpdate, this.frame);
        const update = toUpdateContext(
          this.resolveContext(),
          transaction,
          coreUpdate.documentBefore,
          coreUpdate.documentAfter,
        );
        const result: unknown = listener(update);
        // The listener is declared to return nothing; a promise returned anyway can never be
        // awaited by this synchronous path. It is adopted here so its rejection is reported
        // instead of surfacing later as a host-level unhandled rejection.
        if (isThenable(result)) {
          adoptAbandonedThenable(result, (reason) =>
            this.reportSafely(
              createDiagnostic("callback-failed", LISTENER_ASYNC_RESULT_MESSAGE, {
                cause: reason,
                owner,
              }),
            ),
          );
        }
      } catch (error) {
        // The commit already happened; a faulty observer is reported and skipped so the
        // remaining listeners still see the update.
        this.reportSafely(
          createDiagnostic("callback-failed", LISTENER_CALLBACK_FAILED_MESSAGE, {
            cause: error,
            owner,
          }),
        );
      }
    };
  }

  private dispatch(
    owner: ResourceOwner,
    editorId: EditorId,
    transaction: EditorTransaction,
  ): ServiceResult<{ readonly operationId: OperationId }> {
    if (this.disposed) {
      // A released service reports the rejection, like a late registration: the caller
      // still has to see that the instance it is holding no longer commits anything.
      const diagnostic = createDiagnostic("unsupported-operation", DISPOSED_MESSAGE, { owner });
      this.reportSafely(diagnostic);
      return { ok: false, diagnostic };
    }
    if (editorId !== this.editorId) {
      return {
        ok: false,
        diagnostic: createDiagnostic(
          "unsupported-operation",
          `Editor '${editorId}' is not served by this transaction service`,
          { owner },
        ),
      };
    }
    if (this.filterDepth > 0) {
      // Committing from inside a filter would land a nested state update before the
      // outer one, which discards the outer transaction in CodeMirror.
      return {
        ok: false,
        diagnostic: createDiagnostic("unsupported-operation", REENTRANT_DISPATCH_MESSAGE, {
          owner,
        }),
      };
    }

    if (!isObjectLike(transaction)) {
      // Rejecting a payload that is not even an object is a deterministic answer, not a crash:
      // the caller keeps a return value it can act on instead of an exception.
      const diagnostic = createDiagnostic("unsupported-operation", INVALID_DISPATCH_TRANSACTION_MESSAGE, {
        owner,
      });
      this.reportSafely(diagnostic);
      return { ok: false, diagnostic };
    }

    const operationId =
      transaction.operationId ?? toOperationId(`editor-operation:${++this.operationSequence}`);
    const frame = createTransactionFrame(operationId, transaction.annotations);
    const previous = this.frame;
    this.frame = frame;
    let result: CoreEditorTransactionDispatchResult;
    try {
      result = this.resolveContext().editor.dispatchTransaction(
        toCoreDispatchTransaction(transaction),
      );
    } catch (error) {
      // Reaching the editor can fail on its own (detached context, destroyed view). The caller
      // gets a deterministic failure instead of a throw on a path that also carries user edits.
      const diagnostic = createDiagnostic("unsupported-operation", DISPATCH_FAILED_MESSAGE, {
        cause: error,
        owner,
      });
      this.reportSafely(diagnostic);
      return { ok: false, diagnostic };
    } finally {
      this.frame = previous;
    }

    if (result.status === "success") {
      return { ok: true, value: { operationId } };
    }
    if (result.status === "recursion-limit") {
      return {
        ok: false,
        diagnostic: createDiagnostic(
          "unsupported-operation",
          `Transaction dispatch recursion limit (${result.limit}) reached`,
          { owner },
        ),
      };
    }
    if (frame.rejectionDiagnostic !== null) {
      return { ok: false, diagnostic: this.attachOwner(frame.rejectionDiagnostic, owner) };
    }
    return {
      ok: false,
      diagnostic: {
        ...createDiagnostic(
          "unsupported-operation",
          result.reason ?? DEFAULT_FILTER_REJECTION_REASON,
          { owner },
        ),
        resourceId: result.ownerId,
      },
    };
  }

  /**
   * A plugin-supplied diagnostic passes through untouched; the runtime only fills the
   * plugin attribution it is authoritative for, and never rewrites other keys.
   */
  private attachOwner(diagnostic: NexusDiagnostic, owner: ResourceOwner): NexusDiagnostic {
    if (diagnostic.plugin !== undefined) return diagnostic;
    const plugin = { id: owner.pluginId, version: "unknown" };
    if (Object.isExtensible(diagnostic)) {
      try {
        return Object.assign(diagnostic, { plugin });
      } catch (error) {
        // A host-frozen diagnostic still has to be reported, with its attribution and without
        // letting the failure escape as a throw on the caller's dispatch path.
        this.reportSafely(
          createDiagnostic("unsupported-operation", DIAGNOSTIC_ATTRIBUTION_FAILED_MESSAGE, {
            cause: error,
            owner,
          }),
        );
      }
    }
    return { ...diagnostic, plugin };
  }
}
