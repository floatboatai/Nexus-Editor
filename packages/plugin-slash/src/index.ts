import {
  computeSlashState,
  filterSlashCommands,
  getSlashMatch,
  type SlashMatch,
  type SlashStateOptions,
  type SlashStateResult,
} from "@floatboat/nexus-core";
import type { NexusPlugin, SlashCommandDef } from "@floatboat/nexus-core";

export interface SlashMatch {
  from: number;
  to: number;
  query: string;
}

export interface SlashState extends SlashStateResult {
  isOpen: boolean;
  from: number | null;
  to: number | null;
  query: string;
  commands: SlashCommandDef[];
}

export interface SlashPlugin extends NexusPlugin {
  slashCommands: SlashCommandDef[];
}

export function getSlashMatch(doc: string, cursor: number): SlashMatch | null {
  const beforeCursor = doc.slice(0, cursor);
  const lineStart = beforeCursor.lastIndexOf("\n") + 1;
  const lineText = beforeCursor.slice(lineStart);
  const slashIndex = lineText.lastIndexOf("/");

  if (slashIndex === -1) {
    return null;
  }

  const charBeforeSlash = slashIndex === 0 ? "" : lineText[slashIndex - 1];

  if (charBeforeSlash && /\S/.test(charBeforeSlash)) {
    return null;
  }

  const query = lineText.slice(slashIndex + 1);

  if (/\s/.test(query)) {
    return null;
  }

  return {
    from: lineStart + slashIndex,
    to: cursor,
    query
  };
}

export interface FilterSlashCommandsOptions {
  limit?: number;
}

function calculateMatchScore(command: SlashCommandDef, query: string): number {
  const title = command.title.toLowerCase();
  const keywords = (command.keywords ?? []).map((k) => k.toLowerCase());
  const normalizedQuery = query.toLowerCase();

  let score = 0;

  // Title exact match
  if (title === normalizedQuery) score = 100;
  // Title starts with query
  else if (title.startsWith(normalizedQuery)) score = 80;
  // Title contains query
  else if (title.includes(normalizedQuery)) score = 60;
  // Keyword starts with query
  else if (keywords.some((k) => k.startsWith(normalizedQuery))) score = 50;
  // Keyword contains query
  else if (keywords.some((k) => k.includes(normalizedQuery))) score = 30;
  else return 0; // No match

  // Add priority bonus
  score += (command.priority ?? 0);

  return score;
}

export function filterSlashCommands(
  commands: SlashCommandDef[],
  query: string,
  options: FilterSlashCommandsOptions = {}
): SlashCommandDef[] {
  const { limit = 10 } = options;
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    // No query: sort by priority only, then apply limit
    return [...commands]
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      .slice(0, limit);
  }

  // Calculate scores and filter
  const scored = commands
    .map((cmd) => ({
      cmd,
      score: calculateMatchScore(cmd, normalizedQuery)
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      // Higher score first
      if (b.score !== a.score) return b.score - a.score;
      // Same score: sort by priority
      return (b.cmd.priority ?? 0) - (a.cmd.priority ?? 0);
    });

  return scored.map((s) => s.cmd).slice(0, limit);
}

export type SlashState = SlashStateResult;
export type { SlashStateOptions, SlashStateResult };

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
} from "./menu-ui";
