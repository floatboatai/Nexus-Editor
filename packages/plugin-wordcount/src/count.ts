/**
 * Markdown-aware word, character, and reading-time statistics.
 *
 * The pure-function entry point of `@floatboat/nexus-plugin-wordcount`.
 * Accepts either raw Markdown source or a pre-parsed mdast `Root` —
 * when used through the plugin, the editor's existing AST is reused
 * so we never pay the parse cost twice.
 */

import type { Root, RootContent } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

import type { ParserLike } from "@floatboat/nexus-core";

/** Mdast node types that contribute prose by default. */
const DEFAULT_EXCLUDE: ReadonlyArray<string> = [
  "code",
  "inlineCode",
  "math",
  "inlineMath",
  "html",
  "yaml",
  "toml",
  "definition",
  "footnoteDefinition"
];

/** Reading-speed defaults — overridable via {@link WordCountOptions.readingSpeed}. */
const DEFAULT_WPM = 238;
const DEFAULT_CPM = 500;

/** Per-character vs. per-run treatment for CJK scripts. */
export type CjkUnit = "char" | "word";

export interface ReadingSpeed {
  /** Words per minute for Latin / Cyrillic / Greek / numeric runs. */
  wpm?: number;
  /** Characters per minute for CJK scripts. */
  cpm?: number;
}

export interface WordCountOptions {
  /**
   * Pre-parsed mdast `Root`. When supplied, the function reuses it and
   * skips the lazy unified pipeline — pass this from inside an editor
   * plugin to avoid double-parsing on every keystroke.
   */
  ast?: Root;
  /**
   * Node types whose text content should NOT contribute to counts.
   * Defaults to a sensible Markdown-aware list (code, math, HTML,
   * frontmatter, definitions). Pass an explicit array to override —
   * the default is NOT merged. Pass `[]` to count everything.
   */
  exclude?: ReadonlyArray<string>;
  /**
   * Whether CJK ideographs / syllables count per character (the
   * Notion / Obsidian / Bear convention, default) or per run
   * (Microsoft Word pre-2007 behaviour).
   */
  cjkUnit?: CjkUnit;
  /** Override the reading-speed model. */
  readingSpeed?: ReadingSpeed;
  /**
   * Optional parser injection. The plugin already wires this so the
   * editor's parser is reused when present; standalone callers can
   * leave it undefined and a lazy unified pipeline is constructed
   * on first use.
   */
  parser?: ParserLike;
}

export interface WordCountStats {
  /** Total words (Latin runs + numeric runs + CJK contribution). */
  words: number;
  /** Latin / Cyrillic / Greek / etc. word runs (excludes CJK). */
  latinWords: number;
  /** Raw CJK character count regardless of `cjkUnit`. */
  cjkCharacters: number;
  /** Total Unicode characters of *prose* text (post-strip). */
  characters: number;
  /** `characters` minus any whitespace runs. */
  charactersNoSpaces: number;
  /** Newline-delimited lines in the raw source (empty trailing line excluded). */
  lines: number;
  /** Number of mdast `paragraph` nodes that survived the exclude filter. */
  paragraphs: number;
  /** Heuristic sentence count via `[.!?。！？]+(\s|$)`. */
  sentences: number;
  /** Estimated silent-reading time, ceiling-rounded to whole seconds. */
  readingTimeSeconds: number;
}

const EMPTY_STATS: WordCountStats = Object.freeze({
  words: 0,
  latinWords: 0,
  cjkCharacters: 0,
  characters: 0,
  charactersNoSpaces: 0,
  lines: 0,
  paragraphs: 0,
  sentences: 0,
  readingTimeSeconds: 0
});

/**
 * Lazy-instantiated unified pipeline. Only constructed when a caller
 * passes raw source without an `ast` — the editor plugin always passes
 * the editor's AST, so this never runs in the hot path of typing.
 */
