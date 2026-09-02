import type { EditorAPI } from "@floatboat/nexus-core";

export const DEFAULT_TABLE_COLUMNS = 3;
export const DEFAULT_TABLE_BODY_ROWS = 2;
export const MIN_TABLE_COLUMNS = 1;
export const MIN_TABLE_BODY_ROWS = 1;
export const MAX_TABLE_COLUMNS = 20;
export const MAX_TABLE_BODY_ROWS = 50;

export interface InsertTableOptions {
  /** Body row count (excludes the header). Default 2. */
  rows?: number;
  /** Column count. Default 3. */
  columns?: number;
  /** Header labels. Missing entries fall back to `Header N`. */
  headers?: string[];
}

export interface NormalizedTableSize {
  columns: number;
  rows: number;
}

export function normalizeTableSize(options: InsertTableOptions = {}): NormalizedTableSize {
  return {
    columns: clamp(options.columns ?? DEFAULT_TABLE_COLUMNS, MIN_TABLE_COLUMNS, MAX_TABLE_COLUMNS),
    rows: clamp(options.rows ?? DEFAULT_TABLE_BODY_ROWS, MIN_TABLE_BODY_ROWS, MAX_TABLE_BODY_ROWS),
  };
}

export function escapeTableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function padCell(text: string): string {
  return text.length === 0 ? "  " : ` ${text} `;
}

function buildRow(cells: string[]): string {
  return `|${cells.map(padCell).join("|")}|`;
}

export function buildTableMarkdown(options: InsertTableOptions = {}): string {
  const { columns, rows } = normalizeTableSize(options);
  const headers = Array.from({ length: columns }, (_, index) => {
    const raw = options.headers?.[index];
    if (raw == null || raw.trim() === "") return `Header ${index + 1}`;
    return escapeTableCell(raw);
  });
  const separator = Array.from({ length: columns }, () => " --- ");
  const empty = Array.from({ length: columns }, () => "");
  const body = Array.from({ length: rows }, () => buildRow(empty));
  return [buildRow(headers), `|${separator.join("|")}|`, ...body].join("\n");
}

/**
 * Insert a GFM table at the current selection as one undo step.
 * Places the selection on the first header cell so the user can rename it.
 */
export function insertTable(editor: EditorAPI, options: InsertTableOptions = {}): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const selected = doc.slice(from, to);
  const firstHeader = selected.includes("\n") ? undefined : selected.trim();

  const table = buildTableMarkdown({
    ...options,
    headers: firstHeader
      ? [firstHeader, ...(options.headers?.slice(1) ?? [])]
      : options.headers,
  });

  const needsLeadingNewline = from > 0 && doc[from - 1] !== "\n";
  const needsTrailingNewline = to < doc.length && doc[to] !== "\n";
  const block =
    (needsLeadingNewline ? "\n" : "") +
    table +
    (needsTrailingNewline ? "\n" : "");

  const headerLabel = firstHeader ? escapeTableCell(firstHeader) : "Header 1";
  const headerOffset = (needsLeadingNewline ? 1 : 0) + 2;
  editor.replaceRange(from, to, block, {
    anchor: from + headerOffset,
    head: from + headerOffset + headerLabel.length,
  });
  return true;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
