/**
 * Fuzzy matching for plugin-search (Roadmap #17).
 *
 * Implements an fzf-style subsequence matcher. The algorithm is the forward
 * DP used by fzf v2: because the gap penalty is linear in the number of
 * skipped characters, extending a partial match to position `i` only ever
 * needs two predecessor candidates per query character:
 *
 *  - the consecutive candidate (the previous matched character sits at
 *    `i - 1`), and
 *  - the running maximum of `score[t] + t` over all earlier positions `t`,
 *    which folds the gap term `-(i - t - 1)` into the position-dependent
 *    constant.
 *
 * That yields the exact O(n*m) optimum in O(m) working memory plus an
 * O(n*m) predecessor table (8 bytes per state: one Int32 score and one
 * Uint32 link) used to backtrack the matched positions of every reported
 * match. Editor documents are typically far below the size where that
 * allocation matters.
 *
 * Scoring model (fzf-inspired, simplified for prose — no path-separator
 * bias):
 *
 *  +1  per matched character
 *  +8  matched character at the document start or after a non-alphanumeric
 *      character (word boundary)
 *  +4  camelCase: previous character is lowercase, matched character is
 *      uppercase
 *  +4  consecutive: matched character immediately follows the previous
 *      matched character
 *  -1  per unmatched character between matched characters
 *
 * Bonus detection runs on the raw document characters; character equality
 * is ASCII case-folded unless the search is case-sensitive.
 */

const FUZZY_BASE = 1;
const FUZZY_WORD_START = 8;
const FUZZY_CAMEL_CASE = 4;
const FUZZY_CONSECUTIVE = 4;

const UNMATCHED = -2147483648; // Int32 minimum
const NO_PREDECESSOR = 0xffffffff;

export interface FuzzySegment {
  from: number;
  to: number;
}

export interface FuzzyMatch {
  from: number;
  to: number;
  text: string;
  score: number;
  segments: FuzzySegment[];
}

/**
 * Fold A-Z to a-z. Unlike `toLowerCase`, this never changes the string
 * length (e.g. `"İ"` lowercases to two code units), so folded positions
 * stay aligned with document positions.
 */
