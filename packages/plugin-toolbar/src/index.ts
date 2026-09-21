import type { NexusPlugin } from "@floatboat/nexus-core";
import { colorDecorationExtension } from "./color-decoration";
import {
  insertLink,
  toolbarSlashCommands,
  toggleBold,
  toggleHeading,
  toggleInlineCode,
  toggleItalic,
  toggleStrikethrough,
} from "./toolbar-commands";

export { toggleBlockquote, toggleOrderedList, toggleUnorderedList, insertCodeBlock, insertImage, insertTable, insertEmoji, insertHorizontalRule, applyTextColor, applyHighlight } from "./formatting";
export { EMOJI_CATEGORIES, type EmojiCategory } from "./emoji";
export { createToolbarUI } from "./toolbar-ui";
export { colorDecorationExtension } from "./color-decoration";
export type { ToolbarUI, ToolbarUIOptions, ToolbarButton, ToolbarGroup } from "./toolbar-ui";
export {
  insertLink,
  toolbarSlashCommands,
  toggleBold,
  toggleHeading,
  toggleInlineCode,
  toggleItalic,
  toggleStrikethrough,
  toggleWrap,
} from "./toolbar-commands";

export function createToolbarPlugin(): NexusPlugin {
  return {
    name: "plugin-toolbar",
    shortcuts: [
      { key: "Mod-b", run: toggleBold },
      { key: "Mod-i", run: toggleItalic },
      { key: "Mod-Shift-s", run: toggleStrikethrough },
      { key: "Mod-e", run: toggleInlineCode },
      { key: "Mod-k", run: insertLink },
      { key: "Mod-1", run: (e) => toggleHeading(e, 1) },
      { key: "Mod-2", run: (e) => toggleHeading(e, 2) },
      { key: "Mod-3", run: (e) => toggleHeading(e, 3) },
    ],
    slashCommands: toolbarSlashCommands,
    cmExtensions: [colorDecorationExtension()],
  };
}

export {
  createToolbarRuntimeSlashContribution,
  ToolbarLifecyclePlugin,
  toolbarLifecyclePluginManifest,
  type ToolbarLifecyclePluginOptions,
} from "./runtime-plugin";
