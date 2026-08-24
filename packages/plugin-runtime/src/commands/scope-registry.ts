import type {
  CommandContext,
  CommandScope,
  ContributionRegistration,
  ManagedResource,
  NexusDiagnostic,
  RegistrationId,
  RegistrationResult,
  RegistrationState,
  ResourceOwner,
  ScopeHandlerContext,
  ScopeHandlerResult,
  ScopeService,
} from "@floatboat/nexus-plugin-api";
import {
  MAX_PLUGIN_PRIORITY,
  MIN_PLUGIN_PRIORITY,
} from "@floatboat/nexus-plugin-api";

import {
  hotkeyToString,
  keyboardEventToHotkey,
  type HotkeyPlatform,
} from "./hotkey-normalization";

export type ScopeResourceRegistrar = (resource: ManagedResource) => void;

export interface ScopeRegistryOptions {
  readonly platform: HotkeyPlatform;
  readonly reportDiagnostic?: (diagnostic: NexusDiagnostic) => void;
}

export type ScopeDispatchResult =
  | { readonly status: "pass" }
  | {
      readonly status: "handled";
      readonly scopeId: string;
      readonly handlerId: string;
    }
  | {
      readonly status: "conflict";
      readonly scopeId: string;
      readonly diagnostic: NexusDiagnostic;
    };

interface ScopeNode {
  readonly id: string;
  readonly parent: ScopeNode | null;
  readonly entries: Map<string, ScopeHandlerEntry>;
}

interface ScopeHandlerEntry {
  readonly key: string;
  readonly localId: string;
  readonly globalId: string;
  readonly scope: ScopeNode;
  readonly owner: ResourceOwner;
  readonly normalizedHotkey: string;
  readonly handler: (context: ScopeHandlerContext) => ScopeHandlerResult;
  readonly priority: number;
  readonly sequence: number;
  state: RegistrationState;
}

interface ScopeStackEntry {
  readonly key: string;
  readonly localId: string;
  readonly globalId: string;
  readonly scope: ScopeNode;
  readonly owner: ResourceOwner;
  readonly sequence: number;
  state: RegistrationState;
}

type ScopeEntry = ScopeHandlerEntry | ScopeStackEntry;

const facadeNodes = new WeakMap<CommandScope, ScopeNode>();

function registrationId(value: string): RegistrationId {
  return value as RegistrationId;
}

function normalizePriority(priority: number | undefined): number {
  const value = priority ?? 0;
  if (
    !Number.isInteger(value) ||
    value < MIN_PLUGIN_PRIORITY ||
    value > MAX_PLUGIN_PRIORITY
  ) {
    throw new RangeError(
      `Scope priority must be an integer between ${MIN_PLUGIN_PRIORITY} and ${MAX_PLUGIN_PRIORITY}`,
    );
  }
  return value;
}

function validateScopeId(id: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new TypeError(
      "Scope id must start with an alphanumeric character and contain only alphanumerics, '.', '_' or '-'",
    );
  }
}

