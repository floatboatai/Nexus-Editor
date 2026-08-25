import {
  computeSlashState,
  filterSlashCommands,
  getSlashMatch,
  type SlashMatch,
  type SlashStateOptions,
  type SlashStateResult,
} from "@floatboat/nexus-core";
import type { NexusPlugin, SlashCommandDef } from "@floatboat/nexus-core";

export type SlashState = SlashStateResult;
export type { SlashMatch, SlashStateOptions, SlashStateResult };
export { filterSlashCommands, getSlashMatch };

export const defaultSlashCommands: SlashCommandDef[] = [
  {
    id: "todo",
    title: "To-do list",
    description: "Track tasks with a to-do list",
    keywords: ["todo", "task", "check", "checklist", "[]"],
    run: (editor) => {
      const doc = editor.getDocument();
      const { anchor } = editor.getSelection();
      const lineStart = doc.lastIndexOf("\n", anchor - 1) + 1;
      const lineEndIdx = doc.indexOf("\n", anchor);
      const lineEnd = lineEndIdx === -1 ? doc.length : lineEndIdx;
      const line = doc.slice(lineStart, lineEnd);
      const trimmed = line.trim();
      const insertText = "- [ ] ";
      if (trimmed === "" || /^\s*\/[a-zA-Z0-9_-]*\s*$/.test(line)) {
        editor.replaceRange(lineStart, lineEnd, insertText, {
          anchor: lineStart + insertText.length,
        });
        return true;
      }
      editor.replaceRange(lineStart, lineStart, insertText, {
        anchor: anchor + insertText.length,
      });
      return true;
    },
  },
  {
    id: "task",
    title: "To-do list",
    description: "Track tasks with a to-do list",
    keywords: ["task", "todo", "check", "checklist", "[]"],
    run: (editor) => {
      const doc = editor.getDocument();
      const { anchor } = editor.getSelection();
      const lineStart = doc.lastIndexOf("\n", anchor - 1) + 1;
      const lineEndIdx = doc.indexOf("\n", anchor);
      const lineEnd = lineEndIdx === -1 ? doc.length : lineEndIdx;
      const line = doc.slice(lineStart, lineEnd);
      const trimmed = line.trim();
      const insertText = "- [ ] ";
      if (trimmed === "" || /^\s*\/[a-zA-Z0-9_-]*\s*$/.test(line)) {
        editor.replaceRange(lineStart, lineEnd, insertText, {
          anchor: lineStart + insertText.length,
        });
        return true;
      }
      editor.replaceRange(lineStart, lineStart, insertText, {
        anchor: anchor + insertText.length,
      });
      return true;
    },
  },
];

/**
 * Compute the slash menu state for the given document + caret. Kept as
 * an alias of the core helper so SDK consumers don't have to import from
 * two packages. Forward-compatible with the `{ limit }` option.
 */
export function getSlashState(
  doc: string,
  cursor: number,
  commands: SlashCommandDef[],
  options?: SlashStateOptions,
): SlashStateResult {
  return computeSlashState(doc, cursor, commands, options);
}

export interface SlashPlugin extends NexusPlugin {
  slashCommands: SlashCommandDef[];
}

export function createSlashPlugin(commands: SlashCommandDef[]): SlashPlugin {
  return {
    name: "plugin-slash",
    slashCommands: commands,
  };
}

export {
  createSlashMenuUI,
  type SlashMenuUI,
  type SlashMenuUIOptions,
  type SlashMenuCommandContext,
  type SlashCommandHistoryConfig,
  type SlashCommandHistoryOptions,
  type SlashCommandHistoryStorage,
} from "./menu-ui";

export {
  SlashLifecyclePlugin,
  slashLifecyclePluginManifest,
  type SlashLifecyclePluginOptions,
} from "./runtime-plugin";
