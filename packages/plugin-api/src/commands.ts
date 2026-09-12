import type { EditorContext } from "./editor";
import type { NexusDiagnostic } from "./diagnostics";
import type { ContributionRegistration, RegistrationResult, ServiceResult } from "./ownership";

export interface CommandContext {
  readonly trigger: "api" | "command-palette" | "hotkey" | "menu" | "ui";
  readonly editor: EditorContext | null;
  readonly sourceId?: string;
  /** Cancels pending invocation; callbacks that await work may also observe this signal. */
  readonly signal?: AbortSignal;
}

export type CommandCallback = (context: CommandContext) => void | Promise<void>;
export type CommandCheckCallback = (
  checking: boolean,
  context: CommandContext,
) => boolean | Promise<boolean>;
export type EditorCommandCallback = (
  editor: EditorContext,
  context: CommandContext,
) => void | Promise<void>;
export type EditorCommandCheckCallback = (
  checking: boolean,
  editor: EditorContext,
  context: CommandContext,
) => boolean | Promise<boolean>;

export interface CommandDefinitionBase {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly icon?: string;
  readonly defaultHotkeys?: readonly HotkeyBinding[];
  /** Defaults to true. Compatibility entrypoints may remain callable without duplicate palette entries. */
  readonly showInCommandPalette?: boolean;
  readonly allowEditorFallback?: boolean;
}

export interface CallbackCommandDefinition extends CommandDefinitionBase {
  readonly callback: CommandCallback;
  readonly checkCallback?: never;
  readonly editorCallback?: never;
  readonly editorCheckCallback?: never;
}

export interface CheckCallbackCommandDefinition extends CommandDefinitionBase {
  readonly callback?: never;
  readonly checkCallback: CommandCheckCallback;
  readonly editorCallback?: never;
  readonly editorCheckCallback?: never;
}

export interface EditorCallbackCommandDefinition extends CommandDefinitionBase {
  readonly callback?: never;
  readonly checkCallback?: never;
  readonly editorCallback: EditorCommandCallback;
  readonly editorCheckCallback?: never;
}

export interface EditorCheckCallbackCommandDefinition extends CommandDefinitionBase {
  readonly callback?: never;
  readonly checkCallback?: never;
  readonly editorCallback?: never;
  readonly editorCheckCallback: EditorCommandCheckCallback;
}

export type CommandDefinition =
  | CallbackCommandDefinition
  | CheckCallbackCommandDefinition
  | EditorCallbackCommandDefinition
  | EditorCheckCallbackCommandDefinition;

export interface RegisteredCommand {
  readonly id: string;
  readonly localId: string;
  readonly pluginId: string;
  readonly name: string;
  readonly description?: string;
  readonly icon?: string;
  readonly defaultHotkeys: readonly HotkeyBinding[];
  readonly showInCommandPalette?: boolean;
}

export type CommandAvailability =
  | { readonly status: "available" }
  | { readonly status: "unavailable"; readonly diagnostic?: NexusDiagnostic }
  | { readonly status: "no-editor" }
  | { readonly status: "not-found" };

export type CommandExecutionResult = ServiceResult<
  { readonly commandId: string },
  NexusDiagnostic
>;

export interface CommandService {
  registerCommand(
    definition: CommandDefinition,
    options?: { readonly priority?: number },
  ): RegistrationResult<ContributionRegistration>;
  getCommand(id: string): RegisteredCommand | undefined;
  listCommands(): readonly RegisteredCommand[];
  checkCommand(id: string, context?: Partial<CommandContext>): Promise<CommandAvailability>;
  executeCommand(id: string, context?: Partial<CommandContext>): Promise<CommandExecutionResult>;
}

export type HotkeyModifier = "Mod" | "Ctrl" | "Meta" | "Alt" | "Shift";

export interface HotkeyBinding {
  readonly key: string;
  readonly modifiers?: readonly HotkeyModifier[];
}

export type HotkeyPreference =
  | { readonly mode: "default" }
  | { readonly mode: "custom"; readonly bindings: readonly HotkeyBinding[] }
  | { readonly mode: "cleared" };

export interface HotkeyConflict {
  readonly scopeId: string;
  readonly normalizedHotkey: string;
  readonly commandIds: readonly string[];
  readonly diagnostic: NexusDiagnostic;
}

export interface HotkeyService {
  getBindings(commandId: string): readonly HotkeyBinding[];
  getPreference(commandId: string): HotkeyPreference;
  setPreference(commandId: string, preference: HotkeyPreference): Promise<void>;
  findConflicts(): readonly HotkeyConflict[];
}

export type ScopeHandlerResult = "handled" | "pass";

export interface ScopeHandlerContext {
  readonly event: KeyboardEvent;
  readonly commandContext: CommandContext;
}

export interface CommandScope {
  readonly id: string;
  readonly parent: CommandScope | null;
  registerHotkey(
    hotkey: HotkeyBinding,
    handler: (context: ScopeHandlerContext) => ScopeHandlerResult,
    options?: { readonly priority?: number },
  ): RegistrationResult<ContributionRegistration>;
}

export interface ScopeService {
  readonly applicationScope: CommandScope;
  createScope(id: string, parent?: CommandScope): CommandScope;
  pushScope(scope: CommandScope): ContributionRegistration;
  readonly activeScopes: readonly CommandScope[];
}
