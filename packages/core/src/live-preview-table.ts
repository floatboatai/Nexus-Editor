import { EditorView, WidgetType, runScopeHandlers } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import type { Table } from "mdast";

import { appendTextWithSearchHighlights } from "./search-highlight";
import type { LivePreviewLabels } from "./types";

let tableEditingCount = 0;

export function isTableEditing(): boolean {
  return tableEditingCount > 0;
}

// 表格方向键导航的调试日志，仅在显式开启 floatboat:markdown-debug 标记后输出。
// 用于在真实环境里定位"光标没跳格 / 飞到第一行"等时序问题。
function tableNavDebug(message: string, details?: Record<string, unknown>): void {
  try {
    const debugGlobal = globalThis as {
      __FLOATBOAT_MARKDOWN_DEBUG__?: boolean;
      localStorage?: { getItem(key: string): string | null };
    };
    const enabled =
      debugGlobal.__FLOATBOAT_MARKDOWN_DEBUG__ === true ||
      debugGlobal.localStorage?.getItem("floatboat:markdown-debug") === "1";
    if (!enabled) return;
    // eslint-disable-next-line no-console
    console.debug(`[nexus-table-nav] ${message}`, details ?? {});
  } catch {
    /* noop */
  }
}

function describeActiveCell(): string {
  try {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return "<none>";
    const cls = active.className || active.tagName;
    return `${cls}:"${(active.textContent ?? "").slice(0, 12)}"`;
  } catch {
    return "<err>";
  }
}

const SEPARATOR_RE = /^\|?\s*[-:]+\s*(\|\s*[-:]+\s*)*\|?\s*$/;

// Session-scoped store of user-customised column widths. Keyed by the
// table's header line (e.g. `| 头像 | 用户名 | 主页 |`) so widths survive
// the widget being rebuilt across edits as long as the header doesn't
// change. Not persisted across reloads — markdown tables don't have a
// place to store column widths and we don't want to write sidecar files
// for this. Values: [rowGripWidth, ...dataColumnWidths].
const tableColumnWidths = new Map<string, number[]>();

const ROW_GRIP_WIDTH = 16;
const MIN_COLUMN_WIDTH = 48;
const renderedSourceOffsets = new WeakMap<Node, { start: number; end: number }>();

function getNodeSourceOffsets(node: any, tableFrom: number, rawSourceStart: number, inlineCode = false): { start: number; end: number } | null {
  const startOffset = node?.position?.start?.offset;
  const endOffset = node?.position?.end?.offset;
  if (typeof startOffset !== "number" || typeof endOffset !== "number") return null;
  const markerOffset = inlineCode ? 1 : 0;
  return {
    start: startOffset - tableFrom - rawSourceStart + markerOffset,
    end: endOffset - tableFrom - rawSourceStart - markerOffset,
  };
}

function findFirstMappedSourceOffset(node: Node): number | null {
  const own = renderedSourceOffsets.get(node);
  if (own) return own.start;
  for (const child of Array.from(node.childNodes)) {
    const mapped = findFirstMappedSourceOffset(child);
    if (mapped !== null) return mapped;
  }
  return null;
}

function findLastMappedSourceOffset(node: Node): number | null {
  const own = renderedSourceOffsets.get(node);
  if (own) return own.end;
  const children = Array.from(node.childNodes);
  for (let i = children.length - 1; i >= 0; i--) {
    const mapped = findLastMappedSourceOffset(children[i]);
    if (mapped !== null) return mapped;
  }
  return null;
}

function rawSourceOffsetFromCaret(container: Node, offset: number): number | null {
  const own = renderedSourceOffsets.get(container);
  if (own) return Math.max(own.start, Math.min(own.start + offset, own.end));
  const children = Array.from(container.childNodes);
  if (offset > 0) {
    const previous = children[offset - 1];
    if (previous) {
      const mapped = findLastMappedSourceOffset(previous);
      if (mapped !== null) return mapped;
    }
  }
  const next = children[offset];
  if (next) {
    const mapped = findFirstMappedSourceOffset(next);
    if (mapped !== null) return mapped;
  }
  return null;
}

function rawSourceOffsetFromPoint(td: HTMLElement, event: MouseEvent): number | null {
  const doc = td.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
  if (position && td.contains(position.offsetNode)) {
    return rawSourceOffsetFromCaret(position.offsetNode, position.offset);
  }
  const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (range && td.contains(range.startContainer)) {
    return rawSourceOffsetFromCaret(range.startContainer, range.startOffset);
  }
  return null;
}

