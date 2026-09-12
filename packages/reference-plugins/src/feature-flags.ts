import type { NexusPlugin } from "@floatboat/nexus-core";
import type { NexusPluginConstructor } from "@floatboat/nexus-plugin-api";
import { createFormattingPlugin, createFormattingRuntimeSlashContribution, FormattingLifecyclePlugin } from "@floatboat/nexus-plugin-formatting";
import { SelectionToolbarLifecyclePlugin } from "@floatboat/nexus-plugin-selection-toolbar";
import { SlashLifecyclePlugin } from "@floatboat/nexus-plugin-slash";
import {
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
  /** Defaults to toolbar for compatibility with existing flag objects. */
  readonly formatting?: boolean;
  /** Independent opt-in for the selection UI. */
  readonly selectionToolbar?: boolean;
  readonly slashMenu: boolean;
  readonly wordCount: boolean;
}

export interface ReferencePluginBootPlan {
  readonly mode: "legacy" | "runtime";
  readonly editorContributions: readonly NexusPlugin[];
  readonly runtimePlugins: readonly NexusPluginConstructor[];
  readonly legacyWordCount: WordCountPlugin | null;
  readonly legacyFormatting: boolean;
  readonly legacyUi: Readonly<{
    toolbar: boolean;
    selectionToolbar: boolean;
    slashMenu: boolean;
    wordCount: boolean;
  }>;
}

/**
 * Selects exactly one owner for migrated behavior. Hosts apply this plan before
 * editor construction and must not independently mount the old UI factories.
 */
export function createReferencePluginBootPlan(
  flags: ReferencePluginFeatureFlags,
): ReferencePluginBootPlan {
  const formatting = flags.formatting ?? flags.toolbar;
  const selectionToolbar = flags.selectionToolbar ?? false;
  if (!flags.pluginPlatform) {
    const legacyWordCount = flags.wordCount ? createWordCountPlugin() : null;
    return Object.freeze({
      mode: "legacy" as const,
      editorContributions: Object.freeze([
        ...(formatting ? [createFormattingPlugin()] : []),
        ...(legacyWordCount ? [legacyWordCount] : []),
      ]),
      runtimePlugins: Object.freeze([]),
      legacyWordCount,
      legacyFormatting: formatting,
      legacyUi: Object.freeze({
        toolbar: flags.toolbar,
        selectionToolbar,
        slashMenu: flags.slashMenu,
        wordCount: Boolean(legacyWordCount),
      }),
    });
  }

  return Object.freeze({
    mode: "runtime" as const,
    editorContributions: Object.freeze([
      ...(formatting && flags.slashMenu ? [createFormattingRuntimeSlashContribution()] : []),
    ]),
    runtimePlugins: Object.freeze([
      ...(formatting ? [FormattingLifecyclePlugin] : []),
      ...(flags.toolbar ? [ToolbarLifecyclePlugin] : []),
      ...(selectionToolbar ? [SelectionToolbarLifecyclePlugin] : []),
      ...(flags.slashMenu ? [SlashLifecyclePlugin] : []),
      ...(flags.wordCount ? [WordCountLifecyclePlugin] : []),
    ] as NexusPluginConstructor[]),
    legacyWordCount: null,
    legacyFormatting: false,
    legacyUi: Object.freeze({ toolbar: false, selectionToolbar: false, slashMenu: false, wordCount: false }),
  });
}
