import { Compartment, type Extension } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";

import type { EditorAPI, InstalledPluginInfo, NexusPlugin } from "./types";

/** Same shape as NexusPlugin.shortcuts entries. */
interface ShortcutEntry {
  key: string;
  run: (editor: EditorAPI) => boolean;
}

/**
 * Hook classification for runtime plugin management — see
 * `openspec/changes/add-runtime-plugin-management/design.md` (D2).
 *
 * Each hook on `NexusPlugin` declares whether it is hot-pluggable (can be
 * added/removed on a live editor) or construction-time (consumed once while
 * `createEditor` builds the editor). This single map is the source of truth;
 * to graduate a hook from construction-time to hot-pluggable, flip its
 * `runtime` boolean — the public API contract ("unsupported hooks throw with
 * a named reason") stays unchanged.
 */
const HOOK_META: Record<string, { runtime: boolean }> = {
  cmExtensions: { runtime: true },
  shortcuts: { runtime: true },
  widgets: { runtime: false },
  remarkPlugins: { runtime: false },
  slashCommands: { runtime: false },
  commands: { runtime: false },
  handlers: { runtime: false },
};

const CONSTRUCTION_TIME_HOOKS = (Object.entries(HOOK_META)
  .filter(([, meta]) => !meta.runtime)
  .map(([key]) => key)) as Exclude<keyof NexusPlugin, "name">[];

type ConstructionTimeHook = (typeof CONSTRUCTION_TIME_HOOKS)[number];

export interface RuntimePluginRegistry {
  /** Seed for `EditorState.create` — the compartment starts empty. */
  extensionSeed: Extension;
  /** Validate + hot-install. Throws on construction-time hooks / duplicates / dispatch failure (rolled back). */
  add(plugin: NexusPlugin): void;
  /** Hot-uninstall a runtime plugin. False for unknown names; throws for construction-time plugins. */
  remove(name: string): boolean;
  /** All installed plugins (static first, then runtime in insertion order). */
  list(): InstalledPluginInfo[];
  /** Unified shortcut lookup across static and runtime plugins. */
  findShortcut(key: string): ((editor: EditorAPI) => boolean) | null;
}

/**
 * Construction-time hooks the plugin actually declares. Empty arrays and
 * all-undefined `handlers` objects don't count as declared — only hooks that
 * would have real effect if the plugin were passed to `createEditor`.
 */
export function declaredConstructionTimeHooks(plugin: NexusPlugin): ConstructionTimeHook[] {
  return CONSTRUCTION_TIME_HOOKS.filter((hook) => {
    const value = plugin[hook];
    if (value === undefined || value === null) return false;
    if (Array.isArray(value)) return value.length > 0;
    // `handlers` is an object of optional callbacks.
    return Object.values(value).some((entry) => entry != null);
  });
}

export function createRuntimePluginRegistry(options: {
  staticPluginNames: readonly string[];
  /** Static shortcuts flattened at construction — searched before runtime ones. */
  staticShortcuts: readonly ShortcutEntry[];
  viewRef: { current: EditorView | null };
  /** Resolved lazily: the registry is created before the `api` object exists. */
  getApi: () => EditorAPI;
  onChange: (plugins: InstalledPluginInfo[]) => void;
}): RuntimePluginRegistry {
  const { staticPluginNames, staticShortcuts, viewRef, getApi, onChange } = options;
  const compartment = new Compartment();
  // Immutable snapshots: a failed reconfigure rolls back by restoring the
  // previous array reference, which also preserves insertion order exactly
  // (order fixes keymap/extension precedence deterministically).
  let entries: readonly NexusPlugin[] = [];

  const toExtensions = (plugin: NexusPlugin): Extension[] => {
    const extensions: Extension[] = [];
    const shortcuts = plugin.shortcuts ?? [];
    if (shortcuts.length > 0) {
      // Same shape as the static shortcut path in editor.ts: `api` is
      // resolved at keypress time, not at install time.
      extensions.push(
        keymap.of(
          shortcuts.map((shortcut) => ({
            key: shortcut.key,
            run: () => shortcut.run(getApi()),
          }))
        )
      );
    }
    extensions.push(...(plugin.cmExtensions ?? []));
    return extensions;
  };

  const reconfigure = (next: readonly NexusPlugin[]): void => {
    const view = viewRef.current;
    if (!view) {
      throw new Error("[NexusEditor] runtime plugins: editor view is not available yet");
    }
    view.dispatch({
      effects: compartment.reconfigure(next.flatMap((plugin) => toExtensions(plugin))),
    });
  };

  const list = (): InstalledPluginInfo[] => [
    ...staticPluginNames.map((name) => ({ name, runtime: false })),
    ...entries.map((entry) => ({ name: entry.name, runtime: true })),
  ];

  return {
    extensionSeed: compartment.of([]),

    add(plugin: NexusPlugin): void {
      const offending = declaredConstructionTimeHooks(plugin);
      if (offending.length > 0) {
        throw new Error(
          `[NexusEditor] addPlugin("${plugin.name}"): hook(s) ${offending.join(", ")} are consumed ` +
            `while the editor is constructed and cannot be hot-installed. ` +
            `Pass this plugin via createEditor({ plugins: [...] }) instead.`
        );
      }
      if (staticPluginNames.includes(plugin.name) || entries.some((entry) => entry.name === plugin.name)) {
        throw new Error(
          `[NexusEditor] addPlugin("${plugin.name}"): a plugin with this name is already installed.`
        );
      }

      const previous = entries;
      const next = [...entries, plugin];
      try {
        reconfigure(next);
      } catch (error) {
        // Leave registry consistent with the (unchanged) editor state.
        entries = previous;
        throw error;
      }
      entries = next;
      onChange(list());
    },

    findShortcut(key: string): ((editor: EditorAPI) => boolean) | null {
      // Static shortcuts take precedence (same order as the keymap).
      const staticMatch = staticShortcuts.find((s) => s.key === key);
      if (staticMatch) return staticMatch.run;
      for (const entry of entries) {
        const match = entry.shortcuts?.find((shortcut) => shortcut.key === key);
        if (match) return match.run;
      }
      return null;
    },

    remove(name: string): boolean {
      if (staticPluginNames.includes(name)) {
        throw new Error(
          `[NexusEditor] removePlugin("${name}"): construction-time plugins cannot be removed ` +
            `from a live editor — their hooks are not runtime-detachable. ` +
            `Recreate the editor without this plugin instead.`
        );
      }
      const previous = entries;
      const next = entries.filter((entry) => entry.name !== name);
      if (next.length === previous.length) return false;

      try {
        reconfigure(next);
      } catch (error) {
        entries = previous;
        throw error;
      }
      entries = next;
      onChange(list());
      return true;
    },

    list,
  };
}
