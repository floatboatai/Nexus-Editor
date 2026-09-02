import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import { createMathPlugin } from "@floatboat/nexus-plugin-math";
import { createSearchPlugin } from "@floatboat/nexus-plugin-search";
import { createVimPlugin } from "@floatboat/nexus-plugin-vim";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createWikilinksPlugin, type NexusPlugin } from "@floatboat/nexus-core";

export type LegacyReferencePluginId =
  | "history"
  | "search"
  | "vim"
  | "gfm"
  | "math"
  | "wikilinks";

export interface LegacyReferenceFixture {
  readonly id: LegacyReferencePluginId;
  readonly pluginId: string;
  readonly create: () => NexusPlugin;
  readonly expected: Readonly<{
    commands: number;
    shortcuts: number;
    handlers: number;
    cmExtensions: number;
    remarkPlugins: number;
    widgets: number;
  }>;
}

/** Compile-time and runtime fixtures for each supported legacy contribution family. */
export const legacyReferenceFixtures: readonly LegacyReferenceFixture[] = Object.freeze([
  {
    id: "history",
    pluginId: "legacy-history",
    create: createHistoryPlugin,
    expected: { commands: 2, shortcuts: 0, handlers: 0, cmExtensions: 4, remarkPlugins: 0, widgets: 0 },
  },
  {
    id: "search",
    pluginId: "legacy-search",
    create: () => createSearchPlugin({ history: false }),
    expected: { commands: 0, shortcuts: 0, handlers: 0, cmExtensions: 4, remarkPlugins: 0, widgets: 0 },
  },
  {
    id: "vim",
    pluginId: "legacy-vim",
    create: createVimPlugin,
    expected: { commands: 0, shortcuts: 0, handlers: 0, cmExtensions: 1, remarkPlugins: 0, widgets: 0 },
  },
  {
    id: "gfm",
    pluginId: "legacy-gfm",
    create: createGfmPreset,
    expected: { commands: 0, shortcuts: 0, handlers: 0, cmExtensions: 0, remarkPlugins: 1, widgets: 0 },
  },
  {
    id: "math",
    pluginId: "legacy-math",
    create: createMathPlugin,
    expected: { commands: 0, shortcuts: 0, handlers: 0, cmExtensions: 0, remarkPlugins: 1, widgets: 2 },
  },
  {
    id: "wikilinks",
    pluginId: "legacy-wikilinks",
    create: createWikilinksPlugin,
    expected: { commands: 0, shortcuts: 0, handlers: 0, cmExtensions: 3, remarkPlugins: 0, widgets: 0 },
  },
]);

export function countLegacyContributions(plugin: NexusPlugin): LegacyReferenceFixture["expected"] {
  return Object.freeze({
    commands: plugin.commands?.length ?? 0,
    shortcuts: plugin.shortcuts?.length ?? 0,
    handlers: Object.values(plugin.handlers ?? {}).filter(Boolean).length,
    cmExtensions: plugin.cmExtensions?.length ?? 0,
    remarkPlugins: plugin.remarkPlugins?.length ?? 0,
    widgets: plugin.widgets?.length ?? 0,
  });
}
