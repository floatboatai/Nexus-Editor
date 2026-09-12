import type { NexusPlugin } from "@floatboat/nexus-core";
import { createFormattingPlugin } from "@floatboat/nexus-plugin-formatting";

export {
  toggleBlockquote, toggleOrderedList, toggleUnorderedList, insertCodeBlock, insertImage,
  insertHorizontalRule, applyTextColor, applyHighlight, colorDecorationExtension,
  insertLink, toggleBold, toggleHeading, toggleInlineCode, toggleItalic, toggleStrikethrough, toggleWrap,
  formattingSlashCommands as toolbarSlashCommands,
} from "@floatboat/nexus-plugin-formatting";
export { createToolbarUI } from "./toolbar-ui";
export type { ToolbarUI, ToolbarUIOptions, ToolbarButton, ToolbarGroup } from "./toolbar-ui";

/** Compatibility entrypoint for the existing legacy editor contribution. */
export function createToolbarPlugin(): NexusPlugin {
  return { ...createFormattingPlugin(), name: "plugin-toolbar" };
}

export {
  createToolbarRuntimeSlashContribution,
  ToolbarLifecyclePlugin,
  toolbarLifecyclePluginManifest,
  type ToolbarLifecyclePluginOptions,
} from "./runtime-plugin";
