import type {
  CommandAvailability,
  CommandContext,
  CommandDefinition,
  CommandExecutionResult,
  CommandService,
  ContributionRegistration,
  ManagedResource,
  NexusDiagnostic,
  RegisteredCommand,
  RegistrationId,
  RegistrationResult,
  RegistrationState,
  ResourceOwner,
} from "@floatboat/nexus-plugin-api";
import {
  MAX_PLUGIN_PRIORITY,
  MIN_PLUGIN_PRIORITY,
} from "@floatboat/nexus-plugin-api";

import { normalizeSemanticHotkeys } from "./hotkey-normalization";

export type CommandResourceRegistrar = (resource: ManagedResource) => void;

export interface CommandContextResolutionOptions {
  readonly allowEditorFallback: boolean;
}

export type CommandContextResolver = (
  context: Partial<CommandContext>,
  options: CommandContextResolutionOptions,
) => CommandContext | Promise<CommandContext>;

export interface CommandRegistryOptions {
  readonly resolveContext?: CommandContextResolver;
  readonly reportDiagnostic?: (diagnostic: NexusDiagnostic) => void;
}

export interface CommandHotkeyCandidate {
  readonly id: string;
  readonly priority: number;
  readonly sequence: number;
  readonly defaultHotkeys: RegisteredCommand["defaultHotkeys"];
}

interface CommandEntry {
  readonly key: string;
  readonly localId: string;
  readonly globalId: string;
  readonly owner: ResourceOwner;
  readonly priority: number;
  readonly sequence: number;
  readonly definition: CommandDefinition;
  readonly registered: RegisteredCommand;
  state: RegistrationState;
}

type CommandMode =
  | "callback"
  | "checkCallback"
  | "editorCallback"
  | "editorCheckCallback";

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
      `Command priority must be an integer between ${MIN_PLUGIN_PRIORITY} and ${MAX_PLUGIN_PRIORITY}`,
    );
  }
  return value;
}

function validateLocalId(localId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(localId)) {
    throw new TypeError(
      "Command id must start with an alphanumeric character and contain only alphanumerics, '.', '_' or '-'",
    );
  }
}

function commandMode(definition: CommandDefinition): CommandMode {
  const value = definition as unknown as Record<string, unknown>;
  const modes = (
    [
      "callback",
      "checkCallback",
      "editorCallback",
      "editorCheckCallback",
    ] as const
  ).filter((key) => typeof value[key] === "function");
  if (modes.length !== 1) {
    throw new TypeError(
      "A command must define exactly one of callback, checkCallback, editorCallback or editorCheckCallback",
    );
  }
  return modes[0];
}

function cloneDefinition(definition: CommandDefinition): CommandDefinition {
  if (typeof definition.name !== "string" || definition.name.trim().length === 0) {
    throw new TypeError("Command name must not be empty");
  }
  commandMode(definition);
  return Object.freeze({
    ...definition,
    name: definition.name.trim(),
    defaultHotkeys: normalizeSemanticHotkeys(definition.defaultHotkeys),
  });
}

function defaultContext(context: Partial<CommandContext>): CommandContext {
  return Object.freeze({
    trigger: context.trigger ?? "api",
    editor: context.editor ?? null,
    ...(context.sourceId === undefined ? {} : { sourceId: context.sourceId }),
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  });
}

function cause(error: unknown): NexusDiagnostic["cause"] {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { message: String(error) };
}