let lazyParser: ParserLike | null = null;
function ensureLazyParser(): ParserLike {
  if (lazyParser) return lazyParser;
  // Static imports happen at module load; we instantiate the pipeline
  // here on first demand so callers that always pass `ast` don't pay
  // the configure cost.
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkFrontmatter, ["yaml", "toml"]);
  lazyParser = {
    parse(markdown: string) {
      return processor.parse(markdown) as Root;
    }
  };
  return lazyParser;
}

/**
 * Compute Markdown-aware statistics for `source`.
 *
 * Hot path (plugin): pass `options.ast` from `editor.getAst()` — no
 * parse occurs, walk runs in linear time over the existing tree.
 *
 * Cold path (standalone): if no `ast` is supplied, a lazy unified
 * pipeline (remark-parse + remark-gfm + remark-math + remark-frontmatter)
 * is instantiated on first use and reused thereafter. On parse failure
 * the function falls back to a naive whitespace counter so the API
 * contract "never throws, always returns stats" holds.
 */
export function countMarkdown(source: string, options: WordCountOptions = {}): WordCountStats {
  if (source.length === 0) {
    return { ...EMPTY_STATS };
  }

  if (options.ast) {
    return computeFromAst(source, options.ast, options);
  }

  const parser = options.parser ?? ensureLazyParser();
  try {
    const ast = parser.parse(source);
    return computeFromAst(source, ast, options);
  } catch {
    return computeFromPlainText(source, options);
  }
}

/**
 * Async alias of {@link countMarkdown}. Provided for symmetry with
 * codebases that prefer to await all heavy computations; the
 * implementation is synchronous internally.
 */
export async function countMarkdownAsync(
  source: string,
  options: WordCountOptions = {}
): Promise<WordCountStats> {
  return countMarkdown(source, options);
}

interface ProseSegment {
  text: string;
  /** True for the synthetic `\n\n` separator between prose blocks. */
  isParagraphBreak: boolean;
}

function computeFromAst(source: string, ast: Root, options: WordCountOptions): WordCountStats {
  const exclude = new Set(options.exclude ?? DEFAULT_EXCLUDE);
  const cjkUnit = options.cjkUnit ?? "char";

  const segments: ProseSegment[] = [];
  let paragraphs = 0;

  const visit = (node: RootContent | Root): void => {
    const type = (node as { type: string }).type;
    if (exclude.has(type)) return;

    switch (type) {
      case "text":
      case "inlineCode":
      case "code": {
        // `inlineCode` / `code` only reach this branch when callers
        // opted them in via an explicit `exclude` override.
        const value = (node as { value?: string }).value ?? "";
        if (value) segments.push({ text: value, isParagraphBreak: false });
        return;
      }
      case "image":
      case "imageReference": {
        const alt = (node as { alt?: string }).alt;
        if (alt) segments.push({ text: alt, isParagraphBreak: false });
        return;
      }
      case "link":
      case "linkReference":
      case "emphasis":
      case "strong":
      case "delete":
      case "footnote":
      case "footnoteReference":
      case "paragraph":
      case "heading":
      case "listItem":
      case "list":
      case "blockquote":
      case "tableRow":
      case "tableCell":
      case "table":
      case "root": {
        if (type === "paragraph") paragraphs += 1;
        const children = (node as { children?: RootContent[] }).children;
        if (children) {
          for (const child of children) visit(child);
        }
        if (type === "paragraph" || type === "heading" || type === "listItem") {
          segments.push({ text: "", isParagraphBreak: true });
        }
        return;
      }
      default: {
        // Unknown node type — descend if there are children, otherwise
        // collect a `value` if present. This keeps us forward-compatible
        // with remark plugins that introduce custom node types.
        const children = (node as { children?: RootContent[] }).children;
        if (children) {
          for (const child of children) visit(child);
          return;
        }
        const value = (node as { value?: string }).value;
        if (typeof value === "string" && value) {
          segments.push({ text: value, isParagraphBreak: false });
        }
      }
    }
  };

  visit(ast);

  // Strip trailing whitespace introduced by the synthetic paragraph
  // breaks pushed after each block-level container, otherwise a single
  // paragraph reports 2 extra characters than the source text.
  const prose = segments
    .map((segment) => (segment.isParagraphBreak ? "\n\n" : segment.text))
    .join("")
    .replace(/[\s\u00A0]+$/, "");

  const wordStats = analyseProse(prose, cjkUnit);
  const sentences = countSentences(prose);
  const lines = countLines(source);
  const readingTimeSeconds = computeReadingTime(wordStats.latinWords, wordStats.cjkCharacters, options.readingSpeed);

  return {
    words: wordStats.words,
    latinWords: wordStats.latinWords,
    cjkCharacters: wordStats.cjkCharacters,
    characters: wordStats.characters,
    charactersNoSpaces: wordStats.charactersNoSpaces,
    lines,
    paragraphs,
    sentences,
    readingTimeSeconds
  };
}

