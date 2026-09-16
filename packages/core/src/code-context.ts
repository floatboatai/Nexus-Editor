/**
 * Locate Markdown code contexts — fenced code blocks and inline code spans — as
 * absolute `[from, to)` spans.
 *
 * Wiki-link scanning is a text-level operation. Three of its four call sites
 * (the demo's vault link index, the plugin content runtime, and the wiki-link
 * decoration builder) only ever hold a raw Markdown string, so the mdast is not
 * available to them. This module answers the one question those callers need —
 * "does this offset sit inside code?" — without a parser, and without pulling a
 * parse into the keystroke and vault-indexing paths.
 *
 * It is deliberately NOT exported from the package entry point: the parsing of
 * fenced blocks and code spans is an implementation detail of wiki-link
 * scanning, not a public capability.
 *
 * CommonMark rules implemented (see "Fenced code blocks" §4.5 and "Code spans"
 * §6.2):
 *   - An opening fence is up to three leading spaces followed by a run of three
 *     or more backticks or tildes. A backtick fence's info string may not
 *     itself contain a backtick.
 *   - A closing fence is up to three leading spaces, the same fence character,
 *     a run at least as long as the opener, and nothing else but spaces.
 *   - An unterminated fence runs to the end of the document.
 *   - A code span opens with a backtick run and closes with the next backtick
 *     run of *exactly* the same length; an unmatched run stays literal.
 *   - A code span may cross a line break but not a blank line, which ends the
 *     paragraph that contains it.
 *   - Backticks inside a fenced block are literal; code spans are only
 *     searched outside fenced blocks.
 */

/** Three or more backticks or tildes, indented by at most three spaces. */
const FENCE_OPEN_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

function isUnterminatedFenceBody(fenceChar: string, info: string): boolean {
  // A backtick fence cannot carry a backtick in its info string; such a line is
  // an inline code span, not a fence opener.
  return fenceChar === "`" && info.includes("`");
}

/** `[from, to)` of the line beginning at `start`, excluding its newline. */
function lineSpanAt(doc: string, start: number): { from: number; to: number; next: number } {
  const newline = doc.indexOf("\n", start);
  if (newline === -1) return { from: start, to: doc.length, next: doc.length };
  return { from: start, to: newline, next: newline + 1 };
}

function findFencedBlocks(doc: string): Array<readonly [number, number]> {
  const blocks: Array<readonly [number, number]> = [];
  let cursor = 0;

  while (cursor < doc.length) {
    const line = lineSpanAt(doc, cursor);
    const open = FENCE_OPEN_RE.exec(doc.slice(line.from, line.to));

    if (!open || isUnterminatedFenceBody(open[2][0], open[3])) {
      cursor = line.next;
      continue;
    }

    const fenceChar = open[2][0];
    const fenceLength = open[2].length;
    const closeRe = new RegExp(`^ {0,3}\\${fenceChar}{${fenceLength},}[ \\t]*$`);

    let scan = line.next;
    let blockEnd = doc.length;
    while (scan < doc.length) {
      const candidate = lineSpanAt(doc, scan);
      if (closeRe.test(doc.slice(candidate.from, candidate.to))) {
        blockEnd = candidate.to;
        break;
      }
      scan = candidate.next;
    }

    // Start after the fence's own indentation, matching the mdast `code` node.
    blocks.push([line.from + open[1].length, blockEnd]);
    cursor = blockEnd < doc.length ? blockEnd + 1 : doc.length;
  }

  return blocks;
}

function findCodeSpansIn(doc: string, regionFrom: number, regionTo: number): Array<readonly [number, number]> {
  const spans: Array<readonly [number, number]> = [];
  let cursor = regionFrom;

  while (cursor < regionTo) {
    const opening = doc.indexOf("`", cursor);
    if (opening === -1 || opening >= regionTo) break;

    let openRun = 0;
    while (opening + openRun < regionTo && doc[opening + openRun] === "`") openRun += 1;

    let scan = opening + openRun;
    let closing = -1;
    while (scan < regionTo) {
      const next = doc.indexOf("`", scan);
      if (next === -1 || next >= regionTo) break;

      let run = 0;
      while (next + run < regionTo && doc[next + run] === "`") run += 1;
      if (run === openRun) {
        closing = next;
        break;
      }
      scan = next + run;
    }

    if (closing === -1) {
      // No run of equal length closes this one — the backticks stay literal.
      cursor = opening + openRun;
      continue;
    }

    const spanEnd = closing + openRun;
    // A blank line ends the paragraph, so it also ends any code span in it.
    if (/\n[ \t]*\n/.test(doc.slice(opening + openRun, closing))) {
      cursor = spanEnd;
      continue;
    }

    spans.push([opening, spanEnd]);
    cursor = spanEnd;
  }

  return spans;
}

/**
 * Absolute `[from, to)` spans covering every fenced code block and inline code
 * span in `doc`. Spans are non-overlapping and ordered by `from`.
 *
 * Callers use this to decide whether a text match found elsewhere is literal
 * code rather than live syntax.
 */
export function findCodeContextSpans(doc: string): ReadonlyArray<readonly [number, number]> {
  const blocks = findFencedBlocks(doc);
  const spans: Array<readonly [number, number]> = [];

  let cursor = 0;
  for (const [blockFrom, blockTo] of blocks) {
    spans.push([blockFrom, blockTo]);
    if (blockFrom > cursor) spans.push(...findCodeSpansIn(doc, cursor, blockFrom));
    cursor = blockTo;
  }
  if (cursor < doc.length) spans.push(...findCodeSpansIn(doc, cursor, doc.length));

  spans.sort((left, right) => left[0] - right[0]);
  return spans;
}

/** True when `[from, to)` overlaps any span in `spans`. */
export function overlapsSpan(
  from: number,
  to: number,
  spans: ReadonlyArray<readonly [number, number]>
): boolean {
  return spans.some(([spanFrom, spanTo]) => from < spanTo && spanFrom < to);
}
