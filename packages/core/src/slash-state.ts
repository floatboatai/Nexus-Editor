import type { SlashCommandDef } from "./types";

export interface SlashMatch {
  from: number;
  to: number;
  query: string;
}

export interface SlashStateOptions {
  /**
   * Cap the returned command list after ranking. Default: 8. A limit of
   * 0 returns an empty array while keeping `isOpen: true`, useful for
   * "no results" placeholder UIs that want to stay mounted.
   */
  limit?: number;
}

export interface SlashStateResult {
  isOpen: boolean;
  from: number | null;
  to: number | null;
  query: string;
  commands: SlashCommandDef[];
}

const DEFAULT_LIMIT = 8;

// Score tiers — higher tier wins regardless of secondary tiebreaker.
// Keep the gaps wide enough that the tiebreaker can never bridge two
// adjacent tiers (max tiebreaker offset is bounded by title length, in
// practice < 100, so a gap of 1000 is safe).
const SCORE_EMPTY_PRESERVE_ORDER = 0;
const SCORE_TITLE_EXACT = 6000;
const SCORE_TITLE_PREFIX = 5000;
const SCORE_KEYWORD_EXACT = 4000;
const SCORE_TITLE_SUBSTRING = 3000;
const SCORE_KEYWORD_PREFIX = 2000;
const SCORE_KEYWORD_SUBSTRING = 1000;

export function getSlashMatch(doc: string, cursor: number): SlashMatch | null {
  const before = doc.slice(0, cursor);
  const lineStart = before.lastIndexOf("\n") + 1;
  const line = before.slice(lineStart);
  const slashIndex = line.lastIndexOf("/");

  if (slashIndex < 0) return null;

  // Slash must be at the start of the line or preceded by whitespace —
  // otherwise it's part of a path, URL, fraction, or similar token.
  const charBefore = slashIndex > 0 ? line[slashIndex - 1] : undefined;
  if (charBefore !== undefined && charBefore.trim() !== "") return null;

  const query = line.slice(slashIndex + 1);
  // Whitespace inside the query implies the user has typed past the
  // command; close the menu instead of matching ambiguously.
  if (/\s/.test(query)) return null;

  return {
    from: lineStart + slashIndex,
    to: cursor,
    query,
  };
}

interface ScoredCommand {
  cmd: SlashCommandDef;
  score: number;
  tiebreaker: number;
  index: number;
}

function scoreCommand(
  cmd: SlashCommandDef,
  query: string,
  index: number
): ScoredCommand | null {
  const title = cmd.title.toLowerCase();

  if (title === query) {
    return { cmd, score: SCORE_TITLE_EXACT, tiebreaker: 0, index };
  }
  if (title.startsWith(query)) {
    // Shorter titles win on prefix ties — "Heading" beats "Heading 2 inset".
    return { cmd, score: SCORE_TITLE_PREFIX, tiebreaker: title.length, index };
  }

  const keywords = cmd.keywords ?? [];
  for (const kw of keywords) {
    if (kw.toLowerCase() === query) {
      return { cmd, score: SCORE_KEYWORD_EXACT, tiebreaker: 0, index };
    }
  }

  const titleIdx = title.indexOf(query);
  if (titleIdx >= 0) {
    // Earlier substring offset wins.
    return { cmd, score: SCORE_TITLE_SUBSTRING, tiebreaker: titleIdx, index };
  }

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if (kwLower.startsWith(query)) {
      return { cmd, score: SCORE_KEYWORD_PREFIX, tiebreaker: kwLower.length, index };
    }
  }

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    const kwIdx = kwLower.indexOf(query);
    if (kwIdx >= 0) {
      return { cmd, score: SCORE_KEYWORD_SUBSTRING, tiebreaker: kwIdx, index };
    }
  }

  return null;
}

export function filterSlashCommands(
  commands: SlashCommandDef[],
  query: string,
  maxResults?: number
): SlashCommandDef[] {
  if (query === "") {
    const sorted = commands
      .map((cmd, index) => ({
        cmd,
        prio: cmd.priority ?? 0,
        index,
      }))
      .sort((a, b) => {
        if (b.prio !== a.prio) return b.prio - a.prio;
        const titleCmp = a.cmd.title.localeCompare(b.cmd.title, undefined, {
          sensitivity: "base",
        });
        if (titleCmp !== 0) return titleCmp;
        return a.index - b.index;
      });

    let result = sorted.map((s) => s.cmd);
    if (maxResults !== undefined && maxResults > 0) {
      result = result.slice(0, maxResults);
    }
    return result;
  }

  const q = query.toLowerCase();
  const scored: ScoredCommand[] = [];

  for (let i = 0; i < commands.length; i++) {
    const result = scoreCommand(commands[i], q, i);
    if (result !== null) scored.push(result);
  }

  scored.sort((a, b) => {
    const pa = a.cmd.priority ?? 0;
    const pb = b.cmd.priority ?? 0;
    if (pa !== pb) return pb - pa;
    if (b.score !== a.score) return b.score - a.score;
    if (a.tiebreaker !== b.tiebreaker) return a.tiebreaker - b.tiebreaker;
    const titleCmp = a.cmd.title.localeCompare(b.cmd.title);
    if (titleCmp !== 0) return titleCmp;
    return a.index - b.index;
  });

  let result = scored.map((s) => s.cmd);
  if (maxResults !== undefined && maxResults > 0) {
    result = result.slice(0, maxResults);
  }
  return result;
}

export function computeSlashState(
  doc: string,
  cursor: number,
  commands: SlashCommandDef[],
  options?: SlashStateOptions
): SlashStateResult {
  const match = getSlashMatch(doc, cursor);
  if (!match) {
    return { isOpen: false, from: null, to: null, query: "", commands: [] };
  }

  const filtered = filterSlashCommands(commands, match.query);
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const capped = limit < 0 ? filtered : filtered.slice(0, limit);

  return {
    isOpen: true,
    from: match.from,
    to: match.to,
    query: match.query,
    commands: capped,
  };
}
