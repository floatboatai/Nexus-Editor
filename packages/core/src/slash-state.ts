import { matchFuzzy, type FuzzyMatchResult } from "./fuzzy-match";
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

/**
 * One ranked slash command. `positions` is what a menu needs to highlight the
 * characters the query covered without re-parsing the title.
 */
export interface SlashCommandRanking {
  command: SlashCommandDef;
  /** Tier score plus the within-tier alignment score; higher is better. */
  score: number;
  /** Field that produced the winning match. */
  field: "title" | "keyword";
  /** Field text the `positions` refer to — the title, or the matched keyword. */
  matchedText: string;
  /**
   * Ascending indices in `matchedText` covered by the query. Empty for an
   * empty query.
   */
  positions: number[];
}

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
// Fuzzy subsequence hits are the last resort: any literal hit outranks them,
// and their alignment score is clamped into the band below the lowest literal
// tier so a `tbl` alignment can never leapfrog a real `tbl` substring.
const SCORE_FUZZY_CEILING = SCORE_KEYWORD_SUBSTRING - 1;

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
  ranking: SlashCommandRanking;
  tiebreaker: number;
  index: number;
}

function positionsInRange(start: number, length: number): number[] {
  return Array.from({ length }, (_, offset) => start + offset);
}

/**
 * Score one command against an already lower-cased query. Tiers are evaluated
 * in order and the first hit wins, mirroring the documented precedence:
 * exact title → title prefix → exact keyword → title substring → keyword
 * prefix → keyword substring → fuzzy.
 */
function scoreCommand(
  cmd: SlashCommandDef,
  query: string,
  index: number
): ScoredCommand | null {
  const title = cmd.title.toLowerCase();

  if (title === query) {
    return {
      ranking: {
        command: cmd,
        score: SCORE_TITLE_EXACT,
        field: "title",
        matchedText: cmd.title,
        positions: positionsInRange(0, cmd.title.length)
      },
      tiebreaker: 0,
      index
    };
  }
  if (title.startsWith(query)) {
    // Shorter titles win on prefix ties — "Heading" beats "Heading 2 inset".
    return {
      ranking: {
        command: cmd,
        score: SCORE_TITLE_PREFIX,
        field: "title",
        matchedText: cmd.title,
        positions: positionsInRange(0, query.length)
      },
      tiebreaker: title.length,
      index
    };
  }

  const keywords = cmd.keywords ?? [];
  for (const kw of keywords) {
    if (kw.toLowerCase() === query) {
      return {
        ranking: {
          command: cmd,
          score: SCORE_KEYWORD_EXACT,
          field: "keyword",
          matchedText: kw,
          positions: positionsInRange(0, kw.length)
        },
        tiebreaker: 0,
        index
      };
    }
  }

  const titleIdx = title.indexOf(query);
  if (titleIdx >= 0) {
    // Earlier substring offset wins.
    return {
      ranking: {
        command: cmd,
        score: SCORE_TITLE_SUBSTRING,
        field: "title",
        matchedText: cmd.title,
        positions: positionsInRange(titleIdx, query.length)
      },
      tiebreaker: titleIdx,
      index
    };
  }

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if (kwLower.startsWith(query)) {
      return {
        ranking: {
          command: cmd,
          score: SCORE_KEYWORD_PREFIX,
          field: "keyword",
          matchedText: kw,
          positions: positionsInRange(0, query.length)
        },
        tiebreaker: kwLower.length,
        index
      };
    }
  }

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    const kwIdx = kwLower.indexOf(query);
    if (kwIdx >= 0) {
      return {
        ranking: {
          command: cmd,
          score: SCORE_KEYWORD_SUBSTRING,
          field: "keyword",
          matchedText: kw,
          positions: positionsInRange(kwIdx, query.length)
        },
        tiebreaker: kwIdx,
        index
      };
    }
  }

  return scoreFuzzyCommand(cmd, query, index);
}

/**
 * Last-resort tier: the query characters appear in the title or a keyword in
 * order, but not contiguously. The title owns ties so the rendered label is the
 * one that gets highlighted.
 */
function scoreFuzzyCommand(
  cmd: SlashCommandDef,
  query: string,
  index: number
): ScoredCommand | null {
  const titleMatch = matchFuzzy(query, cmd.title);
  let best: (FuzzyMatchResult & { field: "title" | "keyword"; matchedText: string }) | null =
    titleMatch === null
      ? null
      : { ...titleMatch, field: "title" as const, matchedText: cmd.title };

  for (const kw of cmd.keywords ?? []) {
    const keywordMatch = matchFuzzy(query, kw);
    if (keywordMatch === null) continue;
    if (best === null || keywordMatch.score > best.score) {
      best = { ...keywordMatch, field: "keyword" as const, matchedText: kw };
    }
  }

  if (best === null) return null;

  return {
    ranking: {
      command: cmd,
      score: Math.min(best.score, SCORE_FUZZY_CEILING),
      field: best.field,
      matchedText: best.matchedText,
      positions: best.positions
    },
    // Shorter matched fields win fuzzy ties, matching the literal tiers.
    tiebreaker: best.matchedText.length,
    index
  };
}

/**
 * Rank commands for a slash query, reporting where each match landed so hosts
 * can highlight it. Fuzzy matching only widens the candidate set — a command
 * that matches literally always keeps its tier and its position in the order.
 */
export function rankSlashCommands(
  commands: SlashCommandDef[],
  query: string
): SlashCommandRanking[] {
  if (query === "") {
    // Empty query is the "menu just opened" case — keep the registration
    // order so the host can choose a "frequently used first" layout via
    // its plugin order instead of being overridden by an alphabetical
    // sort it didn't ask for.
    return commands.map((command) => ({
      command,
      score: SCORE_EMPTY_PRESERVE_ORDER,
      field: "title",
      matchedText: command.title,
      positions: []
    }));
  }

  const q = query.toLowerCase();
  const scored: ScoredCommand[] = [];

  for (let i = 0; i < commands.length; i++) {
    const result = scoreCommand(commands[i], q, i);
    if (result !== null) scored.push(result);
  }

  scored.sort((a, b) => {
    if (b.ranking.score !== a.ranking.score) return b.ranking.score - a.ranking.score;
    if (a.tiebreaker !== b.tiebreaker) return a.tiebreaker - b.tiebreaker;
    // Final stability key: alphabetical title, then original registration
    // order. Two commands with identical scores AND identical
    // tiebreakers (e.g. same length, same offset) will sort by title so
    // snapshots stay deterministic across runs.
    const titleCmp = a.ranking.command.title.localeCompare(b.ranking.command.title);
    if (titleCmp !== 0) return titleCmp;
    return a.index - b.index;
  });

  return scored.map((s) => s.ranking);
}

export function filterSlashCommands(
  commands: SlashCommandDef[],
  query: string
): SlashCommandDef[] {
  return rankSlashCommands(commands, query).map((ranking) => ranking.command);
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
  // A negative limit is treated as "no cap" so callers can opt out with
  // `{ limit: Infinity }` or `{ limit: -1 }` without us having to invent
  // a separate sentinel.
  const capped = limit < 0 ? filtered : filtered.slice(0, limit);

  return {
    isOpen: true,
    from: match.from,
    to: match.to,
    query: match.query,
    commands: capped,
  };
}
