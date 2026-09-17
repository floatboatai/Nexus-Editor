import type {
  CommandContext,
  CommandExecutionResult,
  HotkeyBinding,
  HotkeyConflict,
  HotkeyPreference,
  HotkeyService,
  NexusDiagnostic,
} from "@floatboat/nexus-plugin-api";

import { CommandRegistry } from "./command-registry";
import {
  hotkeyToString,
  keyboardEventToHotkey,
  normalizeSemanticHotkeys,
  type HotkeyPlatform,
} from "./hotkey-normalization";

export interface HotkeyPreferenceStore {
  get(commandId: string): HotkeyPreference | undefined;
  set(commandId: string, preference: HotkeyPreference): void | Promise<void>;
}

export class MemoryHotkeyPreferenceStore implements HotkeyPreferenceStore {
  private readonly preferences = new Map<string, HotkeyPreference>();

  get(commandId: string): HotkeyPreference | undefined {
    return this.preferences.get(commandId);
  }

  set(commandId: string, preference: HotkeyPreference): void {
    this.preferences.set(commandId, preference);
  }
}

export interface HotkeyRegistryOptions {
  readonly platform: HotkeyPlatform;
  readonly preferences?: HotkeyPreferenceStore;
  readonly reportDiagnostic?: (diagnostic: NexusDiagnostic) => void;
}

export type HotkeyDispatchResult =
  | { readonly status: "pass" }
  | { readonly status: "conflict"; readonly conflict: HotkeyConflict }
  | {
      readonly status: "handled";
      readonly commandId: string;
      readonly completion: Promise<CommandExecutionResult>;
    };

interface ResolvedCandidate {
  readonly commandId: string;
  readonly normalizedHotkey: string;
  readonly priority: number;
  readonly sequence: number;
}

function clonePreference(preference: HotkeyPreference): HotkeyPreference {
  if (preference.mode === "default" || preference.mode === "cleared") {
    return Object.freeze({ mode: preference.mode });
  }
  return Object.freeze({
    mode: "custom",
    bindings: normalizeSemanticHotkeys(preference.bindings),
  });
}

/** Persistent user bindings layered over the CommandRegistry active snapshot. */
export class HotkeyRegistry implements HotkeyService {
  private readonly preferences: HotkeyPreferenceStore;
  private readonly reportDiagnostic: (diagnostic: NexusDiagnostic) => void;

  constructor(
    private readonly commands: CommandRegistry,
    private readonly options: HotkeyRegistryOptions,
  ) {
    this.preferences = options.preferences ?? new MemoryHotkeyPreferenceStore();
    this.reportDiagnostic = options.reportDiagnostic ?? (() => undefined);
  }

  createService(): HotkeyService {
    return {
      getBindings: (commandId) => this.getBindings(commandId),
      getPreference: (commandId) => this.getPreference(commandId),
      setPreference: (commandId, preference) =>
        this.setPreference(commandId, preference),
      findConflicts: () => this.findConflicts(),
    };
  }

  getBindings(commandId: string): readonly HotkeyBinding[] {
    const preference = this.getPreference(commandId);
    if (preference.mode === "cleared") return Object.freeze([]);
    if (preference.mode === "custom") return preference.bindings;
    return this.commands.getCommand(commandId)?.defaultHotkeys ?? Object.freeze([]);
  }

  getPreference(commandId: string): HotkeyPreference {
    return this.preferences.get(commandId) ?? Object.freeze({ mode: "default" });
  }

  async setPreference(
    commandId: string,
    preference: HotkeyPreference,
  ): Promise<void> {
    await this.preferences.set(commandId, clonePreference(preference));
  }

  findConflicts(): readonly HotkeyConflict[] {
    const groups = this.candidatesByHotkey();
    const conflicts: HotkeyConflict[] = [];
    for (const [normalizedHotkey, candidates] of groups) {
      const topPriority = Math.max(...candidates.map((item) => item.priority));
      const top = candidates.filter((item) => item.priority === topPriority);
      if (top.length < 2) continue;
      conflicts.push(
        this.createConflict(
          normalizedHotkey,
          top.map((item) => item.commandId),
        ),
      );
    }
    return Object.freeze(conflicts);
  }

  dispatchKeyboardEvent(
    event: KeyboardEvent,
    context: Partial<CommandContext> = {},
  ): HotkeyDispatchResult {
    const normalized = keyboardEventToHotkey(event, this.options.platform);
    const candidates = this.candidatesByHotkey().get(normalized) ?? [];
    if (candidates.length === 0) return { status: "pass" };

    const topPriority = Math.max(...candidates.map((item) => item.priority));
    const top = candidates.filter((item) => item.priority === topPriority);
    if (top.length !== 1) {
      const conflict = this.createConflict(
        normalized,
        top.map((item) => item.commandId),
      );
      this.reportDiagnostic(conflict.diagnostic);
      return { status: "conflict", conflict };
    }

    const commandId = top[0]!.commandId;
    event.preventDefault();
    const completion = this.commands.executeCommand(commandId, {
      ...context,
      trigger: "hotkey",
      sourceId: context.sourceId ?? normalized,
    });
    return { status: "handled", commandId, completion };
  }

  private candidatesByHotkey(): Map<string, ResolvedCandidate[]> {
    const groups = new Map<string, ResolvedCandidate[]>();
    for (const command of this.commands.listHotkeyCandidates()) {
      const seen = new Set<string>();
      for (const binding of this.getBindings(command.id)) {
        const normalizedHotkey = hotkeyToString(binding, this.options.platform);
        // Mod and a native modifier can resolve to the same key for this command.
        if (seen.has(normalizedHotkey)) continue;
        seen.add(normalizedHotkey);
        const candidate: ResolvedCandidate = {
          commandId: command.id,
          normalizedHotkey,
          priority: command.priority,
          sequence: command.sequence,
        };
        const values = groups.get(normalizedHotkey);
        if (values) values.push(candidate);
        else groups.set(normalizedHotkey, [candidate]);
      }
    }
    for (const values of groups.values()) {
      values.sort(
        (left, right) =>
          right.priority - left.priority || left.sequence - right.sequence,
      );
    }
    return groups;
  }

  private createConflict(
    normalizedHotkey: string,
    commandIds: readonly string[],
  ): HotkeyConflict {
    const ids = Object.freeze([...commandIds].sort());
    const diagnostic: NexusDiagnostic = {
      code: "command-conflict",
      severity: "error",
      phase: "runtime",
      message: `Hotkey '${normalizedHotkey}' has equally ranked command candidates`,
      resourceId: normalizedHotkey,
      details: { scopeId: "application", commandIds: [...ids] },
    };
    return Object.freeze({
      scopeId: "application",
      normalizedHotkey,
      commandIds: ids,
      diagnostic,
    });
  }
}
