import { SearchQuery } from "@codemirror/search";
import { EditorState, Text } from "@codemirror/state";

export interface FuzzyMatch {
  from: number;
  to: number;
  score: number;
}

export interface FuzzySearchQueryConfig {
  search: string;
  replace?: string;
  caseSensitive?: boolean;
}

const SCORE_MATCH = 16;
const SCORE_GAP_START = -3;
const SCORE_GAP_EXTENSION = -1;
const BONUS_BOUNDARY = 8;
const BONUS_NON_WORD = 8;
const BONUS_CAMEL123 = 7;
const BONUS_CONSECUTIVE = 4;
const BONUS_FIRST_CHAR_MULTIPLIER = 2;
const BONUS_BOUNDARY_WHITE = 10;
const BONUS_BOUNDARY_DELIMITER = 9;

const NO_SCORE = -0x40000000;
const MATCH_THRESHOLD = NO_SCORE / 4;
const MAX_REGION_CELLS = 1 << 20;
const MAX_LINE_CELLS = 1 << 22;

const CLASS_WHITE = 0;
const CLASS_NON_WORD = 1;
const CLASS_LOWER = 2;
const CLASS_UPPER = 3;
const CLASS_LETTER = 4;
const CLASS_NUMBER = 5;

let unitsBuf = new Uint32Array(1024);
let classBuf = new Uint8Array(1024);
let bonusBuf = new Int32Array(1024);
let scoreBuf = new Int32Array(1024);
let mPrevBuf = new Int32Array(1024);
let mCurBuf = new Int32Array(1024);
let posBuf = new Int32Array(64);

function ensureUnits(n: number): void {
  if (unitsBuf.length < n) unitsBuf = new Uint32Array(n * 2);
}

function ensureClassBonus(n: number): void {
  if (classBuf.length < n) {
    classBuf = new Uint8Array(n * 2);
    bonusBuf = new Int32Array(n * 2);
  }
}

function ensureScore(n: number): void {
  if (scoreBuf.length < n) scoreBuf = new Int32Array(n * 2);
}

function ensureM(n: number): void {
  if (mPrevBuf.length < n) {
    mPrevBuf = new Int32Array(n * 2);
    mCurBuf = new Int32Array(n * 2);
  }
}

function ensurePos(n: number): void {
  if (posBuf.length < n) posBuf = new Int32Array(n * 2);
}

function isTrailSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function isLeadSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function foldUnit(code: number): number {
  if (code >= 65 && code <= 90) return code + 32;
  if (code < 128) return code;
  const folded = String.fromCharCode(code).toLowerCase();
  return folded.length === 1 ? folded.charCodeAt(0) : code;
}

function classifyFull(codePoint: number): number {
  const char = String.fromCodePoint(codePoint);
  if (/\s/.test(char)) return CLASS_WHITE;
  if (/\p{N}/u.test(char)) return CLASS_NUMBER;
  if (/\p{L}/u.test(char)) {
    const lower = char.toLowerCase();
    const upper = char.toUpperCase();
    if (lower === upper) return CLASS_LETTER;
    if (char === lower) return CLASS_LOWER;
    if (char === upper) return CLASS_UPPER;
    return CLASS_LETTER;
  }
  return CLASS_NON_WORD;
}

function bonusFor(prevClass: number, curClass: number): number {
  if (curClass === CLASS_WHITE) return BONUS_BOUNDARY_WHITE;

  switch (curClass) {
    case CLASS_NON_WORD:
      return prevClass === CLASS_WHITE ? BONUS_BOUNDARY_WHITE : BONUS_BOUNDARY;
    case CLASS_LOWER:
    case CLASS_LETTER:
      return prevClass === CLASS_WHITE ? BONUS_BOUNDARY_WHITE : prevClass === CLASS_NON_WORD ? BONUS_BOUNDARY : 0;
    case CLASS_UPPER:
      if (prevClass === CLASS_WHITE) return BONUS_BOUNDARY_WHITE;
      if (prevClass === CLASS_NON_WORD) return BONUS_BOUNDARY;
      if (prevClass === CLASS_LOWER) return BONUS_CAMEL123;
      return 0;
    case CLASS_NUMBER:
      if (prevClass === CLASS_WHITE) return BONUS_BOUNDARY_WHITE;
      if (prevClass === CLASS_NON_WORD) return BONUS_BOUNDARY;
      if (prevClass !== CLASS_NUMBER) return BONUS_CAMEL123;
      return 0;
    default:
      return 0;
  }
}

