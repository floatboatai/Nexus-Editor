// Node-side "table drag-op" bridge for the Python Eval framework.
//
// L1/L2/L3 never exercise the table widget's *column reorder* path — that only
// runs when a user drags a column grip. This bridge drives the REAL editor's
// real drag handlers (createEditor → setDocument → simulated grip drag) and
// reports the markdown before/after, so the evaluator can assert a pure column
// move preserves every row's cells and keeps all rows on the same column grid.
//
// The reorder target is derived from getBoundingClientRect, which jsdom returns
// as all-zeros — so we install a synthetic column layout (col i spans
// x∈[i*W,(i+1)*W]) on the header cells + wrapper the drag code reads, then
// dispatch mousedown(grip) → mousemove(target x) → mouseup.
//
// It does NOT modify any source; it only calls public createEditor + dispatches
// DOM events, exactly as a browser would.
import "./setup-dom";

import { createEditor } from "../../packages/core/src/editor";

for (const method of ["log", "info", "debug"] as const) {
  console[method] = () => {};
}

interface TableLayout {
  /** Visible viewport width (px). When set, simulates a table wider than the window. */
  viewportWidth?: number;
  /** Horizontal scroll offset (px) applied to column rects. */
  scrollLeft?: number;
  /** Per data-column widths (px). When omitted, derived from cell text length. */
  columnWidths?: number[];
}

interface EvalCase {
  id: string;
  input: string;
  move?: { from: number; to: number };
  tableLayout?: TableLayout;
  /** Which rendered table widget to operate on (0-based). Default 0. */
  tableIndex?: number;
}

interface TableOpResult {
  status: "ok" | "throw" | "noop";
  ms: number;
  error?: string;
  before?: string;
  after?: string;
  gripCount?: number;
  headerCellCount?: number;
  moved?: { from: number; to: number };
  tableWidth?: number;
  viewportWidth?: number;
  columnWidths?: number[];
  tableWidgetCount?: number;
  pipesNormalized?: boolean;
  nonPipeTableLines?: string[];
  secondTableUnchanged?: boolean;
  tableIndex?: number;
}

interface CaseResult {
  id: string;
  tableOp: TableOpResult;
}

const COL_W = 100;

function errText(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function fakeRect(left: number, width: number, top = 0, height = 30): DOMRect {
  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON() {},
  } as DOMRect;
}

function measureColumnWidths(table: Element): number[] {
  const rows = Array.from(table.querySelectorAll("tr")).filter((row) => row.querySelector(".nexus-cell"));
  const colCount = rows[0]?.querySelectorAll(".nexus-cell").length ?? 0;
  const widths = new Array<number>(colCount).fill(80);

  for (const row of rows) {
    const cells = row.querySelectorAll(".nexus-cell");
    cells.forEach((cell, i) => {
      const text = (cell.textContent ?? "").trim();
      const longest = text.split(/\s+/).reduce((max, token) => Math.max(max, token.length), text.length);
      const need = Math.max(80, Math.min(720, longest * 7 + 48));
      widths[i] = Math.max(widths[i], need);
    });
  }
  return widths;
}

function columnLeft(index: number, widths: number[], scrollLeft: number): number {
  let left = -scrollLeft;
  for (let i = 0; i < index; i++) left += widths[i];
  return left;
}

function columnCenter(index: number, widths: number[], scrollLeft: number): number {
  return columnLeft(index, widths, scrollLeft) + widths[index] / 2;
}

function dragClientX(
  targetIndex: number,
  widths: number[],
  scrollLeft: number,
  viewportWidth: number,
  constrainToViewport: boolean,
): number {
  const center = columnCenter(targetIndex, widths, scrollLeft);
  if (!constrainToViewport) return center;
  // Real users cannot move the pointer past the viewport's right edge. When a
  // source column is wider than the viewport, every in-viewport x still lands
  // inside that column → dropTargetCol never changes.
  return Math.min(center, Math.max(0, viewportWidth - 1));
}

// Install a synthetic horizontal layout so colAtClientX / getContentBounds can
// resolve a drop target. Returns the header cell count the drag code will see.
function stubGeometry(table: Element, wrapper: Element, layout?: TableLayout): number {
  const headerCells = table.querySelectorAll("tr:nth-child(2) .nexus-cell");
  const widths = layout?.columnWidths?.length
    ? layout.columnWidths
    : measureColumnWidths(table);
  const scrollLeft = layout?.scrollLeft ?? 0;
  const tableWidth = widths.reduce((sum, width) => sum + width, 0);
  const viewportWidth = layout?.viewportWidth ?? tableWidth;

  headerCells.forEach((cell, i) => {
    const width = widths[i] ?? COL_W;
    const left = columnLeft(i, widths, scrollLeft);
    (cell as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
      fakeRect(left, width);
  });

  const grips = table.querySelectorAll(".nexus-col-grip");
  grips.forEach((grip, i) => {
    const width = widths[i] ?? COL_W;
    const left = columnLeft(i, widths, scrollLeft);
    (grip as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
      fakeRect(left, width, -18, 12);
  });

  (wrapper as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
    fakeRect(0, viewportWidth);

  (table as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
    fakeRect(-scrollLeft, tableWidth);

  return headerCells.length;
}

function mouse(type: string, clientX: number): MouseEvent {
  return new (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY: 5,
  });
}

function extractTableBlocks(md: string): string[] {
  return md
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.includes("|"));
}

function auditLeadingPipes(md: string): { ok: boolean; offenders: string[] } {
  const offenders: string[] = [];
  for (const block of extractTableBlocks(md)) {
    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.includes("|")) continue;
      if (!trimmed.startsWith("|")) offenders.push(trimmed.slice(0, 72));
    }
  }
  return { ok: offenders.length === 0, offenders };
}

