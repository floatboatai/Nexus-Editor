import type { NexusPlugin, SlashCommandDef } from "@nexus/core";

export interface SlashMatch {
  from: number;
  to: number;
  query: string;
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

export function filterSlashCommands(
  commands: SlashCommandDef[],
  query: string
): SlashCommandDef[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return commands;
  }

  return commands.filter((command) => {
    const haystacks = [command.title, ...(command.keywords ?? [])].map((value) =>
      value.toLowerCase()
    );

    return haystacks.some((value) => value.includes(normalizedQuery));
  });
}

export function createSlashPlugin(commands: SlashCommandDef[]): SlashPlugin {
  return {
    name: "plugin-slash",
    slashCommands: commands
  };
}
