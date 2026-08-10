/**
 * Document-level statistics for the editor.
 *
 * `editor.getDocumentStats()` is a lightweight, synchronous query
 * (characters / words / lines). It intentionally shares the *text-level*
 * counting rules with `@floatboat/nexus-plugin-wordcount` — the plugin's
 * plain-text fallback (`computeFromPlainText`) reuses these helpers — so
 * the two answers never drift apart:
 *
 * - Markdown noise (fenced / inline code, frontmatter, HTML, math, link
 *   definitions) is stripped before counting;
 * - CJK scripts count per character while Latin / Cyrillic / Greek /
 *   numeric runs count per word (the Notion / Obsidian / Bear
 *   convention);
 * - characters are counted by code point (emoji, combining marks), not
 *   by UTF-16 code unit;
 * - lines follow CodeMirror's `state.doc.lines` convention — a trailing
 *   newline does NOT add an empty line.
 */

/** Per-character vs. per-run treatment for CJK scripts. */
export type CjkUnit = "char" | "word";

export interface DocumentStats {
  /** Prose characters, counted by Unicode code point. */
  characters: number;
  /** Latin / numeric word runs + CJK contribution. */
  words: number;
  /** Newline-delimited lines (trailing newline excluded). */
  lines: number;
}

export interface ProseAnalysis {
  words: number;
  latinWords: number;
  cjkCharacters: number;
  characters: number;
  charactersNoSpaces: number;
}

// Unicode property-escape regex literals — supported by ES2018+ and
// safely runnable in our ES2022 target.
const LATIN_WORD_REGEX = /[\p{L}\p{M}\p{N}](?:[\p{L}\p{M}\p{N}\u2019']*[\p{L}\p{M}\p{N}])?/gu;
const CJK_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const CJK_RUN_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const WHITESPACE_REGEX = /\s+/g;

/**
 * Analyse already-stripped prose text. CJK is counted first (per
 * character or per run depending on `cjkUnit`) and then removed before
 * the Latin pass so a Han ideograph is never matched as a one-letter
 * Latin "word" by `\p{L}`.
 */
export function analyseProse(text: string, cjkUnit: CjkUnit): ProseAnalysis {
  if (text.length === 0) {
    return { words: 0, latinWords: 0, cjkCharacters: 0, characters: 0, charactersNoSpaces: 0 };
  }

  const cjkCharacters = (text.match(CJK_REGEX) ?? []).length;
  const cjkContribution = cjkUnit === "char" ? cjkCharacters : (text.match(CJK_RUN_REGEX) ?? []).length;

  // Strip CJK before counting Latin runs to keep the buckets disjoint.
  const latinSource = text.replace(CJK_REGEX, " ");
  const latinWords = (latinSource.match(LATIN_WORD_REGEX) ?? []).length;

  const characters = [...text].length; // count by code point, not UTF-16 unit
  const charactersNoSpaces = characters - countWhitespaceCodePoints(text);

  return {
    words: latinWords + cjkContribution,
    latinWords,
    cjkCharacters,
    characters,
    charactersNoSpaces
  };
}

/**
 * Strip common Markdown syntax noise before counting so the stats are
 * about the *content*, not the formatting. Each block is replaced with a
 * single space so word boundaries are preserved where the syntax
 * interrupts prose.
 */
export function stripMarkdownNoise(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/^---\n[\s\S]*?\n---\n?/m, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\$[^$\n]+\$/g, " ")
    .replace(/^\[[^\]]+\]:[^\n]*$/gm, " ");
}

function countWhitespaceCodePoints(text: string): number {
  let count = 0;
  for (const run of text.match(WHITESPACE_REGEX) ?? []) {
    count += [...run].length;
  }
  return count;
}

/**
 * Count newline-delimited lines, matching CodeMirror's
 * `state.doc.lines` convention: a trailing newline does NOT add an
 * empty line.
 */
export function countLines(source: string): number {
  if (source.length === 0) return 0;
  const withoutTrailingNewline = source.endsWith("\n") ? source.slice(0, -1) : source;
  return withoutTrailingNewline.split("\n").length;
}

/**
 * Compute document statistics with the same text-level rules as
 * `@floatboat/nexus-plugin-wordcount`: Markdown-aware, CJK-first,
 * code-point characters. `lines` is computed on the raw source so it
 * always matches the editor's own line count.
 */
export function computeDocumentStats(source: string): DocumentStats {
  if (source.length === 0) {
    return { characters: 0, words: 0, lines: 0 };
  }

  const analysis = analyseProse(stripMarkdownNoise(source), "char");
  return {
    characters: analysis.characters,
    words: analysis.words,
    lines: countLines(source)
  };
}
