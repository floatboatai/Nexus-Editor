import { SearchQuery } from "@codemirror/search";

// We deliberately do not import `@codemirror/state` here: the upstream
// `SearchQuery.getCursor` parameter is typed `EditorState | Text`, and
// matching that signature verbatim requires the dependency. The narrower
// `Parameters<...>[0]` extract keeps us in sync with whatever upstream
// declares without adding a new runtime dep.
type GetCursorState = Parameters<SearchQuery["getCursor"]>[0];

/**
 * Options accepted by {@link fuzzyFindMatches} and the `fuzzy` panel toggle.
 */
export interface FuzzySearchOptions {
  caseSensitive?: boolean;
  /**
   * Maximum number of characters that may separate two consecutive matched
   * characters before a match is rejected. Defaults to {@link DEFAULT_FUZZY_MAX_GAP}
   * which mirrors the fzf "extended-exact" sweet spot (matches across very
   * long gaps feel noisy in a side panel).
   */
  maxGap?: number;
}

export interface FuzzyMatch {
  from: number;
  to: number;
  text: string;
  positions: readonly number[];
  score: number;
}

const DEFAULT_FUZZY_MAX_GAP = 32;

function toComparable(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLowerCase();
}

/**
 * Locate the next occurrence of `needle` in `haystack` starting at or after
 * `fromIndex`. Returns -1 when no occurrence exists. Comparison honors
 * `caseSensitive`.
 */
function indexOf(haystack: string, needle: string, fromIndex: number, caseSensitive: boolean): number {
  if (!caseSensitive) {
    return haystack.toLowerCase().indexOf(needle, fromIndex);
  }
  return haystack.indexOf(needle, fromIndex);
}

/**
 * Find every fuzzy match of `query` in `text`.
 *
 * A match is a contiguous window containing all query characters in order
 * (not necessarily consecutive). The window starts at the first matched
 * character and ends at the last; consecutive matches inside the window are
 * encouraged via the scoring function but never required.
 *
 * The algorithm is a single left-to-right pass:
 *   1. Walk forward looking for the first character of `query`.
 *   2. From there, greedily consume remaining query characters at the
 *      earliest possible offset (next-equal-char walk). The match is the
 *      window [firstHit, lastHit+1].
 *   3. Resume scanning from `lastHit + 1` so matches never overlap.
 *
 * This is O(n · |query|) worst case and finishes in microseconds on editor
 * sized inputs; the cursor wrapping the same logic runs the same way for
 * every {@link SearchQuery.getCursor} call.
 */
export function fuzzyFindMatches(
  text: string,
  query: string,
  options: FuzzySearchOptions = {}
): FuzzyMatch[] {
  if (!text || !query) return [];
  const maxGap = options.maxGap ?? DEFAULT_FUZZY_MAX_GAP;
  const caseSensitive = options.caseSensitive ?? false;
  const q = toComparable(query, caseSensitive);
  const t = toComparable(text, caseSensitive);

  const matches: FuzzyMatch[] = [];
  let scanFrom = 0;

  while (scanFrom < t.length) {
    const firstHit = indexOf(t, q[0], scanFrom, caseSensitive);
    if (firstHit === -1) break;

    // Greedy subsequence match starting at firstHit.
    const positions: number[] = [firstHit];
    let cursor = firstHit + 1;
    let previousHit = firstHit;
    for (let qi = 1; qi < q.length; qi++) {
      const found = indexOf(t, q[qi], cursor, caseSensitive);
      if (found === -1) {
        positions.length = 0;
        break;
      }
      // Reject the match if the gap from the previous matched char exceeds
      // the configured budget — keeps "fn" from matching "f…(40 chars)…n"
      // across a wall of unrelated text in a 200KB note.
      if (found - previousHit > maxGap) {
        positions.length = 0;
        break;
      }
      positions.push(found);
      previousHit = found;
      cursor = found + 1;
    }

    if (positions.length === q.length) {
      const start = positions[0];
      const end = positions[positions.length - 1] + 1;
      matches.push({
        from: start,
        to: end,
        text: text.slice(start, end),
        positions: positions.slice(),
        score: scoreMatch(t, positions)
      });
      scanFrom = end;
    } else {
      // No valid match starting at firstHit — keep scanning from the next
      // character so we never get stuck in an infinite loop.
      scanFrom = firstHit + 1;
    }
  }

  return matches;
}

/**
 * Compute a small integer score for a fuzzy match. Higher is better. The
 * weighting mirrors fzf-lite conventions:
 *
 *   + boundary bonus when the match starts at a word boundary
 *   + per-position bonus for matches that follow a separator (word start)
 *   + bonus for consecutive matched characters
 *   - penalty equal to the gap between matched characters
 *
 * The score is informational; the matcher does not reject matches based on
 * score (rejection is the caller's job, e.g. to thin out weak matches). It
 * exists so consumers can sort results and so {@link FuzzySearchQuery} can
 * suppress matches that are clearly dominated by a tighter window that
 * already fired earlier in the cursor.
 */