class ManagedCommandRegistration
  implements ContributionRegistration, ManagedResource
{
  private disposePromise: Promise<void> | null = null;

  constructor(
    private readonly entry: CommandEntry,
    private readonly activateEntry: (entry: CommandEntry) => void,
    private readonly removeEntry: (entry: CommandEntry) => void,
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

  get priority(): number {
    return this.entry.priority;
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

/** Host-owned source of truth for command palette, hotkeys and API execution. */
export class CommandRegistry {
  private readonly entries = new Map<string, CommandEntry>();
  private readonly activeEntries = new Map<string, CommandEntry>();
  private readonly resolveContext: CommandContextResolver;
  private readonly reportDiagnostic: (diagnostic: NexusDiagnostic) => void;
  private sequence = 0;

  constructor(options: CommandRegistryOptions = {}) {
    this.resolveContext =
      options.resolveContext ?? ((context) => defaultContext(context));
    this.reportDiagnostic = options.reportDiagnostic ?? (() => undefined);
  }

  createService(
    owner: ResourceOwner,
    registerResource: CommandResourceRegistrar,
  ): CommandService {
    return {
      registerCommand: (definition, options) => {
        const result = this.registerCommand(owner, definition, options);
        if (result.ok) {
          try {
            registerResource(result.registration);
          } catch (error) {
            void result.registration.dispose();
            throw error;
          }
        }
        return result;
      },
      getCommand: (id) => this.getCommand(id),
      listCommands: () => this.listCommands(),
      checkCommand: (id, context) => this.checkCommand(id, context),
      executeCommand: (id, context) => this.executeCommand(id, context),
    };
  }

  registerCommand(
    owner: ResourceOwner,
    definition: CommandDefinition,
    options: { readonly priority?: number } = {},
  ): RegistrationResult<ContributionRegistration & ManagedResource> {
    let localId: string;
    let globalId: string;
    let cloned: CommandDefinition;
    let priority: number;
    try {
      localId = definition.id;
      validateLocalId(localId);
      globalId = `${owner.pluginId}:${localId}`;
      cloned = cloneDefinition(definition);
      priority = normalizePriority(options.priority);
    } catch (error) {
      return {
        ok: false,
        diagnostic: this.emitDiagnostic({
          code: "command-invalid",
          message: error instanceof Error ? error.message : String(error),
          owner,
          resourceId: `${owner.pluginId}:${String(definition?.id ?? "unknown")}`,
          error,
        }),
      };
    }

    if (this.entries.has(globalId)) {
      return {
        ok: false,
        diagnostic: this.emitDiagnostic({
          code: "command-conflict",
          message: `Command '${globalId}' is already registered`,
          owner,
          resourceId: globalId,
          details: { commandIds: [globalId] },
        }),
      };
    }

    const sequence = ++this.sequence;
    const entry: CommandEntry = {
      key: `command-registration:${sequence}`,
      localId,
      globalId,
      owner,
      priority,
      sequence,
      definition: cloned,
      registered: Object.freeze({
        id: globalId,
        localId,
        pluginId: String(owner.pluginId),
        name: cloned.name,
        ...(cloned.description === undefined
          ? {}
          : { description: cloned.description }),
        ...(cloned.icon === undefined ? {} : { icon: cloned.icon }),
        defaultHotkeys: cloned.defaultHotkeys ?? Object.freeze([]),
        ...(cloned.showInCommandPalette === undefined ? {} : { showInCommandPalette: cloned.showInCommandPalette }),
      }),
      state: "staged",
    };
    this.entries.set(globalId, entry);
    const registration = new ManagedCommandRegistration(
      entry,
      (item) => {
        if (this.entries.get(item.globalId) !== item) {
          throw new Error(`Command '${item.globalId}' lost its reservation`);
        }
        this.activeEntries.set(item.globalId, item);
      },
      (item) => {
        if (this.activeEntries.get(item.globalId) === item) {
          this.activeEntries.delete(item.globalId);
        }
        if (item.state === "disposed" && this.entries.get(item.globalId) === item) {
          this.entries.delete(item.globalId);
        }
      },
    );
    return { ok: true, registration };
  }

  getCommand(id: string): RegisteredCommand | undefined {
    return this.activeEntries.get(id)?.registered;
  }

  listCommands(): readonly RegisteredCommand[] {
    return this.sortedActiveEntries().map((entry) => entry.registered);
  }

  listHotkeyCandidates(): readonly CommandHotkeyCandidate[] {
    return this.sortedActiveEntries().map((entry) => ({
      id: entry.globalId,
      priority: entry.priority,
      sequence: entry.sequence,
      defaultHotkeys: entry.registered.defaultHotkeys,
    }));
  }

  async checkCommand(
    id: string,
    context: Partial<CommandContext> = {},
  ): Promise<CommandAvailability> {
    const entry = this.activeEntries.get(id);
    if (!entry || entry.state !== "active") return { status: "not-found" };
    const resolved = await this.resolveCommandContext(entry, context);
    if (!resolved.ok) {
      return { status: "unavailable", diagnostic: resolved.diagnostic };
    }

    const mode = commandMode(entry.definition);
    if (
      (mode === "editorCallback" || mode === "editorCheckCallback") &&
      !resolved.value.editor
    ) {
      return { status: "no-editor" };
    }
    if (mode === "callback" || mode === "editorCallback") {
      return { status: "available" };
    }

    const checked = await this.invokeCheck(entry, mode, true, resolved.value);
    if (!checked.ok) {
      return { status: "unavailable", diagnostic: checked.diagnostic };
    }
    return checked.value ? { status: "available" } : { status: "unavailable" };
  }

  async executeCommand(
    id: string,
    context: Partial<CommandContext> = {},
  ): Promise<CommandExecutionResult> {
    const entry = this.activeEntries.get(id);
    if (!entry || entry.state !== "active") {
      return {
        ok: false,
        diagnostic: this.emitDiagnostic({
          code: "command-unavailable",
          message: `Command '${id}' is not registered or is quiescing`,
          resourceId: id,
        }),
      };
    }

    const resolved = await this.resolveCommandContext(entry, context);
    if (!resolved.ok) return resolved;
    if (resolved.value.signal?.aborted || entry.state !== "active" || this.activeEntries.get(id) !== entry) {
      return {
        ok: false,
        diagnostic: this.unavailable(entry, "The command was cancelled or unregistered before execution"),
      };
    }
    const mode = commandMode(entry.definition);
    if (
      (mode === "editorCallback" || mode === "editorCheckCallback") &&
      !resolved.value.editor
    ) {
      return {
        ok: false,
        diagnostic: this.unavailable(entry, "No active editor is available"),
      };
    }

    try {
      if (mode === "callback") {
        const callback = entry.definition.callback;
        if (!callback) throw new Error("The registered callback is unavailable");
        await callback(resolved.value);
      } else if (mode === "editorCallback") {
        const callback = entry.definition.editorCallback;
        if (!callback) throw new Error("The registered editor callback is unavailable");
        await callback(
          resolved.value.editor!,
          resolved.value,
        );
      } else {
        const checked = await this.invokeCheck(entry, mode, false, resolved.value);
        if (!checked.ok) return checked;
        if (!checked.value) {
          return {
            ok: false,
            diagnostic: this.unavailable(
              entry,
              "The command became unavailable before execution",
            ),
          };
        }
      }
      return { ok: true, value: { commandId: entry.globalId } };
    } catch (error) {
      return {
        ok: false,
        diagnostic: this.callbackFailure(entry, "Command callback failed", error),
      };
    }
  }

  private async resolveCommandContext(
    entry: CommandEntry,
    context: Partial<CommandContext>,
  ): Promise<
    | { readonly ok: true; readonly value: CommandContext }
    | { readonly ok: false; readonly diagnostic: NexusDiagnostic }
  > {
    try {
      const resolved = await this.resolveContext(context, {
        allowEditorFallback: entry.definition.allowEditorFallback ?? false,
      });
      return {
        ok: true,
        value: defaultContext({
          ...resolved,
          ...(context.signal === undefined ? {} : { signal: context.signal }),
        }),
      };
    } catch (error) {
      return {
        ok: false,
        diagnostic: this.callbackFailure(
          entry,
          "Command context resolution failed",
          error,
        ),
      };
    }
  }

  private async invokeCheck(
    entry: CommandEntry,
    mode: "checkCallback" | "editorCheckCallback",
    checking: boolean,
    context: CommandContext,
  ): Promise<
    | { readonly ok: true; readonly value: boolean }
    | { readonly ok: false; readonly diagnostic: NexusDiagnostic }
  > {
    try {
      let value: boolean;
      if (mode === "checkCallback") {
        const callback = entry.definition.checkCallback;
        if (!callback) throw new Error("The registered check callback is unavailable");
        value = await callback(checking, context);
      } else {
        const callback = entry.definition.editorCheckCallback;
        if (!callback) {
          throw new Error("The registered editor check callback is unavailable");
        }
        value = await callback(checking, context.editor!, context);
      }
      return { ok: true, value: value === true };
    } catch (error) {
      return {
        ok: false,
        diagnostic: this.callbackFailure(
          entry,
          checking
            ? "Command availability probe failed"
            : "Command callback failed",
          error,
        ),
      };
    }
  }

  private unavailable(entry: CommandEntry, message: string): NexusDiagnostic {
    return this.emitDiagnostic({
      code: "command-unavailable",
      message,
      owner: entry.owner,
      resourceId: entry.globalId,
    });
  }

  private callbackFailure(
    entry: CommandEntry,
    message: string,
    error: unknown,
  ): NexusDiagnostic {
    return this.emitDiagnostic({
      code: "callback-failed",
      message,
      owner: entry.owner,
      resourceId: entry.globalId,
      error,
    });
  }

  private emitDiagnostic(input: {
    readonly code: NexusDiagnostic["code"];
    readonly message: string;
    readonly owner?: ResourceOwner;
    readonly resourceId?: string;
    readonly error?: unknown;
    readonly details?: NexusDiagnostic["details"];
  }): NexusDiagnostic {
    const diagnostic: NexusDiagnostic = {
      code: input.code,
      severity: "error",
      phase: input.code === "callback-failed" ? "callback" : "runtime",
      message: input.message,
      ...(input.owner
        ? { plugin: { id: input.owner.pluginId, version: "unknown" } }
        : {}),
      ...(input.resourceId ? { resourceId: input.resourceId } : {}),
      ...(input.error === undefined ? {} : { cause: cause(input.error) }),
      ...(input.details === undefined ? {} : { details: input.details }),
    };
    this.reportDiagnostic(diagnostic);
    return diagnostic;
  }

  private sortedActiveEntries(): readonly CommandEntry[] {
    return Array.from(this.activeEntries.values())
      .filter((entry) => entry.state === "active")
      .sort(
        (left, right) =>
          right.priority - left.priority || left.sequence - right.sequence,
      );
  }
}
