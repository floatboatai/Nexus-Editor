import type { NexusPlugin } from "@floatboat/nexus-core";
import { colorDecorationExtension } from "./color-decoration";
import { insertLink, toggleBold, toggleHeading, toggleInlineCode, toggleItalic, toggleStrikethrough } from "./commands";
import { formattingSlashCommands } from "./slash-commands";

export { insertLink, toggleBold, toggleHeading, toggleInlineCode, toggleItalic, toggleStrikethrough, toggleWrap } from "./commands";
export { toggleBlockquote, toggleOrderedList, toggleUnorderedList, insertCodeBlock, insertImage, insertHorizontalRule, applyTextColor, applyHighlight } from "./formatting";
export { colorDecorationExtension } from "./color-decoration";
export { formattingCommands, type FormattingCommand } from "./command-definitions";
export { formattingSlashCommands } from "./slash-commands";
export { FormattingLifecyclePlugin, formattingLifecyclePluginManifest, createFormattingRuntimeSlashContribution } from "./runtime-plugin";

/** Legacy editor contributions. Hosts install this once independently of toolbar UI. */
export function createFormattingPlugin(): NexusPlugin {
  return {
    name: "plugin-formatting",
    shortcuts: [
      { key: "Mod-b", run: toggleBold },
      { key: "Mod-i", run: toggleItalic },
      { key: "Mod-Shift-s", run: toggleStrikethrough },
      { key: "Mod-e", run: toggleInlineCode },
      { key: "Mod-k", run: insertLink },
      { key: "Mod-1", run: (editor) => toggleHeading(editor, 1) },
      { key: "Mod-2", run: (editor) => toggleHeading(editor, 2) },
      { key: "Mod-3", run: (editor) => toggleHeading(editor, 3) },
    ],
    slashCommands: formattingSlashCommands,
    cmExtensions: [colorDecorationExtension()],
  };
}
