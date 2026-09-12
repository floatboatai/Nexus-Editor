import { FormattingLifecyclePlugin, formattingLifecyclePluginManifest } from "@floatboat/nexus-plugin-formatting";
import { SelectionToolbarLifecyclePlugin, selectionToolbarLifecyclePluginManifest } from "@floatboat/nexus-plugin-selection-toolbar";
import type {
  AuthorPluginManifest,
  NexusPluginConstructor,
} from "@floatboat/nexus-plugin-api";
import {
  SlashLifecyclePlugin,
  slashLifecyclePluginManifest,
} from "@floatboat/nexus-plugin-slash";
import {
  ToolbarLifecyclePlugin,
  toolbarLifecyclePluginManifest,
} from "@floatboat/nexus-plugin-toolbar";
import {
  WordCountLifecyclePlugin,
  wordCountLifecyclePluginManifest,
} from "@floatboat/nexus-plugin-wordcount";

import {
  ObsidianSamplePortPlugin,
  obsidianSamplePortManifest,
} from "./obsidian-sample-port";

export interface BundledReferencePlugin {
  readonly manifest: AuthorPluginManifest;
  readonly Plugin: NexusPluginConstructor;
}

/** Host-controlled manifest/constructor pairs for bundled entrypoint resolvers. */
export const bundledReferencePlugins: readonly BundledReferencePlugin[] = Object.freeze([
  { manifest: wordCountLifecyclePluginManifest, Plugin: WordCountLifecyclePlugin },
  { manifest: formattingLifecyclePluginManifest, Plugin: FormattingLifecyclePlugin },
  { manifest: toolbarLifecyclePluginManifest, Plugin: ToolbarLifecyclePlugin },
  { manifest: selectionToolbarLifecyclePluginManifest, Plugin: SelectionToolbarLifecyclePlugin },
  { manifest: slashLifecyclePluginManifest, Plugin: SlashLifecyclePlugin },
  { manifest: obsidianSamplePortManifest, Plugin: ObsidianSamplePortPlugin },
]);

export function findBundledReferencePlugin(
  id: string,
): BundledReferencePlugin | undefined {
  return bundledReferencePlugins.find((entry) => entry.manifest.id === id);
}