class ManagedScopeRegistration
  implements ContributionRegistration, ManagedResource
{
  private disposePromise: Promise<void> | null = null;

  constructor(
    private readonly entry: ScopeEntry,
    private readonly activateEntry: (entry: ScopeEntry) => void,
    private readonly removeEntry: (entry: ScopeEntry) => void,
    readonly priority: number,
  ) {}

  get id(): RegistrationId {
    return registrationId(this.entry.key);
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

  get localId(): string {
    return this.entry.localId;
  }

  get globalId(): string {
    return this.entry.globalId;
  }

  activate(): void {
    if (this.entry.state !== "staged") return;
    this.activateEntry(this.entry);
    this.entry.state = "active";
  }

  quiesce(): void {
    if (this.entry.state === "staged" || this.entry.state === "active") {
      this.entry.state = "quiescing";
      this.removeEntry(this.entry);
    }
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.quiesce();
    this.entry.state = "disposed";
    this.removeEntry(this.entry);
    this.disposePromise = Promise.resolve();
    return this.disposePromise;
  }
}

export class ScopeRegistry {
  private readonly applicationNode: ScopeNode = {
    id: "application",
    parent: null,
    entries: new Map(),
  };
  private readonly nodes = new Map<string, ScopeNode>();
  private readonly stack: ScopeStackEntry[] = [];
  private readonly reportDiagnostic: (diagnostic: NexusDiagnostic) => void;
  private sequence = 0;

  constructor(private readonly options: ScopeRegistryOptions) {
    this.nodes.set(this.applicationNode.id, this.applicationNode);
    this.reportDiagnostic = options.reportDiagnostic ?? (() => undefined);
  }

  createService(
    owner: ResourceOwner,
    registerResource: ScopeResourceRegistrar,
  ): ScopeService {
    const registry = this;
    const facadeFor = (node: ScopeNode): CommandScope => {
      const facade: CommandScope = {
        id: node.id,
        parent: node.parent ? facadeFor(node.parent) : null,
        registerHotkey: (hotkey, handler, options) => {
          const result = this.registerHotkey(
            owner,
            node,
            hotkey,
            handler,
            options?.priority,
          );
          if (result.ok) registerResource(result.registration);
          return result;
        },
      };
      facadeNodes.set(facade, node);
      return Object.freeze(facade);
    };
    const applicationScope = facadeFor(this.applicationNode);
    return {
      applicationScope,
      createScope: (id, parent = applicationScope) => {
        validateScopeId(id);
        const globalId = `${owner.pluginId}:${id}`;
        if (this.nodes.has(globalId)) {
          throw new Error(`Scope '${globalId}' already exists`);
        }
        const parentNode = facadeNodes.get(parent);
        if (!parentNode) throw new TypeError("Scope parent belongs to another runtime");
        const node: ScopeNode = {
          id: globalId,
          parent: parentNode,
          entries: new Map(),
        };
        this.nodes.set(globalId, node);
        const releaseNode = (): void => {
          if (this.nodes.get(globalId) === node) this.nodes.delete(globalId);
        };
        try {
          registerResource({
            // Scope ids are reservations too: release them as soon as their
            // owner quiesces so a later plugin instance can reuse the id.
            quiesce: releaseNode,
            dispose: releaseNode,
          });
        } catch (error) {
          releaseNode();
          throw error;
        }
        return facadeFor(node);
      },
      pushScope: (scope) => {
        const node = facadeNodes.get(scope);
        if (!node || node === this.applicationNode) {
          throw new TypeError("Only a runtime-created non-application scope can be pushed");
        }
        const registration = this.pushScope(owner, node);
        registerResource(registration);
        return registration;
      },
      get activeScopes() {
        return Object.freeze(
          [
            ...registry.stack
              .filter((entry) => entry.state === "active")
              .map((entry) => facadeFor(entry.scope)),
            applicationScope,
          ],
        );
      },
    };
  }

  dispatchKeyboardEvent(
    event: KeyboardEvent,
    commandContext: CommandContext,
  ): ScopeDispatchResult {
    const normalized = keyboardEventToHotkey(event, this.options.platform);
    for (const scope of this.dispatchScopes()) {
      const candidates = Array.from(scope.entries.values())
        .filter(
          (entry) =>
            entry.state === "active" && entry.normalizedHotkey === normalized,
        )
        .sort(
          (left, right) =>
            right.priority - left.priority || left.sequence - right.sequence,
        );
      if (candidates.length === 0) continue;
      const topPriority = candidates[0]!.priority;
      const top = candidates.filter((item) => item.priority === topPriority);
      if (top.length !== 1) {
        const diagnostic = this.scopeConflict(scope, normalized, top);
        this.reportDiagnostic(diagnostic);
        return { status: "conflict", scopeId: scope.id, diagnostic };
      }

      const selected = top[0]!;
      try {
        const result = selected.handler({ event, commandContext });
        if (result === "pass") continue;
        event.preventDefault();
        return {
          status: "handled",
          scopeId: scope.id,
          handlerId: selected.globalId,
        };
      } catch (error) {
        event.preventDefault();
        const diagnostic = this.callbackFailure(selected, error);
        this.reportDiagnostic(diagnostic);
        return {
          status: "handled",
          scopeId: scope.id,
          handlerId: selected.globalId,
        };
      }
    }
    return { status: "pass" };
  }

  private registerHotkey(
    owner: ResourceOwner,
    scope: ScopeNode,
    hotkey: Parameters<CommandScope["registerHotkey"]>[0],
    handler: Parameters<CommandScope["registerHotkey"]>[1],
    priority: number | undefined,
  ): RegistrationResult<ContributionRegistration & ManagedResource> {
    try {
      const normalized = hotkeyToString(hotkey, this.options.platform);
      const sequence = ++this.sequence;
      const localId = `hotkey-${sequence}`;
      const entry: ScopeHandlerEntry = {
        key: `scope-handler:${sequence}`,
        localId,
        globalId: `${owner.pluginId}:${scope.id}:${localId}`,
        scope,
        owner,
        normalizedHotkey: normalized,
        handler,
        priority: normalizePriority(priority),
        sequence,
        state: "staged",
      };
      const registration = new ManagedScopeRegistration(
        entry,
        (item) => {
          const handlerEntry = item as ScopeHandlerEntry;
          handlerEntry.scope.entries.set(handlerEntry.key, handlerEntry);
        },
        (item) => {
          const handlerEntry = item as ScopeHandlerEntry;
          handlerEntry.scope.entries.delete(handlerEntry.key);
        },
        entry.priority,
      );
      return { ok: true, registration };
    } catch (error) {
      return {
        ok: false,
        diagnostic: {
          code: "command-invalid",
          severity: "error",
          phase: "runtime",
          message: error instanceof Error ? error.message : String(error),
          plugin: { id: owner.pluginId, version: "unknown" },
          cause:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { message: String(error) },
        },
      };
    }
  }

  private pushScope(
    owner: ResourceOwner,
    scope: ScopeNode,
  ): ContributionRegistration & ManagedResource {
    const sequence = ++this.sequence;
    const entry: ScopeStackEntry = {
      key: `scope-stack:${sequence}`,
      localId: scope.id,
      globalId: `${owner.pluginId}:scope-stack:${sequence}`,
      scope,
      owner,
      sequence,
      state: "staged",
    };
    return new ManagedScopeRegistration(
      entry,
      (item) => this.stack.push(item as ScopeStackEntry),
      (item) => {
        const index = this.stack.indexOf(item as ScopeStackEntry);
        if (index >= 0) this.stack.splice(index, 1);
      },
      0,
    );
  }

  private dispatchScopes(): readonly ScopeNode[] {
    const result: ScopeNode[] = [];
    const visited = new Set<ScopeNode>();
    const active = this.stack.filter((entry) => entry.state === "active");
    for (let index = active.length - 1; index >= 0; index -= 1) {
      let node: ScopeNode | null = active[index]!.scope;
      while (node) {
        if (!visited.has(node)) {
          visited.add(node);
          result.push(node);
        }
        node = node.parent;
      }
    }
    if (!visited.has(this.applicationNode)) result.push(this.applicationNode);
    return result;
  }

  private scopeConflict(
    scope: ScopeNode,
    normalizedHotkey: string,
    entries: readonly ScopeHandlerEntry[],
  ): NexusDiagnostic {
    return {
      code: "command-conflict",
      severity: "error",
      phase: "runtime",
      message: `Scope '${scope.id}' has equally ranked handlers for '${normalizedHotkey}'`,
      resourceId: scope.id,
      details: {
        scopeId: scope.id,
        normalizedHotkey,
        commandIds: entries.map((entry) => entry.globalId).sort(),
      },
    };
  }

  private callbackFailure(
    entry: ScopeHandlerEntry,
    error: unknown,
  ): NexusDiagnostic {
    return {
      code: "callback-failed",
      severity: "error",
      phase: "callback",
      message: `Scope handler '${entry.globalId}' failed`,
      plugin: { id: entry.owner.pluginId, version: "unknown" },
      resourceId: entry.globalId,
      cause:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { message: String(error) },
    };
  }
}
