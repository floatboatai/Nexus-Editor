import type { NexusPlugin } from "@floatboat/nexus-core";
import { createBlockDragExtension, type BlockDragOptions } from "./extension";

export { createBlockDragExtension, type BlockDragOptions } from "./extension";
export { BlockDragLifecyclePlugin, blockDragLifecyclePluginManifest } from "./runtime-plugin";

export function createBlockDragPlugin(options: BlockDragOptions = {}): NexusPlugin {
  return { name: "plugin-block-drag", cmExtensions: [createBlockDragExtension(options)] };
}