function placeRawSourceCaret(td: HTMLElement, rawOffset: number): void {
  const text = td.firstChild;
  if (!text || text.nodeType !== Node.TEXT_NODE) return;
  const offset = Math.max(0, Math.min(rawOffset, text.textContent?.length ?? 0));
  const range = td.ownerDocument.createRange();
  range.setStart(text, offset);
  range.collapse(true);
  const selection = td.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function extractCellText(cell: any): string {
  if (!cell || !("children" in cell) || !Array.isArray(cell.children)) return "";
  return cell.children
    .map((c: any) => {
      if ("value" in c && typeof c.value === "string") return c.value;
      if ("children" in c && Array.isArray(c.children))
        return c.children.map((n: any) => ("value" in n ? n.value : "")).join("");
      return "";
    })
    .join("");
}

/**
 * Render an inline mdast node into DOM. Supports the inline subset that
 * appears inside table cells: text, link, strong, emphasis, delete,
 * inlineCode. Anything else falls back to its text representation so the
 * user still sees content (just unstyled).
 */
/**
 * A cell is "media-only" when its visible content is a single image
 * (optionally wrapped in a link). Whitespace-only text siblings are
 * ignored. Media-only cells render the image scaled to the cell width
 * so the user can grow / shrink the image by resizing the column.
 */
function isCellMediaOnly(astCell: any): boolean {
  if (!astCell || !Array.isArray(astCell.children)) return false;
  const meaningful = astCell.children.filter((c: any) => {
    if (!c) return false;
    if (c.type === "text") return typeof c.value === "string" && c.value.trim() !== "";
    return true;
  });
  if (meaningful.length !== 1) return false;
  const only = meaningful[0];
  if (only.type === "image") return true;
  if (only.type === "link" && Array.isArray(only.children)) {
    const linkInner = only.children.filter((c: any) => {
      if (!c) return false;
      if (c.type === "text") return typeof c.value === "string" && c.value.trim() !== "";
      return true;
    });
    return linkInner.length === 1 && linkInner[0].type === "image";
  }
  return false;
}

function registerRenderedSourceOffset(
  node: Text,
  absFrom: number,
  absTo: number,
  tableFrom: number,
  rawSourceStart: number
): void {
  renderedSourceOffsets.set(node, {
    start: absFrom - tableFrom - rawSourceStart,
    end: absTo - tableFrom - rawSourceStart
  });
}

function renderInlineMdast(
  node: any,
  mediaOnly = false,
  tableFrom = 0,
  rawSourceStart = 0,
  editorState: EditorState | null = null
): Node {
  if (!node) return document.createTextNode("");
  switch (node.type) {
    case "text": {
      const value = typeof node.value === "string" ? node.value : "";
      const startOffset = node?.position?.start?.offset;
      const endOffset = node?.position?.end?.offset;
      if (
        editorState &&
        typeof startOffset === "number" &&
        typeof endOffset === "number"
      ) {
        const container = document.createDocumentFragment();
        appendTextWithSearchHighlights(
          container,
          editorState,
          value,
          startOffset,
          endOffset,
          (textNode, absFrom, absTo) => {
            registerRenderedSourceOffset(textNode, absFrom, absTo, tableFrom, rawSourceStart);
          }
        );
        if (container.childNodes.length === 1) {
          return container.firstChild!;
        }
        return container;
      }
      const text = document.createTextNode(value);
      const sourceOffsets = getNodeSourceOffsets(node, tableFrom, rawSourceStart);
      if (sourceOffsets) renderedSourceOffsets.set(text, sourceOffsets);
      return text;
    }
    case "link": {
      const a = document.createElement("a");
      a.href = typeof node.url === "string" ? node.url : "#";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.style.cssText =
        "color:var(--nexus-accent);text-decoration:underline;cursor:pointer;";
      // Stop CM6's editor-level mousedown handler from reading this as a
      // cursor-placement click — we want the browser's native link click
      // to win so the user can ⌘-click open in a new tab.
      a.addEventListener("mousedown", (e) => e.stopPropagation());
      if (mediaOnly) {
        // Let the wrapped <img> grow with the cell without the anchor
        // adding extra inline-baseline whitespace around it.
        a.style.display = "block";
        a.style.lineHeight = "0";
      }
      for (const child of node.children ?? []) a.appendChild(renderInlineMdast(child, mediaOnly, tableFrom, rawSourceStart, editorState));
      return a;
    }
    case "strong": {
      const el = document.createElement("strong");
      for (const child of node.children ?? []) el.appendChild(renderInlineMdast(child, false, tableFrom, rawSourceStart, editorState));
      return el;
    }
    case "emphasis": {
      const el = document.createElement("em");
      for (const child of node.children ?? []) el.appendChild(renderInlineMdast(child, false, tableFrom, rawSourceStart, editorState));
      return el;
    }
    case "delete": {
      const el = document.createElement("del");
      for (const child of node.children ?? []) el.appendChild(renderInlineMdast(child, false, tableFrom, rawSourceStart, editorState));
      return el;
    }
    case "inlineCode": {
      const value = typeof node.value === "string" ? node.value : "";
      const startOffset = node?.position?.start?.offset;
      const endOffset = node?.position?.end?.offset;
      const el = document.createElement("code");
      el.style.cssText =
        "background:var(--nexus-bg-muted);padding:1px 4px;border-radius:3px;font-family:monospace;";
      if (
        editorState &&
        typeof startOffset === "number" &&
        typeof endOffset === "number" &&
        value.length > 0
      ) {
        const contentFrom = startOffset + 1;
        const contentTo = endOffset - 1;
        appendTextWithSearchHighlights(
          el,
          editorState,
          value,
          contentFrom,
          contentTo,
          (textNode, absFrom, absTo) => {
            registerRenderedSourceOffset(textNode, absFrom, absTo, tableFrom, rawSourceStart);
          }
        );
        return el;
      }
      const text = document.createTextNode(value);
      const sourceOffsets = getNodeSourceOffsets(node, tableFrom, rawSourceStart, true);
      if (sourceOffsets) renderedSourceOffsets.set(text, sourceOffsets);
      el.appendChild(text);
      return el;
    }
    case "image": {
      const img = document.createElement("img");
      img.src = typeof node.url === "string" ? node.url : "";
      if (typeof node.alt === "string") img.alt = node.alt;
      if (typeof node.title === "string") img.title = node.title;
      // Two sizing modes:
      //   - Inline image (text + image in same cell): cap to ~1 line of
      //     text so the image doesn't bloat the row height.
      //   - Media-only cell: grow with cell width so resizing the column
      //     resizes the image. max-height keeps a sane upper bound to
      //     stop huge images from forcing a 1000-px-tall row.
      const styles = mediaOnly
        ? [
            "display:block",
            "width:100%",
            "max-width:100%",
            "height:auto",
            "max-height:240px",
            "min-height:32px",
            "border-radius:3px",
            "background:var(--nexus-bg-muted)",
            "border:1px solid var(--nexus-border-subtle)",
            "object-fit:contain",
          ]
        : [
            "max-height:1.6em",
            "min-height:1.6em",
            "min-width:1.6em",
            "max-width:160px",
            "vertical-align:middle",
            "border-radius:3px",
            "background:var(--nexus-bg-muted)",
            "border:1px solid var(--nexus-border-subtle)",
            "object-fit:contain",
          ];
      img.style.cssText = styles.join(";") + ";";
      // Stop CM6's cell mousedown handler from intercepting clicks on the
      // image (otherwise ⌘-clicking the image to open the link wouldn't
      // work, and a plain click would unexpectedly enter cell-edit mode).
      img.addEventListener("mousedown", (e) => e.stopPropagation());
      return img;
    }
    default: {
      if (Array.isArray(node.children)) {
        const frag = document.createDocumentFragment();
        for (const child of node.children) frag.appendChild(renderInlineMdast(child, false, tableFrom, rawSourceStart, editorState));
        return frag;
      }
      const text = document.createTextNode(typeof node.value === "string" ? node.value : "");
      const sourceOffsets = getNodeSourceOffsets(node, tableFrom, rawSourceStart);
      if (sourceOffsets) renderedSourceOffsets.set(text, sourceOffsets);
      return text;
    }
  }
}

function renderCellRich(
  td: HTMLElement,
  astCell: any,
  tableFrom = 0,
  rawSourceStart = 0,
  editorState: EditorState | null = null
): void {
  td.textContent = "";
  if (!astCell || !Array.isArray(astCell.children)) return;
  const mediaOnly = isCellMediaOnly(astCell);
  for (const child of astCell.children) {
    td.appendChild(renderInlineMdast(child, mediaOnly, tableFrom, rawSourceStart, editorState));
  }
}

const GRIP_BG = "var(--nexus-bg-muted)";
const GRIP_BG_HOVER = "var(--nexus-border)";
const SELECT_BG = "rgba(124, 108, 250, 0.12)";
const SELECT_BORDER = "var(--nexus-accent)";
const DRAG_HIGHLIGHT_BG = "rgba(124, 108, 250, 0.08)";
const TEXT_SELECTION_DRAG_THRESHOLD_PX = 3;

export class EditableTableWidget extends WidgetType {
  private editing = false;
  private cleanupEditingLocks: (() => void) | null = null;

  constructor(
    private node: Table,
    private tableFrom: number,
    private source: string,
    private viewRef: { current: EditorView | null },
    private labels: Required<LivePreviewLabels>,
    private searchHighlightKey: string
  ) { super(); }

  eq(other: EditableTableWidget): boolean {
    if (this.editing) return true;
    return this.source === other.source && this.searchHighlightKey === other.searchHighlightKey;
  }

  ignoreEvent(): boolean { return true; }

  destroy(): void {
    this.cleanupEditingLocks?.();
    this.cleanupEditingLocks = null;
  }

  get estimatedHeight(): number {
    const rows = this.node.children?.length ?? 1;
    // rows × ~32px (cell padding + text) + 16px wrapper padding (8px top + 8px bottom)
    return rows * 32 + 16;
  }

  private dispatch(newSource: string): void {
    const v = this.viewRef.current;
    if (!v) return;
    v.dispatch({ changes: { from: this.tableFrom, to: this.tableFrom + this.source.length, insert: newSource } });
  }

  private deleteColumn(colIdx: number): void {
    const lines = this.source.split("\n");
    const newLines = lines.map((line) => {
      const cells = line.split("|").filter((_, i, a) => i > 0 && i < a.length - 1);
      if (cells.length === 0) return line;
      cells.splice(colIdx, 1);
      return "|" + cells.join("|") + "|";
    });
    this.dispatch(newLines.join("\n"));
  }

  private deleteRow(rowIdx: number): void {
    const lines = this.source.split("\n");
    const dataLines: number[] = [];
    for (let i = 0; i < lines.length; i++) if (!SEPARATOR_RE.test(lines[i])) dataLines.push(i);
    const lineIdx = dataLines[rowIdx];
    if (lineIdx === undefined) return;
    lines.splice(lineIdx, 1);
    this.dispatch(lines.join("\n"));
  }

  private addColumn(): void {
    const lines = this.source.split("\n");
    const nl = lines.map((l) => SEPARATOR_RE.test(l) ? l.replace(/\|?\s*$/, " | --- |") : l.replace(/\|?\s*$/, " |  |"));
    this.dispatch(nl.join("\n"));
  }

  private addRow(): void {
    const cc = (this.node.children?.[0] as any)?.children?.length ?? 2;
    const nr = "\n| " + Array(cc).fill("  ").join(" | ") + " |";
    const v = this.viewRef.current;
    if (!v) return;
    v.dispatch({ changes: { from: this.tableFrom + this.source.length, insert: nr } });
  }

  private moveColumn(from: number, to: number): void {
    const lines = this.source.split("\n");
    const nl = lines.map((line) => {
      const p = line.split("|"), cells = p.slice(1, -1);
      if (from >= cells.length || to >= cells.length) return line;
      const [m] = cells.splice(from, 1);
      cells.splice(to, 0, m);
      return "|" + cells.join("|") + "|";
    });
    this.dispatch(nl.join("\n"));
  }

  private moveRow(from: number, to: number): void {
    const lines = this.source.split("\n");
    const dl: number[] = [];
    for (let i = 0; i < lines.length; i++) if (!SEPARATOR_RE.test(lines[i])) dl.push(i);
    const s = dl[from], d = dl[to];
    if (s === undefined || d === undefined) return;
    const [m] = lines.splice(s, 1);
    lines.splice(d, 0, m);
    this.dispatch(lines.join("\n"));
  }

  toDOM(): HTMLElement {
    const self = this;
    const rows = this.node.children ?? [];
    // Normalise irregular markdown tables: if some rows have more cells than
    // the header (extra cells overflowing) or fewer (missing trailing cells),
    // pick the MAX cell count seen so the rendered grid is rectangular.
    // Short rows are padded with empty cells in the cell loop below; long
    // rows reserve the extra slots in the header / grip row here.
    let colCount = 0;
    for (const row of rows) {
      const len = "children" in row && Array.isArray(row.children) ? row.children.length : 0;
      if (len > colCount) colCount = len;
    }
    const sourceLines = this.source.split("\n");
    const dataLineIndices: number[] = [];
    for (let i = 0; i < sourceLines.length; i++) if (!SEPARATOR_RE.test(sourceLines[i])) dataLineIndices.push(i);

    // State
    let selectedCol = -1;
    let selectedRow = -1;

    // Cell range selection (Excel-style)
    let rangeStart: { row: number; col: number } | null = null;
    let rangeEnd: { row: number; col: number } | null = null;
    let isRangeSelecting = false;
    let cellMouseDown = false; // true between mousedown and mouseup on a cell
    let rangeActive = false;   // true when a multi-cell range is displayed (survives mouseup)

    // Custom drag state (no HTML5 drag API)
    let draggingCol = -1;   // which column is being dragged
    let draggingRow = -1;   // which row is being dragged
    let dropTargetCol = -1;
    let dropTargetRow = -1;
    const editingLocks = {
      focus: false,
      range: false,
      drag: false,
    };

    function hasEditingLocks(): boolean {
      return editingLocks.focus || editingLocks.range || editingLocks.drag;
    }

    function acquireEditingLock(lock: keyof typeof editingLocks): void {
      if (editingLocks[lock]) return;
      editingLocks[lock] = true;
      self.editing = true;
      tableEditingCount++;
    }

    function releaseEditingLock(lock: keyof typeof editingLocks): void {
      if (!editingLocks[lock]) return;
      editingLocks[lock] = false;
      tableEditingCount = Math.max(0, tableEditingCount - 1);
      self.editing = hasEditingLocks();
    }

    this.cleanupEditingLocks = () => {
      releaseEditingLock("focus");
      releaseEditingLock("range");
      releaseEditingLock("drag");
    };

    function blurActiveCellForDrag(): void {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !wrapper.contains(active) || !active.classList.contains("nexus-cell")) return;
      active.blur();
      releaseEditingLock("focus");
      active.contentEditable = "false";
    }

    // ── Root wrapper ──
    const wrapper = document.createElement("div");
    wrapper.className = "nexus-table-wrapper";
    // CRITICAL: use padding, not margin. CM6 measures block widget height via
    // getBoundingClientRect which EXCLUDES margin. margin:8px caused 16px of
    // untracked height per table → cumulative click-drift below every table.
    wrapper.style.cssText =
      "display:inline-block;position:relative;padding:8px 0;user-select:text;-webkit-user-select:text;";

    // ── Table ──
    const table = document.createElement("table");
    table.setAttribute("role", "grid");
    table.setAttribute("aria-label", "Editable table");
    table.style.cssText = "border-collapse:collapse;display:table;";
    if (rows.length === 0) { wrapper.appendChild(table); return wrapper; }

    // ── Column-width persistence ──
    // Keyed by the table's header source line so widths stick across
    // widget rebuilds caused by editing other cells.
    const widthKey = sourceLines[dataLineIndices[0] ?? 0] ?? "";

    /**
     * Apply (or refresh) an explicit `<colgroup>` + `table-layout: fixed`
     * with the given widths. `widths` is one entry per column in the
     * rendered table — including the row-grip column at index 0.
     */
    const applyColumnWidths = (widths: number[]): void => {
      let colgroup = table.querySelector(":scope > colgroup") as HTMLTableColElement | null;
      if (!colgroup) {
        colgroup = document.createElement("colgroup") as HTMLTableColElement;
        for (let i = 0; i < widths.length; i++) {
          const col = document.createElement("col");
          col.style.width = widths[i] + "px";
          colgroup.appendChild(col);
        }
        table.insertBefore(colgroup, table.firstChild);
      } else {
        const cols = Array.from(colgroup.children);
        for (let i = 0; i < widths.length && i < cols.length; i++) {
          (cols[i] as HTMLElement).style.width = widths[i] + "px";
        }
      }
      const total = widths.reduce((s, w) => s + w, 0);
      table.style.tableLayout = "fixed";
      table.style.width = total + "px";
    };

    /**
     * Read the current rendered column widths from the DOM. Used as the
     * baseline when the user starts dragging a resize handle. Falls back
     * to a sane minimum when a cell hasn't laid out yet.
     */
    const measureColumnWidths = (): number[] => {
      const widths: number[] = [];
      // table.rows = [gripRow, headerRow, ...dataRows] — measure off the
      // header row because it has the same cell-count as data rows and is
      // never the all-empty fallback.
      const headerRow = table.rows[1];
      if (!headerRow) return widths;
      for (let i = 0; i < headerRow.cells.length; i++) {
        const w = (headerRow.cells[i] as HTMLElement).getBoundingClientRect().width;
        widths.push(Math.max(i === 0 ? ROW_GRIP_WIDTH : MIN_COLUMN_WIDTH, Math.round(w)));
      }
      return widths;
    };

    /**
     * Start a column-resize drag for the data column at `dataColIdx`
     * (0-based among data columns — the row-grip is column 0 in the DOM
     * but never resizable, so the dragged column lives at colgroup
     * index `dataColIdx + 1`).
     */
    const startColumnResize = (dataColIdx: number, startX: number): void => {
      acquireEditingLock("drag");
      const baseWidths = (() => {
        const saved = tableColumnWidths.get(widthKey);
        if (saved && saved.length === colCount + 1) return saved.slice();
        return measureColumnWidths();
      })();
      applyColumnWidths(baseWidths);
      const initial = baseWidths[dataColIdx + 1];
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent): void => {
        const delta = ev.clientX - startX;
        const next = Math.max(MIN_COLUMN_WIDTH, initial + delta);
        const updated = baseWidths.slice();
        updated[dataColIdx + 1] = next;
        applyColumnWidths(updated);
        baseWidths[dataColIdx + 1] = next;
      };
      const onUp = (): void => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        tableColumnWidths.set(widthKey, baseWidths.slice());
        releaseEditingLock("drag");
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };

    // ── Selection overlay — highlights entire table when CM6 selection covers it ──
    const selectionOverlay = document.createElement("div");
    selectionOverlay.style.cssText =
      "position:absolute;inset:0;background:rgba(124,108,250,0.1);pointer-events:none;" +
      "display:none;z-index:1;border-radius:2px;";
    wrapper.appendChild(selectionOverlay);

    // Poll CM6 selection to show/hide overlay and clear range when focus leaves table
    const checkSelection = (): void => {
      if (!wrapper.isConnected) return;
      const v = self.viewRef.current;
      if (v && !self.editing) {
        // Multi-cursor: any range fully covering the table counts as
        // "table selected"; the cell-range only clears when every cursor
        // has left the table span.
        const ranges = v.state.selection.ranges;
        const tableEnd = self.tableFrom + self.source.length;
        const isSelected = ranges.some(
          (range) => !range.empty && range.from <= self.tableFrom && range.to >= tableEnd
        );
        selectionOverlay.style.display = isSelected ? "block" : "none";
        // If cursor moved outside table, no active interaction, no active range, clear range selection
        const allOutside = ranges.every(
          (range) => range.head < self.tableFrom || range.head > tableEnd
        );
        if (rangeStart && !isRangeSelecting && !cellMouseDown && !rangeActive && allOutside) {
          clearRangeSelection();
        }
      } else {
        selectionOverlay.style.display = "none";
      }
      requestAnimationFrame(checkSelection);
    };
    requestAnimationFrame(checkSelection);

    // ── Drag indicator overlay (full-height vertical line) ──
    const colIndicator = document.createElement("div");
    colIndicator.style.cssText =
      "position:absolute;width:2px;background:" + SELECT_BORDER + ";pointer-events:none;" +
      "top:0;bottom:0;display:none;z-index:2;border-radius:1px;";
    wrapper.appendChild(colIndicator);

    const rowIndicator = document.createElement("div");
    rowIndicator.style.cssText =
      "position:absolute;height:2px;background:" + SELECT_BORDER + ";pointer-events:none;" +
      "left:0;right:0;display:none;z-index:2;border-radius:1px;";
    wrapper.appendChild(rowIndicator);

    // Floating pill that follows the mouse during column drag
    const floatingPill = document.createElement("div");
    floatingPill.style.cssText =
      "position:absolute;width:16px;height:6px;border-radius:3px;background:" + SELECT_BORDER + ";" +
      "pointer-events:none;display:none;z-index:3;top:4px;";
    wrapper.appendChild(floatingPill);

    // Floating pill for row drag
    const floatingRowPill = document.createElement("div");
    floatingRowPill.style.cssText =
      "position:absolute;width:6px;height:16px;border-radius:3px;background:" + SELECT_BORDER + ";" +
      "pointer-events:none;display:none;z-index:3;left:5px;";
    wrapper.appendChild(floatingRowPill);

    // ── Helpers ──

    function getColumnCells(colIdx: number): HTMLElement[] {
      const result: HTMLElement[] = [];
      table.querySelectorAll("tr").forEach((tr) => {
        const cells = tr.querySelectorAll(".nexus-cell");
        if (cells[colIdx]) result.push(cells[colIdx] as HTMLElement);
      });
      return result;
    }

    function getHeaderCells(): NodeListOf<Element> {
      return table.querySelectorAll("tr:nth-child(2) .nexus-cell");
    }

    function colAtClientX(clientX: number): number {
      const cells = getHeaderCells();
      for (let i = 0; i < cells.length; i++) {
        const rect = cells[i].getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right) return i;
      }
      return -1;
    }

    function rowAtClientY(clientY: number): number {
      // Skip header (index 0), only match data rows (index >= 1)
      const dataRows = Array.from(table.querySelectorAll("tr")).filter((_, i) => i > 0);
      for (let i = 1; i < dataRows.length; i++) { // start at 1 to skip header row
        const rect = dataRows[i].getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) return i;
      }
      return -1;
    }

    function showColIndicator(targetCol: number): void {
      if (draggingCol < 0 || targetCol === draggingCol) { colIndicator.style.display = "none"; dropTargetCol = -1; return; }
      dropTargetCol = targetCol;
      const cells = getHeaderCells();
      const cell = cells[targetCol] as HTMLElement | undefined;
      if (!cell) return;
      const wrapperRect = wrapper.getBoundingClientRect();
      const cellRect = cell.getBoundingClientRect();
      const bounds = getContentBounds();
      const rawX = draggingCol < targetCol ? cellRect.right : cellRect.left;
      const clampedX = Math.max(bounds.left, Math.min(rawX, bounds.right));
      colIndicator.style.left = (clampedX - wrapperRect.left - 1) + "px";
      colIndicator.style.display = "block";
    }

    function showRowIndicator(targetRow: number): void {
      if (draggingRow < 0 || targetRow === draggingRow) { rowIndicator.style.display = "none"; dropTargetRow = -1; return; }
      dropTargetRow = targetRow;
      const dataRows = Array.from(table.querySelectorAll("tr")).filter((_, i) => i > 0);
      const row = dataRows[targetRow] as HTMLElement | undefined;
      if (!row) return;
      const wrapperRect = wrapper.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const y = draggingRow < targetRow ? rowRect.bottom - wrapperRect.top : rowRect.top - wrapperRect.top;
      rowIndicator.style.top = (y - 1) + "px";
      rowIndicator.style.display = "block";
    }

    function hideIndicators(): void {
      colIndicator.style.display = "none";
      rowIndicator.style.display = "none";
      dropTargetCol = -1;
      dropTargetRow = -1;
    }

    function clearDragHighlights(): void {
      table.querySelectorAll(".nexus-cell").forEach((el) => {
        const h = el as HTMLElement;
        h.style.background = h.tagName === "TH" ? "var(--nexus-bg-subtle)" : "";
      });
    }

    // ── Range selection border overlay ──
    const rangeBorder = document.createElement("div");
    rangeBorder.style.cssText =
      "position:absolute;border:2px solid " + SELECT_BORDER + ";pointer-events:none;" +
      "display:none;z-index:1;border-radius:2px;";
    wrapper.appendChild(rangeBorder);

    function getNormalizedRange(): { r1: number; c1: number; r2: number; c2: number } | null {
      if (!rangeStart || !rangeEnd) return null;
      return {
        r1: Math.min(rangeStart.row, rangeEnd.row),
        c1: Math.min(rangeStart.col, rangeEnd.col),
        r2: Math.max(rangeStart.row, rangeEnd.row),
        c2: Math.max(rangeStart.col, rangeEnd.col),
      };
    }

    function getCellElement(row: number, col: number): HTMLElement | null {
      const dataRows = Array.from(table.querySelectorAll("tr")).filter((_, i) => i > 0);
      const tr = dataRows[row];
      if (!tr) return null;
      const cells = tr.querySelectorAll(".nexus-cell");
      return (cells[col] as HTMLElement) ?? null;
    }

    function hasNativeTextSelectionInCell(cell: HTMLElement): boolean {
      const selection = cell.ownerDocument.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
      const range = selection.getRangeAt(0);
      return cell.contains(range.startContainer) || cell.contains(range.endContainer);
    }

    function clearNativeTextSelection(): void {
      table.ownerDocument.getSelection()?.removeAllRanges();
    }

    function serializeRangeSelection(range: { r1: number; c1: number; r2: number; c2: number }): string {
      const lines: string[] = [];
      for (let row = range.r1; row <= range.r2; row++) {
        const cells: string[] = [];
        for (let col = range.c1; col <= range.c2; col++) {
          cells.push(getCellElement(row, col)?.textContent ?? "");
        }
        lines.push(cells.join("\t"));
      }
      return lines.join("\n");
    }

    function selectedCopyRange(): { r1: number; c1: number; r2: number; c2: number } | null {
      const range = getNormalizedRange();
      if (rangeActive && range) return range;
      if (selectedCol >= 0) return { r1: 0, c1: selectedCol, r2: rows.length - 1, c2: selectedCol };
      if (selectedRow >= 0) return { r1: selectedRow, c1: 0, r2: selectedRow, c2: colCount - 1 };
      return null;
    }

    function renderRangeSelection(): void {
      const range = getNormalizedRange();
      if (!range) { rangeBorder.style.display = "none"; return; }

      // Highlight cells in range
      const dataRows = Array.from(table.querySelectorAll("tr")).filter((_, i) => i > 0);
      dataRows.forEach((tr, rowIdx) => {
        tr.querySelectorAll(".nexus-cell").forEach((cell, colIdx) => {
          const h = cell as HTMLElement;
          if (rowIdx >= range.r1 && rowIdx <= range.r2 && colIdx >= range.c1 && colIdx <= range.c2) {
            h.style.background = SELECT_BG;
          } else {
            h.style.background = h.tagName === "TH" ? "var(--nexus-bg-subtle)" : "";
          }
        });
      });

      // Position the border overlay around the selected range
      const topLeft = getCellElement(range.r1, range.c1);
      const bottomRight = getCellElement(range.r2, range.c2);
      if (!topLeft || !bottomRight) { rangeBorder.style.display = "none"; return; }

      const wrapperRect = wrapper.getBoundingClientRect();
      const tlRect = topLeft.getBoundingClientRect();
      const brRect = bottomRight.getBoundingClientRect();

      rangeBorder.style.left = (tlRect.left - wrapperRect.left - 1) + "px";
      rangeBorder.style.top = (tlRect.top - wrapperRect.top - 1) + "px";
      rangeBorder.style.width = (brRect.right - tlRect.left) + "px";
      rangeBorder.style.height = (brRect.bottom - tlRect.top) + "px";
      rangeBorder.style.display = "block";
    }

    function clearRangeSelection(): void {
      releaseEditingLock("range");
      rangeStart = null;
      rangeEnd = null;
      isRangeSelecting = false;
      rangeActive = false;
      rangeBorder.style.display = "none";
      table.querySelectorAll(".nexus-cell").forEach((el) => {
        const h = el as HTMLElement;
        h.style.background = h.tagName === "TH" ? "var(--nexus-bg-subtle)" : "";
        h.removeAttribute("aria-selected");
      });
    }

    function cellAtPoint(clientX: number, clientY: number): { row: number; col: number } | null {
      const dataRows = Array.from(table.querySelectorAll("tr")).filter((_, i) => i > 0);
      for (let r = 0; r < dataRows.length; r++) {
        const cells = dataRows[r].querySelectorAll(".nexus-cell");
        for (let c = 0; c < cells.length; c++) {
          const rect = cells[c].getBoundingClientRect();
          if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
            return { row: r, col: c };
          }
        }
      }
      return null;
    }

    function clearSelection(): void {
      selectedCol = -1;
      selectedRow = -1;
      table.querySelectorAll(".nexus-cell").forEach((el) => {
        const h = el as HTMLElement;
        h.style.background = h.tagName === "TH" ? "var(--nexus-bg-subtle)" : "";
        h.removeAttribute("aria-selected");
      });
      table.querySelectorAll(".nexus-col-grip").forEach((el) => {
        (el as HTMLElement).style.background = "";
      });
      table.querySelectorAll(".nexus-row-grip").forEach((el) => {
        (el as HTMLElement).style.background = "";
      });
    }

    function highlightColumn(colIdx: number): void {
      clearSelection();
      selectedCol = colIdx;
      const gripCells = table.querySelectorAll(".nexus-col-grip");
      if (gripCells[colIdx]) (gripCells[colIdx] as HTMLElement).style.background = SELECT_BORDER;
      getColumnCells(colIdx).forEach((el) => { el.style.background = SELECT_BG; });
    }

    function highlightRow(rowIdx: number): void {
      clearSelection();
      selectedRow = rowIdx;
      const trs = Array.from(table.querySelectorAll("tr")).filter((_, i) => i > 0);
      if (trs[rowIdx]) {
        trs[rowIdx].querySelectorAll(".nexus-cell").forEach((el) => {
          (el as HTMLElement).style.background = SELECT_BG;
        });
        const grip = trs[rowIdx].querySelector(".nexus-row-grip");
        if (grip) (grip as HTMLElement).style.background = SELECT_BORDER;
      }
    }

    function createGripPill(): HTMLElement {
      const pill = document.createElement("div");
      pill.style.cssText =
        "width:16px;height:6px;border-radius:3px;background:" + GRIP_BG + ";" +
        "margin:0 auto;transition:background .15s;";
      return pill;
    }

    // ── Custom drag handlers (mousedown/mousemove/mouseup, no HTML5 drag) ──

    // Get the content area boundaries (excluding grip column)
    function getContentBounds(): { left: number; right: number; top: number; bottom: number } {
      const cells = getHeaderCells();
      if (cells.length === 0) return wrapper.getBoundingClientRect();
      const first = cells[0].getBoundingClientRect();
      const last = cells[cells.length - 1].getBoundingClientRect();
      return { left: first.left, right: last.right, top: first.top, bottom: last.bottom };
    }

    function onDragMove(e: MouseEvent): void {
      e.preventDefault();
      if (!wrapper.isConnected) { onDragEnd(); return; }
      const wrapperRect = wrapper.getBoundingClientRect();

      if (draggingCol >= 0) {
        const bounds = getContentBounds();
        const clampedX = Math.max(bounds.left, Math.min(e.clientX, bounds.right));
        floatingPill.style.left = (clampedX - wrapperRect.left - 8) + "px";

        const target = colAtClientX(clampedX);
        if (target >= 0 && target !== draggingCol) {
          showColIndicator(target);
        } else {
          colIndicator.style.display = "none";
          dropTargetCol = -1;
        }
      }
      if (draggingRow >= 0) {
        // Move floating pill vertically, constrained to non-header data rows
        const dataRows = Array.from(table.querySelectorAll("tr")).filter((_, i) => i > 0);
        // dataRows[0] is header, dataRows[1+] are body rows — clamp to body rows only
        const firstBodyRow = dataRows[1]?.getBoundingClientRect();
        const lastRow = dataRows[dataRows.length - 1]?.getBoundingClientRect();
        const minY = firstBodyRow ? firstBodyRow.top : wrapperRect.top;
        const maxY = lastRow ? lastRow.bottom : wrapperRect.bottom;
        const clampedY = Math.max(minY, Math.min(e.clientY, maxY));
        floatingRowPill.style.top = (clampedY - wrapperRect.top - 8) + "px";

        const target = rowAtClientY(clampedY);
        if (target >= 0 && target !== draggingRow) {
          showRowIndicator(target);
        } else {
          rowIndicator.style.display = "none";
          dropTargetRow = -1;
        }
      }
    }

    function onDragEnd(): void {
      const movedCol = draggingCol >= 0 && dropTargetCol >= 0 && dropTargetCol !== draggingCol;
      const movedRow = draggingRow >= 0 && dropTargetRow >= 0 && dropTargetRow !== draggingRow;
      const savedDragCol = draggingCol;
      const savedDropCol = dropTargetCol;
      const savedDragRow = draggingRow;
      const savedDropRow = dropTargetRow;

      // Clean up visual state FIRST
      clearDragHighlights();
      hideIndicators();
      floatingPill.style.display = "none";
      floatingRowPill.style.display = "none";
      gripRow.style.opacity = "0";
      draggingCol = -1;
      draggingRow = -1;
      document.removeEventListener("mousemove", onDragMove);
      document.removeEventListener("mouseup", onDragEnd);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      // Release editing lock BEFORE dispatch so the resulting update rebuilds widget
      releaseEditingLock("drag");

      // Now dispatch the move — this triggers a full decoration rebuild with new source
      if (movedCol) self.moveColumn(savedDragCol, savedDropCol);
      if (movedRow) self.moveRow(savedDragRow, savedDropRow);
    }

    function startColDrag(colIdx: number, startX: number): void {
      draggingCol = colIdx;
      draggingRow = -1;
      // Lock editing to prevent CM6 from recreating widget DOM mid-drag
      acquireEditingLock("drag");
      blurActiveCellForDrag();
      clearRangeSelection();
      clearSelection();
      // Highlight source column
      getColumnCells(colIdx).forEach((el) => { el.style.background = DRAG_HIGHLIGHT_BG; });
      // Hide grip row, show floating pill instead
      gripRow.style.opacity = "0";
      const wrapperRect = wrapper.getBoundingClientRect();
      floatingPill.style.left = (startX - wrapperRect.left - 8) + "px";
      floatingPill.style.display = "block";
      document.addEventListener("mousemove", onDragMove);
      document.addEventListener("mouseup", onDragEnd);
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    }

    function startRowDrag(rowIdx: number, startY: number): void {
      draggingRow = rowIdx;
      draggingCol = -1;
      // Lock editing to prevent CM6 from recreating widget DOM mid-drag
      acquireEditingLock("drag");
      blurActiveCellForDrag();
      clearRangeSelection();
      clearSelection();
      // Highlight source row
      const trs = Array.from(table.querySelectorAll("tr")).filter((_, i) => i > 0);
      if (trs[rowIdx]) {
        trs[rowIdx].querySelectorAll(".nexus-cell").forEach((el) => {
          (el as HTMLElement).style.background = DRAG_HIGHLIGHT_BG;
        });
      }
      // Show floating row pill
      const wrapperRect = wrapper.getBoundingClientRect();
      floatingRowPill.style.top = (startY - wrapperRect.top - 8) + "px";
      floatingRowPill.style.display = "block";
      // Hide the source row grip
      const grip = trs[rowIdx]?.querySelector(".nexus-row-grip") as HTMLElement | null;
      if (grip) grip.style.opacity = "0";
      document.addEventListener("mousemove", onDragMove);
      document.addEventListener("mouseup", onDragEnd);
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    }

    // ── Column grip row ──
    const gripRow = document.createElement("tr");
    gripRow.style.cssText = "opacity:0;transition:opacity .15s;";

    const gripSpacer = document.createElement("td");
    gripSpacer.style.cssText = "width:16px;min-width:16px;padding:0;border:none;";
    gripRow.appendChild(gripSpacer);

    for (let c = 0; c < colCount; c++) {
      const gripCell = document.createElement("td");
      gripCell.className = "nexus-col-grip";
      gripCell.style.cssText =
        "padding:4px 0;text-align:center;cursor:grab;user-select:none;border:none;";
      const pill = createGripPill();
      gripCell.appendChild(pill);

      gripCell.addEventListener("mouseenter", () => { if (draggingCol < 0) pill.style.background = GRIP_BG_HOVER; });
      gripCell.addEventListener("mouseleave", () => { if (draggingCol < 0) pill.style.background = GRIP_BG; });

      const colIdx = c;

      gripCell.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        startColDrag(colIdx, e.clientX);
      });

      gripCell.addEventListener("click", (e) => {
        e.stopPropagation();
        highlightColumn(colIdx);
        wrapper.focus({ preventScroll: true });
      });

      gripRow.appendChild(gripCell);
    }
    table.appendChild(gripRow);

    // ── 单元格方向键导航（表格内像电子表格一样移动）──
    // 单元格各自 contentEditable，focus 某个单元格即触发其 focus 处理器进入编辑态，
    // 所以导航 = focus 目标单元格 + 摆放光标。↑↓ 同列换行；←→ 仅在文本边界跳列，
    // 否则交回浏览器在单元格文本内移动光标。
    //
    // 导航中标志位：方向键切换单元格时，旧单元格会 blur，其 blur 回调里有一个
    // `v.dispatch({selection})` 会把 CM 文档选区重新派发——这会把焦点/可见光标抢回
    // 编辑器文档（停在文档选区处，常是第 0 行），导致"光标没跳到目标单元格、反而飞到第一行"。
    // 切换期间置位，让旧单元格 blur 跳过这个会抢焦点的派发；新单元格 focus 已接管编辑态。
    let navigatingBetweenCells = false;
    function tableDataRows(): HTMLElement[] {
      return Array.from(table.querySelectorAll<HTMLElement>("tr")).filter((row) => row.querySelector(".nexus-cell"));
    }
    function cellAt(rowIndex: number, colIndex: number): HTMLElement | null {
      if (rowIndex < 0 || colIndex < 0) return null;
      const row = tableDataRows()[rowIndex];
      if (!row) return null;
      return row.querySelectorAll<HTMLElement>(".nexus-cell")[colIndex] ?? null;
    }
    function caretOffsetInCell(cell: HTMLElement): number | null {
      const selection = cell.ownerDocument.getSelection();
      if (!selection || selection.rangeCount === 0) return null;
      const range = selection.getRangeAt(0);
      if (!cell.contains(range.startContainer)) return null;
      const pre = range.cloneRange();
      pre.selectNodeContents(cell);
      pre.setEnd(range.startContainer, range.startOffset);
      return pre.toString().length;
    }
    function focusCellForNavigation(cell: HTMLElement, caret: "start" | "end"): void {
      // 进入"导航中"：旧单元格 blur 时跳过会抢焦点的 selection 派发。
      // blur 在 focus() 内同步触发并 queueMicrotask，故其微任务排在本函数随后 queue 的复位之前。
      navigatingBetweenCells = true;
      // 单元格默认 contentEditable=false（不可聚焦），必须先置为 true 再 focus，
      // focus 处理器随后进入 raw 编辑态。否则 focus() 在不可聚焦元素上是 no-op。
      if (cell.contentEditable !== "true") {
        cell.contentEditable = "true";
      }
      cell.focus({ preventScroll: false });
      tableNavDebug("focusCellForNavigation", {
        caret,
        target: (cell.dataset.source ?? cell.textContent ?? "").slice(0, 12),
        activeAfterFocus: describeActiveCell(),
      });
      queueMicrotask(() => {
        navigatingBetweenCells = false;
      });
      const place = (): void => {
        if (cell.contentEditable !== "true") return;
        const length = (cell.dataset.source ?? cell.textContent ?? "").length;
        placeRawSourceCaret(cell, caret === "end" ? length : 0);
      };
      place();
      // 与单元格点击激活一致：focus/重渲染稳定后再摆一次光标，避免落点丢失。
      window.setTimeout(place, 0);
      // 稍后回看焦点是否仍在目标单元格（若被抢走，说明仍有 dispatch/blur 干扰）。
      window.setTimeout(() => tableNavDebug("focusCellForNavigation:settled", { active: describeActiveCell() }), 60);
    }
    function navigateFromCell(key: string, cell: HTMLElement, rowIndex: number, colIndex: number): boolean {
      const offset = caretOffsetInCell(cell);
      const length = (cell.dataset.source ?? cell.textContent ?? "").length;
      const dataRowCount = tableDataRows().length;
      tableNavDebug("navigateFromCell", { key, offset, length, rowIndex, colIndex, colCount, dataRowCount });

      if (key === "ArrowUp") {
        const target = cellAt(rowIndex - 1, colIndex);
        tableNavDebug("ArrowUp target", { found: Boolean(target) });
        if (!target) return false;
        focusCellForNavigation(target, "end");
        return true;
      }
      if (key === "ArrowDown") {
        const target = cellAt(rowIndex + 1, colIndex);
        tableNavDebug("ArrowDown target", { found: Boolean(target) });
        if (!target) return false;
        focusCellForNavigation(target, "end");
        return true;
      }
      if (key === "ArrowLeft") {
        if (offset === null || offset > 0) {
          tableNavDebug("ArrowLeft passthrough (caret not at start)", { offset });
          return false; // 文本内左移
        }
        const target = cellAt(rowIndex, colIndex - 1) ?? cellAt(rowIndex - 1, colCount - 1);
        tableNavDebug("ArrowLeft target", { found: Boolean(target) });
        if (!target) return false;
        focusCellForNavigation(target, "end");
        return true;
      }
      if (key === "ArrowRight") {
        if (offset === null || offset < length) {
          tableNavDebug("ArrowRight passthrough (caret not at end)", { offset, length });
          return false; // 文本内右移
        }
        const target = cellAt(rowIndex, colIndex + 1) ?? cellAt(rowIndex + 1, 0);
        tableNavDebug("ArrowRight target", { found: Boolean(target) });
        if (!target) return false;
        focusCellForNavigation(target, "start");
        return true;
      }
      return false;
    }

    // ── Data rows ──
    let rowIdx = 0;
    for (const astRow of rows) {
      const isHeader = rowIdx === 0;
      const tr = document.createElement("tr");
      const astCells = "children" in astRow && Array.isArray(astRow.children) ? astRow.children : [];
      const sourceLineIdx = dataLineIndices[rowIdx];
      const curRowIdx = rowIdx;

      // Row grip
      const rowGrip = document.createElement(isHeader ? "th" : "td");
      rowGrip.className = "nexus-row-grip";
      rowGrip.style.cssText =
        "width:16px;min-width:16px;max-width:16px;padding:6px 2px;text-align:center;" +
        "cursor:" + (isHeader ? "default" : "grab") + ";user-select:none;border:none;" +
        "border-right:1px solid var(--nexus-border);vertical-align:middle;" +
        "opacity:0;transition:opacity .15s;";

      if (!isHeader) {
        const rowPill = createGripPill();
        rowPill.style.width = "6px";
        rowPill.style.height = "16px";
        rowPill.style.borderRadius = "3px";
        rowGrip.appendChild(rowPill);

        rowGrip.addEventListener("mouseenter", () => { if (draggingRow < 0) rowPill.style.background = GRIP_BG_HOVER; });
        rowGrip.addEventListener("mouseleave", () => { if (draggingRow < 0) rowPill.style.background = GRIP_BG; });

        rowGrip.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          startRowDrag(curRowIdx, e.clientY);
        });

        rowGrip.addEventListener("click", (e) => {
          e.stopPropagation();
          highlightRow(curRowIdx);
          wrapper.focus({ preventScroll: true });
        });
      }

      tr.appendChild(rowGrip);

      // Content cells — iterate up to the normalised `colCount` so every row
      // gets the same number of <td>/<th> elements. Missing trailing cells in
      // the markdown source are rendered as empty editable cells (typing into
      // one writes back through the same source-line dispatch as the regular
      // cells, so the user just lengthens the row in the source).
      for (let colIdx = 0; colIdx < colCount; colIdx++) {
        const astCell = colIdx < astCells.length ? astCells[colIdx] : undefined;
        const td = document.createElement(isHeader ? "th" : "td");
        td.className = "nexus-cell";
        // Stash the raw markdown source for this cell so we can (a) render
        // it as rich DOM by default — links, bold, code, etc. — and (b)
        // swap back to the raw text when the cell is focused for editing.
        // Without this, `extractCellText` flattens `[X](url)` to `X` and the
        // source-line dispatch in the input handler would clobber the link.
        let rawSource = "";
        let rawSourceStart = 0;
        const startOffset = astCell?.position?.start?.offset;
        const endOffset = astCell?.position?.end?.offset;
        if (typeof startOffset === "number" && typeof endOffset === "number") {
          const sliceStart = startOffset - self.tableFrom;
          const sliceEnd = endOffset - self.tableFrom;
          if (sliceStart >= 0 && sliceEnd >= sliceStart && sliceEnd <= self.source.length) {
            const rawSlice = self.source.slice(sliceStart, sliceEnd);
            const leadingWhitespace = rawSlice.match(/^\s*/)?.[0].length ?? 0;
            rawSource = rawSlice.trim();
            rawSourceStart = sliceStart + leadingWhitespace;
          }
        }
        td.dataset.source = rawSource;
        if (astCell && Array.isArray(astCell.children) && astCell.children.length > 0) {
          renderCellRich(td, astCell, self.tableFrom, rawSourceStart, self.viewRef.current?.state ?? null);
        } else {
          td.textContent = rawSource;
        }
        td.style.cssText =
          "position:relative;border-bottom:1px solid var(--nexus-border);border-right:1px solid var(--nexus-border);padding:8px 12px;" +
          "text-align:left;outline:none;min-width:60px;vertical-align:top;cursor:text;user-select:text;-webkit-user-select:text;";
        if (isHeader) {
          td.style.fontWeight = "bold";
          td.style.background = "var(--nexus-bg-subtle)";
          td.style.borderTop = "1px solid var(--nexus-border)";
          // Column-resize handle on the right edge of each header cell.
          // Sits half-on, half-off the border so the col-resize cursor is
          // discoverable on hover without obscuring cell text. Captures
          // its own mousedown (stopPropagation) so the cell's range-
          // selection handler doesn't fire when the user grabs the
          // handle.
          const resizeHandle = document.createElement("div");
          resizeHandle.className = "nexus-col-resize";
          resizeHandle.style.cssText = [
            "position:absolute",
            "top:0",
            "right:-3px",
            "width:7px",
            "height:100%",
            "cursor:col-resize",
            "z-index:3",
            "user-select:none",
          ].join(";") + ";";
          const handleColIdx = colIdx;
          resizeHandle.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            startColumnResize(handleColIdx, e.clientX);
          });
          // Tiny background flash on hover so the user can see where the
          // handle lives without us drawing a permanent divider line.
          resizeHandle.addEventListener("mouseenter", () => {
            resizeHandle.style.background = "var(--nexus-border)";
          });
          resizeHandle.addEventListener("mouseleave", () => {
            resizeHandle.style.background = "";
          });
          td.appendChild(resizeHandle);
        }

        // Cell interaction: single click = edit, drag = range select
        const cellRow = curRowIdx;
        const cellCol = colIdx;
        let cellMouseMoved = false;
        let cellTextSelectionDrag = false;

        const enterRawEditingMode = (): void => {
          // Pin THIS cell to its currently rendered width before swapping
          // to raw markdown. The column width in table-layout:auto is
          // `max(cellWidth_i)` over all cells in the column — so if one
          // cell tries to widen, the whole column expands and every
          // other cell in it visibly shifts. Capping the focused cell at
          // its existing width prevents it from being the new max →
          // column stays put → no sideways jump as the user clicks
          // between rows.
          const renderedWidth = td.getBoundingClientRect().width;
          if (renderedWidth > 0) {
            td.style.maxWidth = renderedWidth + "px";
            td.style.width = renderedWidth + "px";
          }
          // Inside the capped cell, let long URLs wrap (the rendered
          // text was usually shorter than the raw markdown).
          td.style.wordBreak = "break-all";
          td.style.whiteSpace = "pre-wrap";
          // Swap rendered rich DOM for the raw markdown source so the user
          // edits the actual `[text](url)` text instead of just "text".
          td.textContent = td.dataset.source ?? "";
        };

        const activateCellEditing = (): void => {
          if (td.contentEditable !== "true") {
            td.contentEditable = "true";
          }
          if (td.ownerDocument.activeElement !== td) {
            td.focus({ preventScroll: true });
          }
          enterRawEditingMode();
        };

        td.addEventListener("mousedown", (e) => {
          if (e.button !== 0) return; // only left button
          e.stopPropagation();
          const rawCaretOffset = rawSourceOffsetFromPoint(td, e);
          const startX = e.clientX;
          const startY = e.clientY;
          cellMouseMoved = false;
          cellTextSelectionDrag = false;
          clearSelection();

          // Prepare range selection but don't render until mouse moves to a different cell
          clearRangeSelection();
          acquireEditingLock("range");
          cellMouseDown = true;
          rangeStart = { row: cellRow, col: cellCol };
          rangeEnd = { row: cellRow, col: cellCol };
          const onCellMouseMove = (me: MouseEvent): void => {
            const target = cellAtPoint(me.clientX, me.clientY);
            if (target && (target.row !== rangeStart!.row || target.col !== rangeStart!.col)) {
              me.preventDefault();
              clearNativeTextSelection();
              cellTextSelectionDrag = false;
              cellMouseMoved = true;
              isRangeSelecting = true;
              rangeEnd = target;
              renderRangeSelection();
              return;
            }
            if (target && Math.hypot(me.clientX - startX, me.clientY - startY) > TEXT_SELECTION_DRAG_THRESHOLD_PX) {
              cellTextSelectionDrag = true;
            }
          };
          const onCellMouseUp = (): void => {
            document.removeEventListener("mousemove", onCellMouseMove);
            document.removeEventListener("mouseup", onCellMouseUp);
            cellMouseDown = false;
            isRangeSelecting = false;

            const range = getNormalizedRange();
            if (cellTextSelectionDrag || hasNativeTextSelectionInCell(td)) {
              clearRangeSelection();
              return;
            }
            if (!cellMouseMoved || (range && range.r1 === range.r2 && range.c1 === range.c2)) {
              // Single cell click — activate editing
              clearRangeSelection();
              activateCellEditing();
              if (rawCaretOffset !== null) {
                placeRawSourceCaret(td, rawCaretOffset);
                window.setTimeout(() => {
                  if (td.contentEditable === "true") {
                    placeRawSourceCaret(td, rawCaretOffset);
                  }
                }, 0);
              }
            } else {
              // Multi-cell range selected — keep range visible, focus wrapper for key events
              rangeActive = true;
              wrapper.focus({ preventScroll: true });
            }
          };
          document.addEventListener("mousemove", onCellMouseMove);
          document.addEventListener("mouseup", onCellMouseUp);
        });

        td.addEventListener("focus", () => {
          acquireEditingLock("focus");
          clearRangeSelection();
          enterRawEditingMode();
        });
        td.addEventListener("blur", () => {
          releaseEditingLock("focus");
          td.contentEditable = "false";
          // Restore default text-flow + width rules — we set them on
          // focus to keep the column from jumping. Rich-rendered content
          // reads better with default whitespace handling and lets the
          // column re-flow naturally now that no cell is in raw-source
          // mode.
          td.style.wordBreak = "";
          td.style.whiteSpace = "";
          td.style.maxWidth = "";
          td.style.width = "";

          // Restore rich render immediately so the user sees the rendered
          // DOM (links / bold / inline images) without waiting for a
          // follow-up CM6 transaction. This matters for two reasons:
          //
          // 1. The EditableTableWidget's eq() returns true when `source`
          //    matches — i.e. when the user clicked-and-blurred without
          //    editing — so CM6 REUSES the existing DOM and never calls
          //    toDOM() again to rebuild the rich cell content.
          // 2. Even when the user edited (source changed), CM6 needs a
          //    follow-up tr.selection / tr.docChanged after blur to fire
          //    the StateField rebuild. If the next click lands inside
          //    another swallowing widget, no transaction fires, and the
          //    cell stays in raw-source mode.
          if (astCell && Array.isArray(astCell.children) && astCell.children.length > 0) {
            renderCellRich(td, astCell, self.tableFrom, rawSourceStart, self.viewRef.current?.state ?? null);
          } else {
            td.textContent = td.dataset.source ?? "";
          }

          // For the edited-then-blurred case, queue a no-op selection
          // dispatch so the live-preview StateField rebuilds the widget
          // with the up-to-date AST. `queueMicrotask` lets the blur
          // settle before we re-enter CM6.
          queueMicrotask(() => {
            // 方向键在单元格间导航时，跳过这个 selection 派发：它会把焦点/光标抢回
            // CM 文档选区（常是第 0 行），让光标"飞到第一行"而非落在目标单元格。
            if (navigatingBetweenCells) {
              tableNavDebug("blur-dispatch:skipped (navigating)");
              return;
            }
            const v = self.viewRef.current;
            if (!v) return;
            const sel = v.state.selection.main;
            tableNavDebug("blur-dispatch:run", { anchor: sel.anchor, active: describeActiveCell() });
            try {
              v.dispatch({ selection: { anchor: sel.anchor, head: sel.head } });
            } catch {
              // ignore — view may have been destroyed during the microtask.
            }
          });
        });

        td.addEventListener("input", () => {
          const v = self.viewRef.current;
          if (!v || sourceLineIdx === undefined) return;
          // The currently edited cell holds the user's in-progress text; sync
          // its dataset.source so we read a coherent set of values below.
          td.dataset.source = td.textContent ?? "";
          const vals: string[] = [];
          tr.querySelectorAll<HTMLElement>(".nexus-cell").forEach((el) => {
            // Use dataset.source as the authoritative source for every cell.
            // Untouched cells still display rich DOM (links, bold) — reading
            // their textContent would strip URLs and lose inline markdown.
            vals.push(el.dataset.source ?? el.textContent ?? "");
          });
          const newLine = "| " + vals.join(" | ") + " |";
          let off = self.tableFrom;
          for (let i = 0; i < sourceLineIdx; i++) off += sourceLines[i].length + 1;
          const end = off + sourceLines[sourceLineIdx].length;
          sourceLines[sourceLineIdx] = newLine;
          v.dispatch({ changes: { from: off, to: end, insert: newLine } });
        });

        td.addEventListener("keydown", (e) => {
          if (e.key === "Tab") {
            e.preventDefault();
            const all = table.querySelectorAll<HTMLElement>(".nexus-cell");
            const idx = Array.from(all).indexOf(td);
            const next = e.shiftKey ? idx - 1 : idx + 1;
            const target = next >= 0 && next < all.length ? all[next] : null;
            if (target) focusCellForNavigation(target, e.shiftKey ? "end" : "start");
            return;
          }

          // 方向键在单元格之间移动（电子表格式）；边界外不消费，交回默认。
          if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
            if (navigateFromCell(e.key, td, cellRow, cellCol)) {
              e.preventDefault();
              return;
            }
          }

          // Forward editor-level shortcuts to CM6's keymap. The cell is
          // contentEditable + the widget has `ignoreEvent: true`, so
          // without this CM6 never sees the event and shortcuts like
          // Mod-F (open search) silently fail inside table cells.
          //
          // Allow standard text-editing shortcuts (copy / paste / cut /
          // select-all / undo / redo) to fall through to the browser's
          // native contentEditable handling — they target the cell text,
          // not the whole document.
          const isMod = e.metaKey || e.ctrlKey;
          if (!isMod) return;
          const passthrough = new Set(["c", "v", "x", "a", "z", "y", "C", "V", "X", "A", "Z", "Y"]);
          if (passthrough.has(e.key)) return;
          const v = self.viewRef.current;
          if (!v) return;
          if (runScopeHandlers(v, e, "editor")) {
            e.preventDefault();
          }
        });

        tr.appendChild(td);
      }

      tr.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const clickedCell = (e.target as HTMLElement).closest("th,td") as HTMLElement | null;
        let clickedCol = 0;
        if (clickedCell) {
          const cells = Array.from(tr.querySelectorAll("th,td"));
          const cellIdx = cells.indexOf(clickedCell);
          clickedCol = Math.max(0, cellIdx - 1);
        }
        showContextMenu(e.clientX, e.clientY, self, self.labels, curRowIdx, isHeader, clickedCol, colCount, rows.length, wrapper);
      });

      table.appendChild(tr);
      rowIdx++;
    }

    wrapper.appendChild(table);

    // Re-apply column widths the user previously set via drag (keyed by
    // header line in `tableColumnWidths`). Done after the rows are
    // mounted so colgroup + the widths take effect on the actual DOM.
    const savedWidths = tableColumnWidths.get(widthKey);
    if (savedWidths && savedWidths.length === colCount + 1) {
      applyColumnWidths(savedWidths);
    }

    // ── "+" buttons ──
    const btnCss = "position:absolute;width:20px;height:20px;border:1px solid var(--nexus-border-subtle);" +
      "border-radius:50%;background:var(--nexus-bg);cursor:pointer;font-size:14px;line-height:1;" +
      "display:flex;align-items:center;justify-content:center;color:var(--nexus-text-muted);padding:0;" +
      "opacity:0;transition:opacity .15s;z-index:1;";

    const addCol = document.createElement("button");
    addCol.textContent = "+";
    addCol.title = self.labels.addColumn;
    addCol.style.cssText = btnCss + "right:-24px;top:50%;transform:translateY(-50%);";
    addCol.addEventListener("click", () => self.addColumn());
    wrapper.appendChild(addCol);

    const addRow = document.createElement("button");
    addRow.textContent = "+";
    addRow.title = self.labels.addRow;
    addRow.style.cssText = btnCss + "bottom:-24px;left:50%;transform:translateX(-50%);";
    addRow.addEventListener("click", () => self.addRow());
    wrapper.appendChild(addRow);

    // ── Per-element hover (suppressed during drag) ──
    function isDragging(): boolean { return draggingCol >= 0 || draggingRow >= 0; }

    const headerTr = table.querySelectorAll("tr")[1] as HTMLElement | undefined;
    gripRow.addEventListener("mouseenter", () => { if (!isDragging()) gripRow.style.opacity = "1"; });
    gripRow.addEventListener("mouseleave", () => { if (!isDragging()) gripRow.style.opacity = "0"; });
    if (headerTr) {
      headerTr.addEventListener("mouseenter", () => { if (!isDragging()) gripRow.style.opacity = "1"; });
      headerTr.addEventListener("mouseleave", () => { if (!isDragging()) gripRow.style.opacity = "0"; });
    }

    table.querySelectorAll("tr").forEach((tr, trIdx) => {
      if (trIdx === 0) return;
      const grip = tr.querySelector(".nexus-row-grip") as HTMLElement | null;
      if (!grip) return;
      tr.addEventListener("mouseenter", () => { if (!isDragging()) grip.style.opacity = "1"; });
      tr.addEventListener("mouseleave", () => { if (!isDragging()) grip.style.opacity = "0"; });
    });

    addCol.addEventListener("mouseenter", () => { if (!isDragging()) addCol.style.opacity = "1"; });
    addCol.addEventListener("mouseleave", () => { if (!isDragging()) addCol.style.opacity = "0"; });
    table.querySelectorAll("tr").forEach((tr, trIdx) => {
      if (trIdx === 0) return;
      const cells = tr.querySelectorAll("th,td");
      const lastCell = cells[cells.length - 1] as HTMLElement | null;
      if (lastCell) {
        lastCell.addEventListener("mouseenter", () => { if (!isDragging()) addCol.style.opacity = "1"; });
        lastCell.addEventListener("mouseleave", () => { if (!isDragging()) addCol.style.opacity = "0"; });
      }
    });

    addRow.addEventListener("mouseenter", () => { addRow.style.opacity = "1"; });
    addRow.addEventListener("mouseleave", () => { addRow.style.opacity = "0"; });
    const allDataRows = Array.from(table.querySelectorAll("tr")).filter((_, i) => i > 0);
    const lastDataRow = allDataRows[allDataRows.length - 1] as HTMLElement | undefined;
    if (lastDataRow) {
      lastDataRow.addEventListener("mouseenter", () => { addRow.style.opacity = "1"; });
      lastDataRow.addEventListener("mouseleave", () => { addRow.style.opacity = "0"; });
    }

    wrapper.addEventListener("click", (e) => {
      // Skip if a range drag just completed (this click is the tail of that drag)
      if (rangeActive) return;
      if (!(e.target as HTMLElement).closest(".nexus-cell") &&
          !(e.target as HTMLElement).closest(".nexus-row-grip") &&
          !(e.target as HTMLElement).closest(".nexus-col-grip")) {
        clearSelection();
        clearRangeSelection();
      }
    });

    // Click outside table clears all selection
    const onDocMouseDown = (e: MouseEvent): void => {
      if (!wrapper.isConnected) { document.removeEventListener("mousedown", onDocMouseDown); return; }
      if (!wrapper.contains(e.target as Node)) {
        clearSelection();
        clearRangeSelection();
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);

    wrapper.addEventListener("keydown", (e) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        // Range selection: clear cell contents in selected range
        const range = getNormalizedRange();
        if (range) {
          e.preventDefault();
          const lines = self.source.split("\n");
          const dl: number[] = [];
          for (let i = 0; i < lines.length; i++) if (!SEPARATOR_RE.test(lines[i])) dl.push(i);
          for (let r = range.r1; r <= range.r2; r++) {
            const lineIdx = dl[r];
            if (lineIdx === undefined) continue;
            const cells = lines[lineIdx].split("|").filter((_, i, a) => i > 0 && i < a.length - 1);
            for (let c = range.c1; c <= range.c2; c++) {
              if (c < cells.length) cells[c] = "  ";
            }
            lines[lineIdx] = "|" + cells.join("|") + "|";
          }
          self.dispatch(lines.join("\n"));
          clearRangeSelection();
          return;
        }
        // Column/row grip selection: delete column/row
        if (selectedCol >= 0) {
          e.preventDefault();
          self.deleteColumn(selectedCol);
        } else if (selectedRow >= 0) {
          e.preventDefault();
          self.deleteRow(selectedRow);
        }
      }
    });
    wrapper.addEventListener("copy", (e) => {
      const range = selectedCopyRange();
      if (!range) return;
      const text = serializeRangeSelection(range);
      if (!text) return;
      e.clipboardData?.setData("text/plain", text);
      e.preventDefault();
    });
    wrapper.tabIndex = -1;
    wrapper.style.outline = "none";

    return wrapper;
  }
}

