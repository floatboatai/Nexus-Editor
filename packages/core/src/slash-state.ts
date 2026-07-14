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
const SCORE_FUZZY_TITLE = 500;
const SCORE_FUZZY_KEYWORD = 250;

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

/**
 * 对目标字符串进行模糊匹配，判断查询字符串的所有字符是否按顺序出现在目标字符串中。
 *
 * 返回一个评分（越高越好），如果无法匹配则返回 `null`。
 *
 * 算法采用贪心从左到右扫描，为每个查询字符找到最早出现的匹配位置。
 * 评分规则：
 *
 * - **连续匹配加分**（每对连续匹配 +5）—— "ad" 在 "Heading" 中位置相邻（2,3），
 *   比 "ag" 分散的位置（2,6）得分更高。
 * - **词边界加分**（+8）—— 匹配字符的前一个字符是空格、连字符、下划线、斜杠或点号时触发。
 * - **驼峰边界加分**（+6）—— 匹配字符紧跟在「小写→大写」的过渡之后时触发。
 * - **字符串开头加分**（+10）—— 首个匹配字符出现在位置 0 时触发。
 *
 * 原始总分除以目标字符串长度做归一化，使得同样质量的匹配在较短字符串上得分更高。
 */
export function fuzzyScore(target: string, query: string): number | null {
  if (query.length === 0) return 0;
  if (query.length > target.length) return null;

  const t = target.toLowerCase();
  const q = query.toLowerCase();

  // 贪心最左匹配：为每个查询字符找到最早出现的位置。
  // 只要所有查询字符按顺序找到，匹配即为有效——评分加成项本身
  // 已经偏向更紧凑的匹配序列。
  const positions: number[] = [];
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return null;
    positions.push(found);
    ti = found + 1;
  }

  let score = 0;
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    score += 1; // 每个匹配字符的基础分

    if (pos === 0) score += 10; // 字符串开头

    // 词边界（字符前是常见分隔符）
    if (pos > 0 && /[\s\-_/.]/.test(t[pos - 1])) score += 8;

    // 驼峰边界（小写字母 → 大写字母）
    if (
      pos > 0 &&
      t[pos - 1] >= "a" &&
      t[pos - 1] <= "z" &&
      target[pos] >= "A" &&
      target[pos] <= "Z"
    ) {
      score += 6;
    }

    // 连续字符对加分
    if (i > 0 && positions[i] === positions[i - 1] + 1) {
      score += 5;
    }
  }

  // 除以目标字符串长度做归一化，使得短字符串在同等匹配质量下排名更靠前
  return score / t.length;
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

  const fuzzyTitle = fuzzyScore(cmd.title, query);
  if (fuzzyTitle !== null) {
    return { cmd, score: SCORE_FUZZY_TITLE, tiebreaker: -fuzzyTitle, index };
  }

  for (const kw of keywords) {
    const fuzzyKw = fuzzyScore(kw, query);
    if (fuzzyKw !== null) {
      return { cmd, score: SCORE_FUZZY_KEYWORD, tiebreaker: -fuzzyKw, index };
    }
  }

  return null;
}

export function filterSlashCommands(
  commands: SlashCommandDef[],
  query: string
): SlashCommandDef[] {
  if (query === "") {
    // Empty query is the "menu just opened" case — keep the registration
    // order so the host can choose a "frequently used first" layout via
    // its plugin order instead of being overridden by an alphabetical
    // sort it didn't ask for.
    return commands.slice();
  }

  const q = query.toLowerCase();
  const scored: ScoredCommand[] = [];

  for (let i = 0; i < commands.length; i++) {
    const result = scoreCommand(commands[i], q, i);
    if (result !== null) scored.push(result);
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.tiebreaker !== b.tiebreaker) return a.tiebreaker - b.tiebreaker;
    // Final stability key: alphabetical title, then original registration
    // order. Two commands with identical scores AND identical
    // tiebreakers (e.g. same length, same offset) will sort by title so
    // snapshots stay deterministic across runs.
    const titleCmp = a.cmd.title.localeCompare(b.cmd.title);
    if (titleCmp !== 0) return titleCmp;
    return a.index - b.index;
  });

  return scored.map((s) => s.cmd);
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