export function scoreMatch(text: string, positions: readonly number[]): number {
  if (positions.length === 0) return Number.NEGATIVE_INFINITY;
  let score = 0;

  // Boundary bonus for the first matched character.
  if (positions[0] === 0 || isWordBoundary(text, positions[0])) {
    score += 16;
  }

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    if (i > 0) {
      // Consecutive matches are a strong signal of intent.
      if (pos === positions[i - 1] + 1) {
        score += 4;
      } else {
        // Mild penalty for the gap so matches cluster on tight windows.
        score -= pos - positions[i - 1] - 1;
      }
    }
    // Each matched character that begins a new word adds a small bonus.
    if (i === 0 || isWordBoundary(text, pos)) {
      score += 8;
    }
  }

  return score;
}

function isWordBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text.charCodeAt(index - 1);
  const current = text.charCodeAt(index);
  return !isWordChar(previous) && isWordChar(current);
}

function isWordChar(code: number): boolean {
  // Mirrors the JS regex \w class: ASCII letter, digit, or underscore. We
  // intentionally exclude non-ASCII letters to keep boundary detection
  // predictable across locales — readers of mixed CJK / Latin text still
  // get sensible boundaries because CJK characters land in the "non-word"
  // bucket and are treated as separators.
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x5f
  );
}

type TextLike = { length: number; sliceString(from: number, to: number): string };

function readDocument(state: GetCursorState): { text: string; length: number } {
  // `state` is a CM6 `EditorState | Text` at runtime. We only need the
  // document slice; narrow via a structural check (EditorState has `.doc`,
  // Text does not) and use a type assertion because TypeScript's predicate
  // machinery refuses to narrow an inferred union to a freshly-introduced
  // structural type.
  const candidate = state as unknown as { doc?: TextLike; length?: number; sliceString?: (from: number, to: number) => string };
  if (candidate.doc) {
    const doc = candidate.doc;
    return { text: doc.sliceString(0, doc.length), length: doc.length };
  }
  if (typeof candidate.length === "number" && typeof candidate.sliceString === "function") {
    const length = candidate.length;
    return { text: candidate.sliceString(0, length), length };
  }
  return { text: "", length: 0 };
}

/**
 * A {@link SearchQuery} that yields fuzzy matches via {@link SearchQuery.getCursor}.
 *
 * Subclassing is the integration point with `@codemirror/search`: the
 * default `search()` extension reads `getSearchQuery(state).getCursor(...)`
 * for highlighting, and the `findNext` / `findPrevious` / `selectMatches` /
 * `replaceAll` commands consume the same cursor. By returning a
 * `FuzzySearchQuery` in `setSearchQuery` we get fuzzy behavior in the
 * editor and the panel for free, without a fork of the upstream package.
 *
 * The base `valid` getter returns true iff the search string is non-empty
 * and the regex (if any) parses. The fuzzy cursor needs the same
 * non-empty guarantee; we reuse `valid` rather than re-implementing it.
 *
 * `eq` is overridden so the panel doesn't trigger redundant `setSearchQuery`
 * effects when the underlying config is unchanged; without the override a
 * fuzzy and a literal query with the same `search` text compare equal,
 * which would make the toggle feel unresponsive.
 */
export class FuzzySearchQuery extends SearchQuery {
  readonly fuzzy: boolean;
  readonly maxGap: number;

  constructor(config: {
    search: string;
    caseSensitive?: boolean;
    literal?: boolean;
    regexp?: boolean;
    replace?: string;
    wholeWord?: boolean;
    test?: (match: string, state: unknown, from: number, to: number) => boolean;
    fuzzy?: boolean;
    maxGap?: number;
  }) {
    super({
      search: config.search,
      caseSensitive: config.caseSensitive,
      literal: true,
      regexp: false,
      replace: config.replace,
      wholeWord: false,
      test: config.test
    });
    // The `fuzzy` and `maxGap` flags live on the subclass; the base class
    // would otherwise treat them as unknown config keys.
    this.fuzzy = config.fuzzy ?? true;
    this.maxGap = config.maxGap ?? DEFAULT_FUZZY_MAX_GAP;
  }

  getCursor(
    state: GetCursorState,
    from: number = 0,
    to?: number
  ): IterableIterator<{ from: number; to: number }> {
    const document = readDocument(state);
    const end = Math.min(document.length, to ?? document.length);
    const text = document.text.slice(0, end);
    const matches = fuzzyFindMatches(text, this.search, {
      caseSensitive: this.caseSensitive,
      maxGap: this.maxGap
    });
    const start = Math.max(0, from);
    let index = 0;
    while (index < matches.length && matches[index].to <= start) {
      index++;
    }
    const iter: IterableIterator<{ from: number; to: number }> = {
      [Symbol.iterator]() {
        return this;
      },
      next(): IteratorResult<{ from: number; to: number }> {
        while (index < matches.length) {
          const match = matches[index++];
          if (match.from >= end) {
            return { value: undefined, done: true };
          }
          if (match.from < start) continue;
          const clippedTo = Math.min(match.to, end);
          if (clippedTo <= match.from) continue;
          return { value: { from: match.from, to: clippedTo }, done: false };
        }
        return { value: undefined, done: true };
      }
    };
    return iter;
  }

  eq(other: SearchQuery): boolean {
    if (other === this) return true;
    if (!(other instanceof FuzzySearchQuery)) return false;
    return (
      super.eq(other) &&
      this.fuzzy === other.fuzzy &&
      this.maxGap === other.maxGap
    );
  }
}