function showContextMenu(
  x: number, y: number,
  widget: EditableTableWidget,
  labels: Required<LivePreviewLabels>,
  rowIdx: number, isHeader: boolean,
  colIdx: number, colCount: number, rowCount: number,
  container: HTMLElement
): void {
  const ownerDocument = container.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  const fullscreenEl = ownerDocument.fullscreenElement as HTMLElement | null;
  const mountTarget: HTMLElement =
    fullscreenEl && fullscreenEl.contains(container) ? fullscreenEl : ownerDocument.body;
  mountTarget.querySelector(".nexus-table-ctx")?.remove();

  const menu = ownerDocument.createElement("div");
  const menuBg = "var(--nexus-menu-bg, var(--nexus-bg, #ffffff))";
  const menuText = "var(--nexus-menu-text, var(--nexus-text, #111827))";
  const menuBorder = "var(--nexus-menu-border, var(--nexus-border-subtle, rgba(15,23,42,.14)))";
  const itemHoverBg = "var(--nexus-menu-hover-bg, var(--nexus-bg-muted, rgba(124,108,250,.10)))";
  const disabledText = "var(--nexus-menu-disabled-text, var(--nexus-text-faint, rgba(17,24,39,.42)))";
  menu.className = "nexus-table-ctx";
  menu.setAttribute("role", "menu");
  menu.style.cssText =
    `position:fixed;z-index:9999;box-sizing:border-box;display:flex;flex-direction:column;gap:2px;background:${menuBg};` +
    `color:${menuText};border:1px solid ${menuBorder};border-radius:10px;` +
    "box-shadow:0 18px 42px rgba(15,23,42,.18);padding:6px;min-width:180px;font-size:13px;line-height:1.4;" +
    "backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);";
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  menu.addEventListener("contextmenu", (event) => event.preventDefault());

  function addItem(label: string, action: () => void, disabled = false): void {
    const item = ownerDocument.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.textContent = label;
    item.style.cssText =
      "box-sizing:border-box;width:100%;border:0;border-radius:8px;background:transparent;color:inherit;display:block;" +
      "font:inherit;text-align:left;padding:7px 12px;cursor:pointer;white-space:nowrap;";
    if (disabled) {
      item.disabled = true;
      item.setAttribute("aria-disabled", "true");
      item.style.color = disabledText;
      item.style.cursor = "default";
    } else {
      item.addEventListener("mouseenter", () => { item.style.background = itemHoverBg; });
      item.addEventListener("mouseleave", () => { item.style.background = ""; });
      item.addEventListener("click", () => { cleanup(); action(); });
    }
    menu.appendChild(item);
  }

  if (!isHeader) {
    addItem(labels.deleteRow, () => (widget as any).deleteRow(rowIdx));
  }
  addItem(labels.deleteColumn, () => (widget as any).deleteColumn(colIdx), colCount <= 1);
  addItem(labels.insertRowBelow, () => (widget as any).addRow());
  addItem(labels.insertColumnAfter, () => (widget as any).addColumn());

  mountTarget.appendChild(menu);

  const viewportWidth = ownerWindow?.innerWidth ?? ownerDocument.documentElement.clientWidth;
  const viewportHeight = ownerWindow?.innerHeight ?? ownerDocument.documentElement.clientHeight;
  const rect = menu.getBoundingClientRect();
  const margin = 8;
  if (rect.right > viewportWidth - margin) {
    menu.style.left = Math.max(margin, x - rect.width) + "px";
  }
  if (rect.bottom > viewportHeight - margin) {
    menu.style.top = Math.max(margin, y - rect.height) + "px";
  }

  function cleanup(): void {
    menu.remove();
    ownerDocument.removeEventListener("mousedown", close);
  }

  function close(e: MouseEvent): void {
    if (!menu.contains(e.target as Node)) {
      cleanup();
    }
  }
  setTimeout(() => ownerDocument.addEventListener("mousedown", close), 0);
}