function foldAscii(value: string): string {
  return value.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

function isAsciiLower(c: number): boolean {
  return c >= 97 && c <= 122;
}

function isAsciiUpper(c: number): boolean {
  return c >= 65 && c <= 90;
}

function isAsciiAlphaNumeric(c: number): boolean {
  return (c >= 48 && c <= 57) || isAsciiLower(c) || isAsciiUpper(c);
}

/** Word-start / camelCase bonus for the matched character at `i`. */
function positionBonus(doc: string, i: number): number {
  if (i === 0) {
    return FUZZY_WORD_START;
  }
  const previous = doc.charCodeAt(i - 1);
  if (!isAsciiAlphaNumeric(previous)) {
    return FUZZY_WORD_START;
  }
  const current = doc.charCodeAt(i);
  if (isAsciiLower(previous) && isAsciiUpper(current)) {
    return FUZZY_CAMEL_CASE;
  }
  return 0;
}

/** Merge ascending matched positions into contiguous ranges (`to` exclusive). */
function toSegments(positions: number[]): FuzzySegment[] {
  const segments: FuzzySegment[] = [];
  let from = positions[0];
  let to = positions[0] + 1;
  for (let k = 1; k < positions.length; k++) {
    const position = positions[k];
    if (position === to) {
      to++;
    } else {
      segments.push({ from, to });
      from = position;
      to = position + 1;
    }
  }
  segments.push({ from, to });
  return segments;
}

/**
 * Find all fuzzy matches of `query` in `doc`, ranked by score descending
 * with document order as the stable tiebreak. Each match spans from its
 * first to its last matched character, and `segments` lists the exact
 * matched character ranges for precise highlighting.
 */
export function findFuzzyMatches(doc: string, query: string, caseSensitive: boolean): FuzzyMatch[] {
  if (!query || query.length > doc.length) {
    return [];
  }

  const n = doc.length;
  const m = query.length;
  const haystack = caseSensitive ? doc : foldAscii(doc);
  const needle = caseSensitive ? query : foldAscii(query);

  // score[q * n + i] = best score of a match of query[0..q] ending at
  // position i, or UNMATCHED when the character at i does not extend the
  // q-th query prefix.
  const score = new Int32Array(n * m).fill(UNMATCHED);
  // pred[q * n + i] = document position chosen for query[q - 1] by the DP
  // state (q, i); NO_PREDECESSOR for q === 0.
  const pred = new Uint32Array(n * m).fill(NO_PREDECESSOR);
  // bestWeighted[q] = max over processed positions t of score[q * n + t] + t,
  // with bestWeightedAt[q] the t that achieved it. Positions are folded into
  // these running maxima only after being finalized, so at position i they
  // cover every t < i.
  const bestWeighted = new Int32Array(m).fill(UNMATCHED);
  const bestWeightedAt = new Uint32Array(m).fill(NO_PREDECESSOR);

  // Fast membership test so positions that match no query character skip
  // the inner loop entirely; needleCodes avoids repeated charCodeAt calls.
  const present = new Uint8Array(65536);
  const needleCodes = new Uint16Array(m);
  for (let q = 0; q < m; q++) {
    const code = needle.charCodeAt(q);
    present[code] = 1;
    needleCodes[q] = code;
  }

  for (let i = 0; i < n; i++) {
    const code = haystack.charCodeAt(i);
    if (present[code] === 0) {
      continue;
    }
    const bonus = positionBonus(doc, i);

    for (let q = 0; q < m; q++) {
      if (needleCodes[q] !== code) {
        continue;
      }

      let best = UNMATCHED;
      let bestPred = NO_PREDECESSOR;

      if (q === 0) {
        best = FUZZY_BASE + bonus;
      } else {
        // Consecutive predecessor: query[q - 1] matched at i - 1.
        if (i > 0) {
          const consecutive = score[(q - 1) * n + i - 1];
          if (consecutive !== UNMATCHED) {
            best = consecutive + FUZZY_BASE + bonus + FUZZY_CONSECUTIVE;
            bestPred = i - 1;
          }
        }
        // Non-consecutive predecessors: score[t] + FUZZY_GAP_PENALTY * (i - t - 1)
        // = (score[t] + t) + (1 - i), so the running weighted maximum is the
        // only candidate needed.
        if (bestWeighted[q - 1] !== UNMATCHED) {
          const candidate = bestWeighted[q - 1] + FUZZY_BASE + bonus + 1 - i;
          if (candidate > best) {
            best = candidate;
            bestPred = bestWeightedAt[q - 1];
          }
        }
      }

      if (best !== UNMATCHED) {
        score[q * n + i] = best;
        pred[q * n + i] = bestPred;
      }
    }

    // Fold this position into the running maxima before moving on.
    for (let q = 0; q < m; q++) {
      const s = score[q * n + i];
      if (s === UNMATCHED) {
        continue;
      }
      const weighted = s + i;
      // `>=` keeps the latest position on ties: tighter spans at equal score.
      if (weighted >= bestWeighted[q]) {
        bestWeighted[q] = weighted;
        bestWeightedAt[q] = i;
      }
    }
  }

  // Backtrack one match per start position: walk each full-query end state
  // back through its predecessor links, and keep the highest-scoring match
  // for every start.
  const fullRow = (m - 1) * n;
  const byStart = new Map<number, { end: number; score: number; positions: number[] }>();
  for (let i = 0; i < n; i++) {
    const s = score[fullRow + i];
    if (s === UNMATCHED) {
      continue;
    }
    const positions = new Array<number>(m);
    positions[m - 1] = i;
    let pos = i;
    let complete = true;
    for (let q = m - 2; q >= 0; q--) {
      pos = pred[(q + 1) * n + pos];
      if (pos === NO_PREDECESSOR) {
        complete = false;
        break;
      }
      positions[q] = pos;
    }
    if (!complete) {
      continue;
    }
    const start = positions[0];
    const existing = byStart.get(start);
    // Strict `>` keeps the first-seen end on ties: the tighter span.
    if (!existing || s > existing.score) {
      byStart.set(start, { end: i, score: s, positions });
    }
  }

  const results: FuzzyMatch[] = [];
  for (const { end, score: matchScore, positions } of byStart.values()) {
    const from = positions[0];
    results.push({
      from,
      to: end + 1,
      text: doc.slice(from, end + 1),
      score: matchScore,
      segments: toSegments(positions)
    });
  }
  results.sort((a, b) => b.score - a.score || a.from - b.from);
  return results;
}
