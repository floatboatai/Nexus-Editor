import type { SlashCommandDef } from "@floatboat/nexus-core";

import type { SlashCommandHistoryStorage } from "./command-history";

export interface SlashCommandOrderOptions {
  /**
   * Host-injected localStorage-like object. Without it the manual order is
   * session-only. `plugin-slash` never touches global `localStorage`.
   */
  storage?: SlashCommandHistoryStorage;
  storageKey?: string;
}

export type SlashCommandOrderConfig = boolean | SlashCommandOrderOptions;

export const DEFAULT_SLASH_COMMAND_ORDER_KEY = "nexus.slash.commandOrder";

export interface SlashCommandOrderController {
  /** Reorder `commands` to match the stored manual order. */
  apply(commands: SlashCommandDef[]): SlashCommandDef[];
  /**
   * Persist `visibleIds` as the new leading order. Ids already stored but
   * outside the visible window keep their previous relative order after it —
   * the editor caps slash results before the menu renders, so the menu can
   * only ever observe a prefix of the registered commands.
   */
  commit(visibleIds: readonly string[]): void;
}

/**
 * Deduplicates and drops non-string entries. Storage is untrusted input:
 * a hand-edited or partially written value must not be able to inject
 * phantom ids or duplicate entries into the menu.
 */
function normalizeOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    if (seen.has(item)) continue;
    seen.add(item);
    ids.push(item);
  }
  return ids;
}

export function createSlashCommandOrder(
  config: SlashCommandOrderConfig | undefined
): SlashCommandOrderController | null {
  if (!config) return null;

  const options = typeof config === "boolean" ? {} : config;
  const storage = options.storage;
  const storageKey = options.storageKey ?? DEFAULT_SLASH_COMMAND_ORDER_KEY;

  let loaded = false;
  let order: string[] = [];

  function load(): void {
    if (loaded) return;
    loaded = true;
    if (!storage) return;

    try {
      const value = storage.getItem(storageKey);
      if (value === null) return;
      order = normalizeOrder(JSON.parse(value));
    } catch {
      order = [];
    }
  }

  function save(): void {
    if (!storage) return;

    try {
      storage.setItem(storageKey, JSON.stringify(order));
    } catch {
      // Storage is best-effort; reordering must keep working for the session.
    }
  }

  return {
    apply(commands: SlashCommandDef[]): SlashCommandDef[] {
      load();
      if (order.length === 0) return commands;

      const byId = new Map<string, SlashCommandDef>();
      for (const command of commands) {
        if (!byId.has(command.id)) byId.set(command.id, command);
      }

      const used = new Set<string>();
      const placed: SlashCommandDef[] = [];
      for (const id of order) {
        const command = byId.get(id);
        if (!command || used.has(id)) continue;
        placed.push(command);
        used.add(id);
      }

      if (placed.length === 0) return commands;
      return placed.concat(commands.filter((command) => !used.has(command.id)));
    },

    commit(visibleIds: readonly string[]): void {
      load();

      const seen = new Set<string>();
      const next: string[] = [];
      for (const id of visibleIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        next.push(id);
      }
      // Ids the menu cannot see must survive the drop in their previous
      // relative order, otherwise reordering above the slice size would
      // silently discard the user's arrangement for capped-out commands.
      for (const id of order) {
        if (seen.has(id)) continue;
        seen.add(id);
        next.push(id);
      }

      order = next;
      save();
    },
  };
}
