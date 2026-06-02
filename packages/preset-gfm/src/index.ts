import remarkGfm from "remark-gfm";

import type { NexusPlugin } from "@floatboat/nexus-core";

export function createGfmPreset(): NexusPlugin {
  return {
    name: "preset-gfm",
    remarkPlugins: [remarkGfm],
  };
}
