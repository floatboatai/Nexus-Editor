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

/**
 * Compute the slash menu state for the given document + caret. Kept as
 * an alias of the core helper so SDK consumers don't have to import from
 * two packages. Forward-compatible with the `{ limit }` option.
 */
export function getSlashState(
  doc: string,
  cursor: number,
  commands: SlashCommandDef[],
  options?: SlashStateOptions
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
