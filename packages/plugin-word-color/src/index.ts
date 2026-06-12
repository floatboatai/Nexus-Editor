import type { NexusPlugin, EditorAPI } from "@floatboat/nexus-core";
import { createWordColorExtension, type WordColorOptions } from "./word-color";

declare module "@floatboat/nexus-core" {
  interface EditorAPI {
    reconfigure?(transaction: { effects: any }): void;
    setWordColors?(map: Record<string, string>, caseSensitive?: boolean): void;
  }
}

export interface WordColorPluginOptions {
  initial?: WordColorOptions;
}

export function createWordColorPlugin(options: WordColorPluginOptions = {}): NexusPlugin {
  const wordColor = createWordColorExtension(options.initial ?? { words: {}, caseSensitive: false });

  return {
    name: "plugin-word-color",
    cmExtensions: [wordColor.extension],
    onReady(editor: EditorAPI) {
      (editor as any).setWordColors = (map: Record<string, string>, caseSensitive = false) => {
        editor.reconfigure?.(wordColor.reconfigure({ words: map, caseSensitive }));
      };
    },
  } as NexusPlugin;
}

export type { WordColorOptions };
