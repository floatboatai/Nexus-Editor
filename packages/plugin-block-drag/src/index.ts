import type { Extension } from "@codemirror/state";
import type { NexusPlugin } from "@floatboat/nexus-core";
import { buildBlockDragExtension, type BlockDragOptions } from "./extension";

export type { BlockDragOptions } from "./extension";
export { BlockDragLifecyclePlugin, blockDragLifecyclePluginManifest } from "./runtime-plugin";

export function createBlockDragExtension(options: BlockDragOptions = {}): Extension {
  return buildBlockDragExtension(options, new Set());
}

export function createBlockDragPlugin(options: BlockDragOptions = {}): NexusPlugin {
  return { name: "plugin-block-drag", cmExtensions: [createBlockDragExtension(options)] };
}