function buildLineUnitsAndBonus(text: string, caseSensitive: boolean): void {
  const len = text.length;
  ensureUnits(len);
  ensureClassBonus(len);

  for (let i = 0; i < len; i++) {
    const code = text.charCodeAt(i);
    unitsBuf[i] = caseSensitive ? code : foldUnit(code);
  }

  let prevClass = CLASS_WHITE;
  for (let i = 0; i < len; ) {
    const code = text.charCodeAt(i);
    if (isLeadSurrogate(code) && i + 1 < len && isTrailSurrogate(text.charCodeAt(i + 1))) {
      const codePoint = 0x10000 + ((code - 0xd800) << 10) + (text.charCodeAt(i + 1) - 0xdc00);
      const cls = classifyFull(codePoint);
      classBuf[i] = cls;
      classBuf[i + 1] = cls;
      bonusBuf[i] = bonusFor(prevClass, cls);
      bonusBuf[i + 1] = 0;
      prevClass = cls;
      i += 2;
    } else {
      const cls = classifyFull(code);
      classBuf[i] = cls;
      bonusBuf[i] = bonusFor(prevClass, cls);
      prevClass = cls;
      i += 1;
    }
  }
}

function matchRegion(
  pat: Uint32Array,
  regionFrom: number,
  regionTo: number,
  lineFrom: number
): FuzzyMatch | null {
  const m = pat.length;
  const w = regionTo - regionFrom;
  if (m === 0 || w < m) return null;

  const cells = m * w;
  ensureScore(cells);
  ensureM(w);

  scoreBuf.fill(NO_SCORE, 0, cells);

  // Row 0
  for (let q = 0; q < w; q++) {
    if (pat[0] === unitsBuf[regionFrom + q]) {
      const b = bonusBuf[regionFrom + q];
      scoreBuf[q] = SCORE_MATCH + b * BONUS_FIRST_CHAR_MULTIPLIER;
    }
  }

  let carry = NO_SCORE + SCORE_GAP_START;
  for (let t = 0; t < w; t++) {
    const v = scoreBuf[t];
    const s = v === NO_SCORE ? NO_SCORE : v + SCORE_GAP_START;
    const nextCarry = carry + SCORE_GAP_EXTENSION;
    carry = s < nextCarry ? nextCarry : s;
    mPrevBuf[t] = carry;
  }

  // Remaining rows
  for (let i = 1; i < m; i++) {
    scoreBuf.fill(NO_SCORE, i * w, (i + 1) * w);

    for (let q = 0; q < w; q++) {
      if (pat[i] !== unitsBuf[regionFrom + q]) continue;

      const b = bonusBuf[regionFrom + q];
      let best = NO_SCORE;

      if (q > 0) {
        const diag = scoreBuf[(i - 1) * w + (q - 1)];
        if (diag !== NO_SCORE) {
          const cand = diag + Math.max(b, BONUS_CONSECUTIVE);
          if (cand > best) best = cand;
        }
      }

      if (q > 0) {
        const prevM = mPrevBuf[q - 1];
        if (prevM > MATCH_THRESHOLD) {
          const cand = prevM + b;
          if (cand > best) best = cand;
        }
      }

      if (best !== NO_SCORE) {
        scoreBuf[i * w + q] = SCORE_MATCH + best;
      }
    }

    carry = NO_SCORE + SCORE_GAP_START;
    for (let t = 0; t < w; t++) {
      const v = scoreBuf[i * w + t];
      const s = v === NO_SCORE ? NO_SCORE : v + SCORE_GAP_START;
      const nextCarry = carry + SCORE_GAP_EXTENSION;
      carry = s < nextCarry ? nextCarry : s;
      mCurBuf[t] = carry;
    }

    const tmp = mPrevBuf;
    mPrevBuf = mCurBuf;
    mCurBuf = tmp;
  }

  const lastRow = (m - 1) * w;
  let bestScore = NO_SCORE;
  let bestCol = -1;
  for (let q = 0; q < w; q++) {
    const v = scoreBuf[lastRow + q];
    if (v > bestScore) {
      bestScore = v;
      bestCol = q;
    }
  }

  if (bestScore <= MATCH_THRESHOLD) return null;

  ensurePos(m);
  let col = bestCol;
  let cur = scoreBuf[lastRow + col];
  let i = m - 1;

  while (i > 0) {
    const b = bonusBuf[regionFrom + col];
    const expected = cur - SCORE_MATCH;

    const diag = col > 0 ? scoreBuf[(i - 1) * w + (col - 1)] : NO_SCORE;
    if (diag !== NO_SCORE && expected === diag + Math.max(b, BONUS_CONSECUTIVE)) {
      posBuf[i] = col;
      col -= 1;
      cur = diag;
      i -= 1;
      continue;
    }

    let found = false;
    for (let p = 0; p <= col - 2; p++) {
      const h = scoreBuf[(i - 1) * w + p];
      if (h === NO_SCORE) continue;
      const gapLen = col - 1 - p;
      if (expected === h + SCORE_GAP_START + gapLen * SCORE_GAP_EXTENSION + b) {
        posBuf[i] = col;
        col = p;
        cur = h;
        i -= 1;
        found = true;
        break;
      }
    }

    if (!found) return null;
  }
  posBuf[0] = col;

  return {
    from: lineFrom + regionFrom + posBuf[0],
    to: lineFrom + regionFrom + posBuf[m - 1] + 1,
    score: bestScore
  };
}

