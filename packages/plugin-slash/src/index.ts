import type { NexusPlugin, SlashCommandDef } from "@floatboat/nexus-core";

export interface SlashMatch {
  from: number;
  to: number;
  query: string;
}

export interface SlashState {
  isOpen: boolean;
  from: number | null;
  to: number | null;
  query: string;
  commands: SlashCommandDef[];
}

export interface SlashPlugin extends NexusPlugin {
  slashCommands: SlashCommandDef[];
}

export interface SlashPluginOptions {
  /** Maximum number of commands returned after filtering. Default: no limit */
  limit?: number;
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

type MatchPriority = 0 | 1 | 2;

function getMatchPriority(command: SlashCommandDef, query: string): MatchPriority | null {
  const normalizedQuery = query.trim().toLowerCase();
  const titleLower = command.title.toLowerCase();

  if (titleLower === normalizedQuery) return 0;
  if (titleLower.startsWith(normalizedQuery)) return 1;
  if ((command.keywords ?? []).some((kw) => kw.toLowerCase().includes(normalizedQuery))) return 2;
  if (titleLower.includes(normalizedQuery)) return 2;
  return null;
}

export function filterSlashCommands(
  commands: SlashCommandDef[],
  query: string,
  limit?: number
): SlashCommandDef[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return limit != null ? commands.slice(0, limit) : commands;
  }

  const scored: Array<{ command: SlashCommandDef; priority: MatchPriority }> = [];

  for (const command of commands) {
    const priority = getMatchPriority(command, normalizedQuery);
    if (priority !== null) {
      scored.push({ command, priority });
    }
  }

  scored.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.command.title.localeCompare(b.command.title);
  });

  const result = scored.map((entry) => entry.command);
  return limit != null ? result.slice(0, limit) : result;
}

export function getSlashState(
  doc: string,
  cursor: number,
  commands: SlashCommandDef[],
  limit?: number
): SlashState {
  const match = getSlashMatch(doc, cursor);

  if (!match) {
    return {
      isOpen: false,
      from: null,
      to: null,
      query: "",
      commands: []
    };
  }

  return {
    isOpen: true,
    from: match.from,
    to: match.to,
    query: match.query,
    commands: filterSlashCommands(commands, match.query, limit)
  };
}

export function createSlashPlugin(
  commands: SlashCommandDef[],
  options?: SlashPluginOptions
): SlashPlugin {
  return {
    name: "plugin-slash",
    slashCommands: commands
  };
}