function computeFromPlainText(source: string, options: WordCountOptions): WordCountStats {
  const cjkUnit = options.cjkUnit ?? "char";
  // Best-effort strip of common markdown noise so the fallback isn't
  // wildly off when the caller couldn't supply an AST.
  const stripped = source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/^---\n[\s\S]*?\n---\n?/m, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\$[^$\n]+\$/g, " ")
    .replace(/^\[[^\]]+\]:[^\n]*$/gm, " ");

  const wordStats = analyseProse(stripped, cjkUnit);
  const sentences = countSentences(stripped);
  const lines = countLines(source);
  const readingTimeSeconds = computeReadingTime(wordStats.latinWords, wordStats.cjkCharacters, options.readingSpeed);
  const paragraphs = stripped
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0).length;

  return {
    words: wordStats.words,
    latinWords: wordStats.latinWords,
    cjkCharacters: wordStats.cjkCharacters,
    characters: wordStats.characters,
    charactersNoSpaces: wordStats.charactersNoSpaces,
    lines,
    paragraphs,
    sentences,
    readingTimeSeconds
  };
}

interface ProseAnalysis {
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

function analyseProse(text: string, cjkUnit: CjkUnit): ProseAnalysis {
  if (text.length === 0) {
    return { words: 0, latinWords: 0, cjkCharacters: 0, characters: 0, charactersNoSpaces: 0 };
  }

  // Count CJK first so we can subtract its characters from the Latin
  // pass — otherwise a Han ideograph would be matched as a one-letter
  // Latin "word" by `\p{L}`.
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

function countWhitespaceCodePoints(text: string): number {
  let count = 0;
  for (const run of text.match(WHITESPACE_REGEX) ?? []) {
    count += [...run].length;
  }
  return count;
}

const SENTENCE_TERMINATOR_REGEX = /[.!?。！？]+/gu;

function countSentences(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  const matches = trimmed.match(SENTENCE_TERMINATOR_REGEX);
  if (matches && matches.length > 0) return matches.length;
  // No terminator found — any non-empty prose still counts as one
  // sentence (a heading "Introduction", a single fragment, etc.).
  return 1;
}

function countLines(source: string): number {
  if (source.length === 0) return 0;
  // Match Codemirror's `state.doc.lines` convention: trailing newline
  // does NOT add an empty line.
  const withoutTrailingNewline = source.endsWith("\n") ? source.slice(0, -1) : source;
  return withoutTrailingNewline.split("\n").length;
}

function computeReadingTime(latinWords: number, cjkCharacters: number, speed: ReadingSpeed | undefined): number {
  const wpm = speed?.wpm ?? DEFAULT_WPM;
  const cpm = speed?.cpm ?? DEFAULT_CPM;
  if (latinWords === 0 && cjkCharacters === 0) return 0;
  const latinSeconds = wpm > 0 ? (latinWords / wpm) * 60 : 0;
  const cjkSeconds = cpm > 0 ? (cjkCharacters / cpm) * 60 : 0;
  const total = latinSeconds + cjkSeconds;
  if (total <= 0) return 0;
  return Math.max(1, Math.ceil(total));
}