function matchRegionGreedy(
  pat: Uint32Array,
  regionFrom: number,
  regionTo: number,
  lineFrom: number
): FuzzyMatch | null {
  let start = -1;
  let end = -1;
  let p = 0;

  for (let q = regionFrom; q < regionTo && p < pat.length; q++) {
    if (pat[p] === unitsBuf[q]) {
      if (p === 0) start = q;
      end = q;
      p++;
    }
  }

  if (p < pat.length) return null;

  return {
    from: lineFrom + start,
    to: lineFrom + end + 1,
    score: 0
  };
}

interface WorkRegion {
  from: number;
  to: number;
  budget: number;
}

function findLineMatches(
  text: string,
  pat: Uint32Array,
  caseSensitive: boolean,
  lineFrom: number
): FuzzyMatch[] {
  const m = pat.length;
  if (m === 0) return [];

  buildLineUnitsAndBonus(text, caseSensitive);
  const len = text.length;

  const work: WorkRegion[] = [{ from: 0, to: len, budget: MAX_REGION_CELLS }];
  const matches: FuzzyMatch[] = [];
  let lineCellsUsed = 0;

  while (work.length) {
    const { from, to, budget } = work.pop()!;
    if (from >= to) continue;

    const w = to - from;
    const cells = m * w;

    if (cells > budget || lineCellsUsed + cells > MAX_LINE_CELLS) {
      const g = matchRegionGreedy(pat, from, to, lineFrom);
      if (g) matches.push(g);
      continue;
    }

    lineCellsUsed += cells;
    const match = matchRegion(pat, from, to, lineFrom);
    if (!match || match.score <= MATCH_THRESHOLD) continue;

    matches.push(match);
    work.push({ from: match.to - lineFrom, to, budget });
    work.push({ from, to: match.from - lineFrom, budget });
  }

  matches.sort((a, b) => a.from - b.from || a.to - b.to);
  return matches;
}

function* iterateFuzzyMatches(
  pat: Uint32Array,
  doc: Text,
  from: number,
  to: number,
  caseSensitive: boolean
): Generator<FuzzyMatch> {
  if (from >= to) return;
  from = Math.max(0, from);
  to = Math.min(doc.length, to);

  let pos = from;
  while (pos <= to) {
    const line = doc.lineAt(pos);
    const lineText = doc.sliceString(line.from, Math.min(line.to, to));
    const matches = findLineMatches(lineText, pat, caseSensitive, line.from);

    for (const match of matches) {
      if (match.from >= to) return;
      if (match.to > to) continue;
      if (match.from < from) continue;
      yield match;
    }

    if (line.to >= doc.length || line.to >= to) break;
    pos = line.to + 1;
  }
}

function compileFuzzyPattern(search: string, caseSensitive: boolean): Uint32Array | null {
  if (!search) return null;
  const pat = new Uint32Array(search.length);
  for (let i = 0; i < search.length; i++) {
    const code = search.charCodeAt(i);
    pat[i] = caseSensitive ? code : foldUnit(code);
  }
  return pat;
}

function unquoteSearch(text: string): string {
  return text.replace(/\\([nrt\\])/g, (_, ch: string) => {
    if (ch === "n") return "\n";
    if (ch === "r") return "\r";
    if (ch === "t") return "\t";
    return "\\";
  });
}

export class FuzzySearchQuery extends SearchQuery {
  constructor(config: FuzzySearchQueryConfig) {
    super({ search: config.search, replace: config.replace, caseSensitive: config.caseSensitive });
  }

  override eq(other: SearchQuery): boolean {
    return other instanceof FuzzySearchQuery && super.eq(other);
  }

