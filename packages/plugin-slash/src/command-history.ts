import type { SlashCommandDef } from "@floatboat/nexus-core";

export interface SlashCommandHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface SlashCommandHistoryOptions {
  storage?: SlashCommandHistoryStorage;
  storageKey?: string;
  maxEntries?: number;
}

export type SlashCommandHistoryConfig = boolean | SlashCommandHistoryOptions;

export const DEFAULT_SLASH_COMMAND_HISTORY_KEY = "nexus.slash.commandHistory";
const DEFAULT_MAX_ENTRIES = 20;

export interface SlashCommandHistoryController {
  reorder(commands: SlashCommandDef[], query: string): SlashCommandDef[];
  record(commandId: string): void;
}

function normalizeMaxEntries(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_ENTRIES;
  if (!Number.isFinite(value)) return DEFAULT_MAX_ENTRIES;
  return Math.max(0, Math.floor(value));
}

function normalizeHistory(raw: unknown, maxEntries: number): string[] {
  if (!Array.isArray(raw) || maxEntries <= 0) return [];

  const seen = new Set<string>();
  const entries: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    if (seen.has(item)) continue;
    seen.add(item);
    entries.push(item);
    if (entries.length >= maxEntries) break;
  }
  return entries;
}

export function createSlashCommandHistory(
  config: SlashCommandHistoryConfig | undefined
): SlashCommandHistoryController | null {
  if (!config) return null;

  const options = typeof config === "boolean" ? {} : config;
  const storage = options.storage;
  const storageKey = options.storageKey ?? DEFAULT_SLASH_COMMAND_HISTORY_KEY;
  const maxEntries = normalizeMaxEntries(options.maxEntries);

  let loaded = false;
  let history: string[] = [];

  function load(): void {
    if (loaded) return;
    loaded = true;
    if (!storage) return;

    try {
      const value = storage.getItem(storageKey);
      if (value === null) return;
      history = normalizeHistory(JSON.parse(value), maxEntries);
    } catch {
      history = [];
    }
  }

  function save(): void {
    if (!storage) return;

    try {
      storage.setItem(storageKey, JSON.stringify(history));
    } catch {
      // Storage is best-effort; command execution must continue.
    }
  }

  return {
    reorder(commands: SlashCommandDef[], query: string): SlashCommandDef[] {
      if (query !== "") return commands;

      load();
      if (history.length === 0) return commands;

      const byId = new Map<string, SlashCommandDef>();
      for (const command of commands) {
        if (!byId.has(command.id)) byId.set(command.id, command);
      }

      const used = new Set<string>();
      const recent: SlashCommandDef[] = [];
      for (const id of history) {
        const command = byId.get(id);
        if (!command || used.has(id)) continue;
        recent.push(command);
        used.add(id);
      }

      if (recent.length === 0) return commands;
      return recent.concat(commands.filter((command) => !used.has(command.id)));
    },

    record(commandId: string): void {
      if (maxEntries <= 0) return;

      load();
      history = [commandId, ...history.filter((id) => id !== commandId)].slice(
        0,
        maxEntries
      );
      save();
    },
  };
}
