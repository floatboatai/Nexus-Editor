/**
 * @floatboat/nexus-plugin-mention
 *
 * A headless @mention plugin for Nexus-Editor.
 */

import type { NexusPlugin } from "@floatboat/nexus-core";
import type { MentionPluginConfig } from "./mention-types";
import { createMentionExtension, mentionKeymap } from "./mention-extension";
import { createMentionWidgetDefinition } from "./mention-widget";
import { remarkMention } from "./mention-ast";
import { keymap } from "@codemirror/view";

export type {
  MentionItem,
  MentionMenuState,
  MentionMenuDirection,
  MentionQueryFn,
  MentionInsertFormat,
  MentionRenderItemFn,
  MentionPluginConfig,
  MentionMdastNode,
  MentionWidgetContext,
} from "./mention-types";

export { remarkMention, stringifyMention } from "./mention-ast";
export { createMentionWidgetDefinition } from "./mention-widget";
export { createMentionMenu, updateMenuSelection } from "./mention-menu";

export function createMentionPlugin(config: MentionPluginConfig): NexusPlugin {
  return {
    name: "plugin-mention",
    remarkPlugins: [remarkMention],
    widgets: [createMentionWidgetDefinition()],
    cmExtensions: [
      (editor: any) => createMentionExtension(editor, config),
      keymap.of(mentionKeymap),
    ],
  };
}
