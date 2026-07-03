/**
 * Registry for plugin-declared keybindings (plugin `shortcuts[]` + command
 * `hotkey`). Consumed by `createEditor` to build a mutable, user-overridable
 * keymap layer without touching plugin source. Built-in editor keymaps
 * (markdown enter continuation, tab indent) are intentionally not routed
 * through this registry yet — see ROADMAP #14 open questions.
 */

import type {
  EditorAPI,
  EditorCommand,
  KeybindingEntry,
  KeybindingOverride,
  NexusPlugin,
} from "./types";

/**
 * Normalized declaration extracted from a `NexusPlugin`. Holds enough info
 * to build both the public `KeybindingEntry` view and the CM6 keymap items.
 */
export interface KeybindingRegistration {
  id: string;
  defaultKey: string;
  source: "plugin-shortcut" | "plugin-command";
  pluginName: string;
  label?: string;
  /**
   * Dispatch handler. Returns truthy when the binding consumes the key.
   * Wrapped uniformly so `CodeMirror.keymap.of` sees `() => boolean`.
   */
  run: () => boolean;
}

/**
 * Walk plugins and collect every declared shortcut / command hotkey as a
 * normalized `KeybindingRegistration`. Order preserved (plugin order → item
 * order) so the "last registered wins" tiebreak stays stable.
 */
export function collectRegistrations(
  plugins: NexusPlugin[],
  api: () => EditorAPI
): KeybindingRegistration[] {
  const out: KeybindingRegistration[] = [];
  for (const plugin of plugins) {
    const pluginName = plugin.name;

    // Anonymous plugin shortcuts — indexed positionally because the schema
    // doesn't require a stable id.
    const shortcuts = plugin.shortcuts ?? [];
    shortcuts.forEach((shortcut, index) => {
      out.push({
        id: `plugin:${pluginName}/shortcut:${index}`,
        defaultKey: shortcut.key,
        source: "plugin-shortcut",
        pluginName,
        run: () => shortcut.run(api()),
      });
    });

    // Plugin commands with hotkeys — command id is stable and human-readable.
    const commands = plugin.commands ?? [];
    for (const command of commands as EditorCommand[]) {
      if (typeof command.hotkey !== "string" || command.hotkey.length === 0) continue;
      out.push({
        id: `plugin:${pluginName}/command:${command.id}`,
        defaultKey: command.hotkey,
        source: "plugin-command",
        pluginName,
        label: command.label,
        // `EditorCommand.run` returns `boolean | void`; treat only `false` as
        // "not consumed" to match the existing dispatch semantics in editor.ts.
        run: () => command.run(api()) !== false,
      });
    }
  }
  return out;
}

/**
 * Merge default registrations with user overrides. Returns the public
 * `KeybindingEntry[]` view with conflicts already populated.
 *
 * `overrides` is a snapshot (not accumulative). Unknown ids are silently
 * dropped — see `Unknown override id is ignored` scenario in the spec.
 */
export function mergeOverrides(
  registrations: KeybindingRegistration[],
  overrides: KeybindingOverride[]
): KeybindingEntry[] {
  const overrideMap = new Map<string, string | null>();
  for (const o of overrides) {
    overrideMap.set(o.id, o.key);
  }

  const entries: KeybindingEntry[] = registrations.map((reg) => {
    const hasOverride = overrideMap.has(reg.id);
    const key = hasOverride ? overrideMap.get(reg.id)! : reg.defaultKey;
    return {
      id: reg.id,
      key,
      defaultKey: reg.defaultKey,
      source: reg.source,
      pluginName: reg.pluginName,
      label: reg.label,
      conflicts: [], // filled by populateConflicts below
    };
  });

  populateConflicts(entries);
  return entries;
}

/**
 * For every pair of entries that share the same non-null active `key`, add
 * the other's id to each entry's `conflicts` array. Runs in O(n) — n is
 * typically tens, so no need to be clever.
 */
function populateConflicts(entries: KeybindingEntry[]): void {
  const byKey = new Map<string, string[]>();
  for (const e of entries) {
    if (e.key === null) continue;
    const list = byKey.get(e.key);
    if (list) list.push(e.id);
    else byKey.set(e.key, [e.id]);
  }
  for (const [, ids] of byKey) {
    if (ids.length < 2) continue;
    const idSet = new Set(ids);
    for (const e of entries) {
      if (idSet.has(e.id)) {
        e.conflicts = ids.filter((other) => other !== e.id);
      }
    }
  }
}

/**
 * Turn merged entries into a CM6 keymap input. Registrations still provide
 * the `run` closures — entries only carry the (possibly overridden) key.
 * Same-key duplicates are all included; CM6 iterates in order and stops at
 * the first `run()` that returns truthy, preserving "last registered wins"
 * because we walk registrations in the same order they were collected.
 */
export function buildKeymapItems(
  entries: KeybindingEntry[],
  registrations: KeybindingRegistration[]
): Array<{ key: string; run: () => boolean }> {
  const runById = new Map(registrations.map((r) => [r.id, r.run] as const));
  const items: Array<{ key: string; run: () => boolean }> = [];
  for (const entry of entries) {
    if (entry.key === null) continue;
    const run = runById.get(entry.id);
    if (!run) continue;
    items.push({ key: entry.key, run });
  }
  return items;
}
