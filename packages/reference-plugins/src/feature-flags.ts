import type { NexusPlugin } from "@floatboat/nexus-core";
import type { NexusPluginConstructor } from "@floatboat/nexus-plugin-api";
import { SlashLifecyclePlugin } from "@floatboat/nexus-plugin-slash";
import { BlockDragLifecyclePlugin, createBlockDragPlugin } from "@floatboat/nexus-plugin-block-drag";
import {
  createToolbarPlugin,
  createToolbarRuntimeSlashContribution,
  ToolbarLifecyclePlugin,
} from "@floatboat/nexus-plugin-toolbar";
import {
  createWordCountPlugin,
  WordCountLifecyclePlugin,
  type WordCountPlugin,
} from "@floatboat/nexus-plugin-wordcount";

export interface ReferencePluginFeatureFlags {
  readonly pluginPlatform: boolean;
  readonly toolbar: boolean;
  readonly slashMenu: boolean;
  readonly wordCount: boolean;
  /** Opt in per host; the Electron app enables this by default. */
  readonly blockDrag?: boolean;
}

export interface ReferencePluginBootPlan {
  readonly mode: "legacy" | "runtime";
  readonly editorContributions: readonly NexusPlugin[];
  readonly runtimePlugins: readonly NexusPluginConstructor[];
  readonly legacyWordCount: WordCountPlugin | null;
  readonly legacyUi: Readonly<{
    toolbar: boolean;
    slashMenu: boolean;
    wordCount: boolean;
    blockDrag: boolean;
  }>;
}

/**
 * Selects exactly one owner for migrated behavior. Hosts apply this plan before
 * editor construction and must not independently mount the old UI factories.
 */
export function createReferencePluginBootPlan(
  flags: ReferencePluginFeatureFlags,
): ReferencePluginBootPlan {
  if (!flags.pluginPlatform) {
    const legacyWordCount = flags.wordCount ? createWordCountPlugin() : null;
    return Object.freeze({
      mode: "legacy" as const,
      editorContributions: Object.freeze([
        ...(flags.toolbar ? [createToolbarPlugin()] : []),
        ...(legacyWordCount ? [legacyWordCount] : []),
        ...(flags.blockDrag ? [createBlockDragPlugin()] : []),
      ]),
      runtimePlugins: Object.freeze([]),
      legacyWordCount,
      legacyUi: Object.freeze({
        toolbar: flags.toolbar,
        slashMenu: flags.slashMenu,
        wordCount: Boolean(legacyWordCount),
        blockDrag: Boolean(flags.blockDrag),
      }),
    });
  }

  return Object.freeze({
    mode: "runtime" as const,
    editorContributions: Object.freeze([
      ...(flags.toolbar && flags.slashMenu ? [createToolbarRuntimeSlashContribution()] : []),
    ]),
    runtimePlugins: Object.freeze([
      ...(flags.toolbar ? [ToolbarLifecyclePlugin] : []),
      ...(flags.slashMenu ? [SlashLifecyclePlugin] : []),
      ...(flags.wordCount ? [WordCountLifecyclePlugin] : []),
      ...(flags.blockDrag ? [BlockDragLifecyclePlugin] : []),
    ] as NexusPluginConstructor[]),
    legacyWordCount: null,
    legacyUi: Object.freeze({ toolbar: false, slashMenu: false, wordCount: false, blockDrag: false }),
  });
}