  override getCursor(state: EditorState | Text, from = 0, to?: number): Iterator<FuzzyMatch> {
    const doc = "doc" in state ? state.doc : state;
    const end = to ?? doc.length;
    const pat = compileFuzzyPattern(this.search, this.caseSensitive);
    if (!pat) return emptyCursor();
    return iterateFuzzyMatches(pat, doc, from, end, this.caseSensitive);
  }

  unquote(text: string): string {
    return unquoteSearch(text);
  }

  /** @internal */
  create(): FuzzyQuery {
    return new FuzzyQuery(this);
  }
}

function* emptyCursor(): Generator<FuzzyMatch> {
  return undefined;
}

export function findFuzzyMatches(doc: string, pattern: string, caseSensitive = false): FuzzyMatch[] {
  const pat = compileFuzzyPattern(pattern, caseSensitive);
  if (!pat) return [];
  const text = Text.of([doc]);
  const matches: FuzzyMatch[] = [];
  for (const match of iterateFuzzyMatches(pat, text, 0, text.length, caseSensitive)) {
    matches.push(match);
  }
  return matches;
}

export function replaceFuzzyMatches(
  doc: string,
  pattern: string,
  replacement: string,
  caseSensitive = false
): string {
  const pat = compileFuzzyPattern(pattern, caseSensitive);
  if (!pat) return doc;

  const query = new FuzzySearchQuery({ search: pattern, replace: replacement, caseSensitive });
  const all = new FuzzyQuery(query).matchAll(Text.of([doc]), Number.MAX_SAFE_INTEGER);
  if (!all || all.length === 0) return doc;

  const repl = query.unquote(replacement);
  all.sort((a, b) => b.from - a.from);
  let result = doc;
  for (const match of all) {
    result = result.slice(0, match.from) + repl + result.slice(match.to);
  }
  return result;
}

class FuzzyQuery {
  private readonly pattern: Uint32Array | null;

  constructor(private readonly spec: FuzzySearchQuery) {
    this.pattern = compileFuzzyPattern(spec.search, spec.caseSensitive);
  }

  nextMatch(state: EditorState | Text, curFrom: number, curTo: number): { from: number; to: number } | null {
    const doc = "doc" in state ? state.doc : state;
    if (!this.pattern) return null;

    const after = this.matchesIn(state, curTo, doc.length);
    if (after.length) return after[0];

    const wrapEnd = Math.min(doc.length, curFrom + this.spec.search.length);
    const wrap = this.matchesIn(state, 0, wrapEnd);
    const first = wrap[0];
    if (first && (first.from !== curFrom || first.to !== curTo)) return first;
    return null;
  }

  prevMatch(state: EditorState | Text, curFrom: number, curTo: number): { from: number; to: number } | null {
    const doc = "doc" in state ? state.doc : state;
    if (!this.pattern) return null;

    const before = this.matchesIn(state, 0, curFrom);
    if (before.length) return before[before.length - 1];

    const wrapStart = Math.max(0, curTo - this.spec.search.length);
    const wrap = this.matchesIn(state, wrapStart, doc.length);
    const last = wrap[wrap.length - 1];
    if (last && (last.from !== curFrom || last.to !== curTo)) return last;
    return null;
  }

  matchAll(state: EditorState | Text, limit: number): { from: number; to: number }[] | null {
    const doc = "doc" in state ? state.doc : state;
    const all = this.matchesIn(state, 0, doc.length);
    if (all.length > limit) return null;
    return all;
  }

  highlight(
    state: EditorState | Text,
    from: number,
    to: number,
    add: (from: number, to: number) => void
  ): void {
    const doc = "doc" in state ? state.doc : state;
    if (!this.pattern) return;

    const startLine = doc.lineAt(from);
    const endLine = doc.lineAt(to);

    for (let line = startLine; ; line = doc.line(line.number + 1)) {
      const matches = findLineMatches(
        doc.sliceString(line.from, line.to),
        this.pattern,
        this.spec.caseSensitive,
        line.from
      );
      for (const match of matches) {
        if (match.to > to) continue;
        if (match.from < from) continue;
        add(match.from, match.to);
      }
      if (line.number >= endLine.number || line.to >= doc.length) break;
    }
  }

  getReplacement(_result: { from: number; to: number }): string {
    return this.spec.unquote(this.spec.replace);
  }

  private matchesIn(state: EditorState | Text, from: number, to: number): { from: number; to: number }[] {
    const doc = "doc" in state ? state.doc : state;
    if (!this.pattern) return [];
    const matches: { from: number; to: number }[] = [];
    for (const match of iterateFuzzyMatches(this.pattern, doc, from, to, this.spec.caseSensitive)) {
      matches.push(match);
    }
    return matches;
  }
}
