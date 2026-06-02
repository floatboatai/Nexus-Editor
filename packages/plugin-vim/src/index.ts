import type { NexusPlugin } from "@floatboat/nexus-core";
import { vim } from "@replit/codemirror-vim";

export function createVimPlugin(): NexusPlugin {
  return {
    name: "plugin-vim",
    cmExtensions: [vim()],
  };
}