function runCase(evalCase: EvalCase): CaseResult {
  const move = evalCase.move ?? { from: 0, to: 1 };
  const tableIndex = evalCase.tableIndex ?? 0;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const start = performance.now();
  let editor: ReturnType<typeof createEditor> | null = null;

  try {
    editor = createEditor({ container, initialValue: "", livePreview: true });
    editor.setDocument(evalCase.input);
    const before = editor.getDocument();
    const beforeBlocks = extractTableBlocks(before);

    const wrappers = Array.from(container.querySelectorAll(".nexus-table-wrapper"));
    const wrapper = wrappers[tableIndex] as HTMLElement | undefined;
    const table = wrapper?.querySelector("table") ?? null;
    if (!table || !wrapper) {
      return {
        id: evalCase.id,
        tableOp: {
          status: "noop",
          ms: performance.now() - start,
          before,
          tableWidgetCount: wrappers.length,
          tableIndex,
          error: `未渲染出第 ${tableIndex} 个表格 widget（共 ${wrappers.length} 个）`,
        },
      };
    }

    const widths = evalCase.tableLayout?.columnWidths?.length
      ? evalCase.tableLayout.columnWidths
      : measureColumnWidths(table);
    const scrollLeft = evalCase.tableLayout?.scrollLeft ?? 0;
    const tableWidth = widths.reduce((sum, width) => sum + width, 0);
    const viewportWidth = evalCase.tableLayout?.viewportWidth ?? tableWidth;

    const headerCellCount = stubGeometry(table, wrapper, evalCase.tableLayout);
    const grips = table.querySelectorAll(".nexus-col-grip");
    const src = grips[move.from] as HTMLElement | undefined;
    if (!src || move.to >= grips.length) {
      return {
        id: evalCase.id,
        tableOp: {
          status: "noop",
          ms: performance.now() - start,
          before,
          gripCount: grips.length,
          headerCellCount,
          tableWidth,
          viewportWidth,
          columnWidths: widths,
          error: `列把手不足：from=${move.from} to=${move.to} grips=${grips.length}`,
        },
      };
    }

    // Real custom drag: mousedown on the source grip, mousemove into the target
    // column's x-range, mouseup — this reaches self.moveColumn(from, to).
    const constrainToViewport = Boolean(evalCase.tableLayout?.viewportWidth);
    const startX = columnCenter(move.from, widths, scrollLeft);
    const targetX = dragClientX(move.to, widths, scrollLeft, viewportWidth, constrainToViewport);
    src.dispatchEvent(mouse("mousedown", startX));
    document.dispatchEvent(mouse("mousemove", targetX));
    document.dispatchEvent(mouse("mouseup", targetX));

    const after = editor.getDocument();
    const afterBlocks = extractTableBlocks(after);
    const pipeAudit = auditLeadingPipes(after);
    const secondTableUnchanged =
      beforeBlocks.length >= 2 && afterBlocks.length >= 2
        ? beforeBlocks[1] === afterBlocks[1]
        : beforeBlocks.length < 2;

    return {
      id: evalCase.id,
      tableOp: {
        status: after === before ? "noop" : "ok",
        ms: performance.now() - start,
        before,
        after,
        gripCount: grips.length,
        headerCellCount,
        tableWidth,
        viewportWidth,
        columnWidths: widths,
        moved: move,
        tableWidgetCount: container.querySelectorAll(".nexus-table-wrapper").length,
        pipesNormalized: pipeAudit.ok,
        nonPipeTableLines: pipeAudit.offenders.slice(0, 3),
        secondTableUnchanged,
        tableIndex,
      },
    };
  } catch (err) {
    return {
      id: evalCase.id,
      tableOp: { status: "throw", ms: performance.now() - start, error: errText(err), moved: move },
    };
  } finally {
    try {
      editor?.destroy();
    } catch {
      /* ignore */
    }
    container.remove();
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  for (const line of lines) {
    const evalCase = JSON.parse(line) as EvalCase;
    const result = runCase(evalCase);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`table-ops bridge fatal: ${errText(err)}\n`);
  process.exit(1);
});
