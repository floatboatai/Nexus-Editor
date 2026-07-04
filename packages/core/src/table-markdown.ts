// Pure GFM table-source transforms shared by the live-preview table widget's
// structural edits (column move / delete / append, range clear). No DOM or
// editor state so they can be unit-tested in isolation.
//
// GFM lets a row omit its leading and/or trailing pipe and lets rows carry
// different cell counts ("ragged" tables). Splitting on "|" and slicing off the
// ends drops the first/last cell of such rows and misaligns the header against
// the data. Every transform here parses cells GFM-consistently, pads each row
// to the table's widest row before editing, and re-serializes the touched rows
// in canonical (leading + trailing pipe) form.
//
// Two deliberate choices:
// - The delimiter row is identified by POSITION (always the table block's
//   second line, per the GFM spec), not by pattern: a dash-only body row like
//   `| - | - |` is a real data row and must never be treated as a delimiter.
// - Column count is the max over ALL rows, matching the widget's own
//   normalization in toDOM() (which renders the grid at the max cell count
//   seen). Cells beyond the delimiter count are preserved, not dropped.

const SEPARATOR_RE = /^\|?\s*[-:]+\s*(\|\s*[-:]+\s*)*\|?\s*$/;

// Pattern-based check used by the widget's pre-existing row bookkeeping.
// The transforms below deliberately do NOT use it (see module comment).
export function isSeparatorLine(line: string): boolean {
  return SEPARATOR_RE.test(line);
}

const DELIMITER_LINE_INDEX = 1;

export function splitRowCells(line: string): string[] {
  const segments: string[] = [];
  let start = 0;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "|") {
      segments.push(line.slice(start, i));
      start = i + 1;
    }
  }
  segments.push(line.slice(start));

  // An optional leading/trailing pipe leaves a whitespace-only segment at that
  // edge; strip at most one from each end so bare, canonical, and ragged rows
  // all yield the same cell list while preserving each cell's original text.
  if (segments.length > 1 && segments[0].trim() === "") segments.shift();
  if (segments.length > 1 && segments[segments.length - 1].trim() === "") segments.pop();
  return segments;
}

// No padding or substitution here: pre-existing zero-width cells ("||") must
// round-trip byte-identically when a *different* column is edited. Callers
// that intend a visibly empty cell (padding, explicit clear) pass "  ".
export function serializeRowCells(cells: string[]): string {
  return `|${cells.join("|")}|`;
}

export function tableColumnCount(source: string): number {
  return source
    .split("\n")
    .reduce((max, line) => Math.max(max, splitRowCells(line).length), 0);
}

// Delimiter rows pad with a dash cell so the alignment column stays a valid
// separator; data rows pad with an empty cell.
function padRow(cells: string[], colCount: number, delimiter: boolean): void {
  const filler = delimiter ? " --- " : "  ";
  while (cells.length < colCount) cells.push(filler);
}

export function moveTableColumn(source: string, from: number, to: number): string {
  const lines = source.split("\n");
  const colCount = tableColumnCount(source);
  if (from === to) return source;
  if (from < 0 || from >= colCount || to < 0 || to >= colCount) return source;

  const rewritten = lines.map((line, index) => {
    const cells = splitRowCells(line);
    padRow(cells, colCount, index === DELIMITER_LINE_INDEX);
    const [moved] = cells.splice(from, 1);
    cells.splice(to, 0, moved);
    return serializeRowCells(cells);
  });
  return rewritten.join("\n");
}

export function deleteTableColumn(source: string, colIdx: number): string {
  const lines = source.split("\n");
  const colCount = tableColumnCount(source);
  if (colIdx < 0 || colIdx >= colCount) return source;

  const rewritten = lines.map((line, index) => {
    const cells = splitRowCells(line);
    padRow(cells, colCount, index === DELIMITER_LINE_INDEX);
    cells.splice(colIdx, 1);
    return serializeRowCells(cells);
  });
  return rewritten.join("\n");
}

export function appendTableColumn(source: string): string {
  const lines = source.split("\n");
  const colCount = tableColumnCount(source);

  const rewritten = lines.map((line, index) => {
    const delimiter = index === DELIMITER_LINE_INDEX;
    const cells = splitRowCells(line);
    padRow(cells, colCount, delimiter);
    cells.push(delimiter ? " --- " : "  ");
    return serializeRowCells(cells);
  });
  return rewritten.join("\n");
}

export function clearTableCellRange(
  source: string,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): string {
  const lines = source.split("\n");
  const colCount = tableColumnCount(source);
  const rowStart = Math.min(r1, r2);
  const rowEnd = Math.max(r1, r2);
  const colStart = Math.min(c1, c2);
  const colEnd = Math.max(c1, c2);

  // Row indices address data rows: every line except the delimiter. The
  // mapping is positional — a dash-only body row is selectable data and
  // must keep its slot in the map.
  const dataLineIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i !== DELIMITER_LINE_INDEX || lines.length === 1) dataLineIndices.push(i);
  }

  // Only rows inside the selection are rewritten, so untouched rows stay
  // byte-identical.
  const result = [...lines];
  for (let row = rowStart; row <= rowEnd; row++) {
    if (row < 0 || row >= dataLineIndices.length) continue;
    const lineIndex = dataLineIndices[row];
    const cells = splitRowCells(lines[lineIndex]);
    padRow(cells, colCount, false);
    for (let col = colStart; col <= colEnd; col++) {
      if (col >= 0 && col < cells.length) cells[col] = "  ";
    }
    result[lineIndex] = serializeRowCells(cells);
  }
  return result.join("\n");
}
