     1|import { EditorView, WidgetType, runScopeHandlers } from "@codemirror/view";
     2|import { Transaction } from "@codemirror/state";
     3|import type { Table } from "mdast";
     4|
     5|import type { InteractionGuardType, LivePreviewLabels, WidgetRenderContext } from "./types";
     6|import { globalGuardState } from "./widget-extension";
     7|
     8|let tableEditingCount = 0;
     9|
    10|export function isTableEditing(): boolean {
    11|  return tableEditingCount > 0;
    12|}
    13|
    14|const SEPARATOR_RE = /^\|?\s*[-:]+\s*(\|\s*[-:]+\s*)*\|?\s*$/;
    15|
    16|// Session-scoped store of user-customised column widths. Keyed by the
    17|// table's header line (e.g. `| 头像 | 用户名 | 主页 |`) so widths survive
    18|// the widget being rebuilt across edits as long as the header doesn't
    19|// change. Not persisted across reloads — markdown tables don't have a
    20|// place to store column widths and we don't want to write sidecar files
    21|// for this. Values: [rowGripWidth, ...dataColumnWidths].
    22|const tableColumnWidths = new Map<string, number[]>();
    23|
    24|const ROW_GRIP_WIDTH = 16;
    25|const MIN_COLUMN_WIDTH = 48;
    26|const renderedSourceOffsets = new WeakMap<Node, { start: number; end: number }>();
    27|
    28|function getNodeSourceOffsets(node: any, tableFrom: number, rawSourceStart: number, inlineCode = false): { start: number; end: number } | null {
    29|  const startOffset = node?.position?.start?.offset;
    30|  const endOffset = node?.position?.end?.offset;
    31|  if (typeof startOffset !== "number" || typeof endOffset !== "number") return null;
    32|  const markerOffset = inlineCode ? 1 : 0;
    33|  return {
    34|    start: startOffset - tableFrom - rawSourceStart + markerOffset,
    35|    end: endOffset - tableFrom - rawSourceStart - markerOffset,
    36|  };
    37|}
    38|
    39|function findFirstMappedSourceOffset(node: Node): number | null {
    40|  const own = renderedSourceOffsets.get(node);
    41|  if (own) return own.start;
    42|  for (const child of Array.from(node.childNodes)) {
    43|    const mapped = findFirstMappedSourceOffset(child);
    44|    if (mapped !== null) return mapped;
    45|  }
    46|  return null;
    47|}
    48|
    49|function findLastMappedSourceOffset(node: Node): number | null {
    50|  const own = renderedSourceOffsets.get(node);
    51|  if (own) return own.end;
    52|  const children = Array.from(node.childNodes);
    53|  for (let i = children.length - 1; i >= 0; i--) {
    54|    const mapped = findLastMappedSourceOffset(children[i]);
    55|    if (mapped !== null) return mapped;
    56|  }
    57|  return null;
    58|}
    59|
    60|function rawSourceOffsetFromCaret(container: Node, offset: number): number | null {
    61|  const own = renderedSourceOffsets.get(container);
    62|  if (own) return Math.max(own.start, Math.min(own.start + offset, own.end));
    63|  const children = Array.from(container.childNodes);
    64|  if (offset > 0) {
    65|    const previous = children[offset - 1];
    66|    if (previous) {
    67|      const mapped = findLastMappedSourceOffset(previous);
    68|      if (mapped !== null) return mapped;
    69|    }
    70|  }
    71|  const next = children[offset];
    72|  if (next) {
    73|    const mapped = findFirstMappedSourceOffset(next);
    74|    if (mapped !== null) return mapped;
    75|  }
    76|  return null;
    77|}
    78|
    79|function rawSourceOffsetFromPoint(td: HTMLElement, event: MouseEvent): number | null {
    80|  const doc = td.ownerDocument as Document & {
    81|    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    82|    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    83|  };
    84|  const position = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
    85|  if (position && td.contains(position.offsetNode)) {
    86|    return rawSourceOffsetFromCaret(position.offsetNode, position.offset);
    87|  }
    88|  const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
    89|  if (range && td.contains(range.startContainer)) {
    90|    return rawSourceOffsetFromCaret(range.startContainer, range.startOffset);
    91|  }
    92|  return null;
    93|}
    94|
    95|function placeRawSourceCaret(td: HTMLElement, rawOffset: number): void {
    96|  const text = td.firstChild;
    97|  if (!text || text.nodeType !== Node.TEXT_NODE) return;
    98|  const offset = Math.max(0, Math.min(rawOffset, text.textContent?.length ?? 0));
    99|  const range = td.ownerDocument.createRange();
   100|  range.setStart(text, offset);
   101|  range.collapse(true);
   102|  const selection = td.ownerDocument.getSelection();
   103|  selection?.removeAllRanges();
   104|  selection?.addRange(range);
   105|}
   106|
   107|function extractCellText(cell: any): string {
   108|  if (!cell || !("children" in cell) || !Array.isArray(cell.children)) return "";
   109|  return cell.children
   110|    .map((c: any) => {
   111|      if ("value" in c && typeof c.value === "string") return c.value;
   112|      if ("children" in c && Array.isArray(c.children))
   113|        return c.children.map((n: any) => ("value" in n ? n.value : "")).join("");
   114|      return "";
   115|    })
   116|    .join("");
   117|}
   118|
   119|/**
   120| * Render an inline mdast node into DOM. Supports the inline subset that
   121| * appears inside table cells: text, link, strong, emphasis, delete,
   122| * inlineCode. Anything else falls back to its text representation so the
   123| * user still sees content (just unstyled).
   124| */
   125|/**
   126| * A cell is "media-only" when its visible content is a single image
   127| * (optionally wrapped in a link). Whitespace-only text siblings are
   128| * ignored. Media-only cells render the image scaled to the cell width
   129| * so the user can grow / shrink the image by resizing the column.
   130| */
   131|function isCellMediaOnly(astCell: any): boolean {
   132|  if (!astCell || !Array.isArray(astCell.children)) return false;
   133|  const meaningful = astCell.children.filter((c: any) => {
   134|    if (!c) return false;
   135|    if (c.type === "text") return typeof c.value === "string" && c.value.trim() !== "";
   136|    return true;
   137|  });
   138|  if (meaningful.length !== 1) return false;
   139|  const only = meaningful[0];
   140|  if (only.type === "image") return true;
   141|  if (only.type === "link" && Array.isArray(only.children)) {
   142|    const linkInner = only.children.filter((c: any) => {
   143|      if (!c) return false;
   144|      if (c.type === "text") return typeof c.value === "string" && c.value.trim() !== "";
   145|      return true;
   146|    });
   147|    return linkInner.length === 1 && linkInner[0].type === "image";
   148|  }
   149|  return false;
   150|}
   151|
   152|function renderInlineMdast(node: any, mediaOnly = false, tableFrom = 0, rawSourceStart = 0): Node {
   153|  if (!node) return document.createTextNode("");
   154|  switch (node.type) {
   155|    case "text": {
   156|      const text = document.createTextNode(typeof node.value === "string" ? node.value : "");
   157|      const sourceOffsets = getNodeSourceOffsets(node, tableFrom, rawSourceStart);
   158|      if (sourceOffsets) renderedSourceOffsets.set(text, sourceOffsets);
   159|      return text;
   160|    }
   161|    case "link": {
   162|      const a = document.createElement("a");
   163|      a.href = typeof node.url === "string" ? node.url : "#";
   164|      a.target = "_blank";
   165|      a.rel = "noopener noreferrer";
   166|      a.style.cssText =
   167|        "color:var(--nexus-accent);text-decoration:underline;cursor:pointer;";
   168|      // Stop CM6's editor-level mousedown handler from reading this as a
   169|      // cursor-placement click — we want the browser's native link click
   170|      // to win so the user can ⌘-click open in a new tab.
   171|      a.addEventListener("mousedown", (e) => e.stopPropagation());
   172|      if (mediaOnly) {
   173|        // Let the wrapped <img> grow with the cell without the anchor
   174|        // adding extra inline-baseline whitespace around it.
   175|        a.style.display = "block";
   176|        a.style.lineHeight = "0";
   177|      }
   178|      for (const child of node.children ?? []) a.appendChild(renderInlineMdast(child, mediaOnly, tableFrom, rawSourceStart));
   179|      return a;
   180|    }
   181|    case "strong": {
   182|      const el = document.createElement("strong");
   183|      for (const child of node.children ?? []) el.appendChild(renderInlineMdast(child, false, tableFrom, rawSourceStart));
   184|      return el;
   185|    }
   186|    case "emphasis": {
   187|      const el = document.createElement("em");
   188|      for (const child of node.children ?? []) el.appendChild(renderInlineMdast(child, false, tableFrom, rawSourceStart));
   189|      return el;
   190|    }
   191|    case "delete": {
   192|      const el = document.createElement("del");
   193|      for (const child of node.children ?? []) el.appendChild(renderInlineMdast(child, false, tableFrom, rawSourceStart));
   194|      return el;
   195|    }
   196|    case "inlineCode": {
   197|      const el = document.createElement("code");
   198|      const text = document.createTextNode(typeof node.value === "string" ? node.value : "");
   199|      const sourceOffsets = getNodeSourceOffsets(node, tableFrom, rawSourceStart, true);
   200|      if (sourceOffsets) renderedSourceOffsets.set(text, sourceOffsets);
   201|      el.appendChild(text);
   202|      el.style.cssText =
   203|        "background:var(--nexus-bg-muted);padding:1px 4px;border-radius:3px;font-family:monospace;";
   204|      return el;
   205|    }
   206|    case "image": {
   207|      const img = document.createElement("img");
   208|      img.src = typeof node.url === "string" ? node.url : "";
   209|      if (typeof node.alt === "string") img.alt = node.alt;
   210|      if (typeof node.title === "string") img.title = node.title;
   211|      // Two sizing modes:
   212|      //   - Inline image (text + image in same cell): cap to ~1 line of
   213|      //     text so the image doesn't bloat the row height.
   214|      //   - Media-only cell: grow with cell width so resizing the column
   215|      //     resizes the image. max-height keeps a sane upper bound to
   216|      //     stop huge images from forcing a 1000-px-tall row.
   217|      const styles = mediaOnly
   218|        ? [
   219|            "display:block",
   220|            "width:100%",
   221|            "max-width:100%",
   222|            "height:auto",
   223|            "max-height:240px",
   224|            "min-height:32px",
   225|            "border-radius:3px",
   226|            "background:var(--nexus-bg-muted)",
   227|            "border:1px solid var(--nexus-border-subtle)",
   228|            "object-fit:contain",
   229|          ]
   230|        : [
   231|            "max-height:1.6em",
   232|            "min-height:1.6em",
   233|            "min-width:1.6em",
   234|            "max-width:160px",
   235|            "vertical-align:middle",
   236|            "border-radius:3px",
   237|            "background:var(--nexus-bg-muted)",
   238|            "border:1px solid var(--nexus-border-subtle)",
   239|            "object-fit:contain",
   240|          ];
   241|      img.style.cssText = styles.join(";") + ";";
   242|      // Stop CM6's cell mousedown handler from intercepting clicks on the
   243|      // image (otherwise ⌘-clicking the image to open the link wouldn't
   244|      // work, and a plain click would unexpectedly enter cell-edit mode).
   245|      img.addEventListener("mousedown", (e) => e.stopPropagation());
   246|      return img;
   247|    }
   248|    default: {
   249|      if (Array.isArray(node.children)) {
   250|        const frag = document.createDocumentFragment();
   251|        for (const child of node.children) frag.appendChild(renderInlineMdast(child, false, tableFrom, rawSourceStart));
   252|        return frag;
   253|      }
   254|      const text = document.createTextNode(typeof node.value === "string" ? node.value : "");
   255|      const sourceOffsets = getNodeSourceOffsets(node, tableFrom, rawSourceStart);
   256|      if (sourceOffsets) renderedSourceOffsets.set(text, sourceOffsets);
   257|      return text;
   258|    }
   259|  }
   260|}
   261|
   262|function renderCellRich(td: HTMLElement, astCell: any, tableFrom = 0, rawSourceStart = 0): void {
   263|  td.textContent = "";
   264|  if (!astCell || !Array.isArray(astCell.children)) return;
   265|  const mediaOnly = isCellMediaOnly(astCell);
   266|  for (const child of astCell.children) td.appendChild(renderInlineMdast(child, mediaOnly, tableFrom, rawSourceStart));
   267|}
   268|
   269|const GRIP_BG = "var(--nexus-bg-muted)";
   270|const GRIP_BG_HOVER = "var(--nexus-border)";
   271|const SELECT_BG = "rgba(124, 108, 250, 0.12)";
   272|const SELECT_BORDER = "var(--nexus-accent)";
   273|const DRAG_HIGHLIGHT_BG = "rgba(124, 108, 250, 0.08)";
   274|
   275|export class EditableTableWidget extends WidgetType {
   276|  private static idCounter = 0;
   277|  readonly widgetId = `table-${++EditableTableWidget.idCounter}`;
   278|  private editing = false;
   279|  private cleanupEditingLocks: (() => void) | null = null;
   280|
   281|  constructor(
   282|    private node: Table,
   283|    private tableFrom: number,
   284|    private source: string,
   285|    private viewRef: { current: EditorView | null },
   286|    private labels: Required<LivePreviewLabels>
   287|  ) { super(); }
   288|
   289|  eq(other: EditableTableWidget): boolean {
   290|    if (this.editing || globalGuardState.hasGuard(this.widgetId)) return true;
   291|    return this.source === other.source;
   292|  }
   293|
   294|  ignoreEvent(): boolean { return true; }
   295|
   296|  destroy(): void {
   297|    this.cleanupEditingLocks?.();
   298|    this.cleanupEditingLocks = null;
   299|    globalGuardState.releaseAll(this.widgetId);
   300|  }
   301|
   302|  get estimatedHeight(): number {
   303|    const rows = this.node.children?.length ?? 1;
   304|    // rows × ~32px (cell padding + text) + 16px wrapper padding (8px top + 8px bottom)
   305|    return rows * 32 + 16;
   306|  }
   307|
   308|  private dispatch(newSource: string): void {
   309|    const v = this.viewRef.current;
   310|    if (!v) return;
   311|    v.dispatch({ changes: { from: this.tableFrom, to: this.tableFrom + this.source.length, insert: newSource } });
   312|  }
   313|
   314|  private deleteColumn(colIdx: number): void {
   315|    const lines = this.source.split("\n");
   316|    const newLines = lines.map((line) => {
   317|      const cells = line.split("|").filter((_, i, a) => i > 0 && i < a.length - 1);
   318|      if (cells.length === 0) return line;
   319|      cells.splice(colIdx, 1);
   320|      return "|" + cells.join("|") + "|";
   321|    });
   322|    this.dispatch(newLines.join("\n"));
   323|  }
   324|
   325|  private deleteRow(rowIdx: number): void {
   326|    const lines = this.source.split("\n");
   327|    const dataLines: number[] = [];
   328|    for (let i = 0; i < lines.length; i++) if (!SEPARATOR_RE.test(lines[i])) dataLines.push(i);
   329|    const lineIdx = dataLines[rowIdx];
   330|    if (lineIdx === undefined) return;
   331|    lines.splice(lineIdx, 1);
   332|    this.dispatch(lines.join("\n"));
   333|  }
   334|
   335|  private addColumn(): void {
   336|    const lines = this.source.split("\n");
   337|    const nl = lines.map((l) => SEPARATOR_RE.test(l) ? l.replace(/\|?\s*$/, " | --- |") : l.replace(/\|?\s*$/, " |  |"));
   338|    this.dispatch(nl.join("\n"));
   339|  }
   340|
   341|  private addRow(): void {
   342|    const cc = (this.node.children?.[0] as any)?.children?.length ?? 2;
   343|    const nr = "\n| " + Array(cc).fill("  ").join(" | ") + " |";
   344|    const v = this.viewRef.current;
   345|    if (!v) return;
   346|    v.dispatch({ changes: { from: this.tableFrom + this.source.length, insert: nr } });
   347|  }
   348|
   349|  private moveColumn(from: number, to: number): void {
   350|    const lines = this.source.split("\n");
   351|    const nl = lines.map((line) => {
   352|      const p = line.split("|"), cells = p.slice(1, -1);
   353|      if (from >= cells.length || to >= cells.length) return line;
   354|      const [m] = cells.splice(from, 1);
   355|      cells.splice(to, 0, m);
   356|      return "|" + cells.join("|") + "|";
   357|    });
   358|    this.dispatch(nl.join("\n"));
   359|  }
   360|
   361|  private moveRow(from: number, to: number): void {
   362|    const lines = this.source.split("\n");
   363|    const dl: number[] = [];
   364|    for (let i = 0; i < lines.length; i++) if (!SEPARATOR_RE.test(lines[i])) dl.push(i);
   365|    const s = dl[from], d = dl[to];
   366|    if (s === undefined || d === undefined) return;
   367|    const [m] = lines.splice(s, 1);
   368|    lines.splice(d, 0, m);
   369|    this.dispatch(lines.join("\n"));
   370|  }
   371|
   372|  toDOM(): HTMLElement {
   373|    const self = this;
   374|    // Build a WidgetRenderContext that bridges to the global guard state so
   375|    // the StateField knows this widget is mid-interaction.
   376|    const ctx: WidgetRenderContext = {
   377|      from: this.tableFrom,
   378|      to: this.tableFrom + this.source.length,
   379|      setSelection: (anchor, head) => {
   380|        const v = self.viewRef.current;
   381|        if (!v) return;
   382|        const safeAnchor = Math.max(0, Math.min(anchor, v.state.doc.length));
   383|        const safeHead = head === undefined
   384|          ? safeAnchor
   385|          : Math.max(0, Math.min(head, v.state.doc.length));
   386|        v.dispatch({ selection: { anchor: safeAnchor, head: safeHead } });
   387|      },
   388|      focus: () => { self.viewRef.current?.focus(); },
   389|      acquireGuard: (type: InteractionGuardType) => {
   390|        globalGuardState.acquire(self.widgetId, type);
   391|      },
   392|      releaseGuard: (type: InteractionGuardType) => {
   393|        globalGuardState.release(self.widgetId, type);
   394|      },
   395|      releaseAllGuards: () => {
   396|        globalGuardState.releaseAll(self.widgetId);
   397|      },
   398|    };
   399|    const rows = this.node.children ?? [];
   400|    // Normalise irregular markdown tables: if some rows have more cells than
   401|    // the header (extra cells overflowing) or fewer (missing trailing cells),
   402|    // pick the MAX cell count seen so the rendered grid is rectangular.
   403|    // Short rows are padded with empty cells in the cell loop below; long
   404|    // rows reserve the extra slots in the header / grip row here.
   405|    let colCount = 0;
   406|    for (const row of rows) {
   407|      const len = "children" in row && Array.isArray(row.children) ? row.children.length : 0;
   408|      if (len > colCount) colCount = len;
   409|    }
   410|    const sourceLines = this.source.split("\n");
   411|    const dataLineIndices: number[] = [];
   412|    for (let i = 0; i < sourceLines.length; i++) if (!SEPARATOR_RE.test(sourceLines[i])) dataLineIndices.push(i);
   413|
   414|    // State
   415|    let selectedCol = -1;
   416|    let selectedRow = -1;
   417|
   418|    // Cell range selection (Excel-style)
   419|    let rangeStart: { row: number; col: number } | null = null;
   420|    let rangeEnd: { row: number; col: number } | null = null;
   421|    let isRangeSelecting = false;
   422|    let cellMouseDown = false; // true between mousedown and mouseup on a cell
   423|    let rangeActive = false;   // true when a multi-cell range is displayed (survives mouseup)
   424|    let cellEditRecorded = false; // true after the first keystroke in a cell edit is recorded in history
   425|
   426|    // Custom drag state (no HTML5 drag API)
   427|    let draggingCol = -1;   // which column is being dragged
   428|    let draggingRow = -1;   // which row is being dragged
   429|    let dropTargetCol = -1;
   430|    let dropTargetRow = -1;
   431|    const editingLocks = {
   432|      focus: false,
   433|      range: false,
   434|      drag: false,
   435|    };
   436|
   437|    function hasEditingLocks(): boolean {
   438|      return editingLocks.focus || editingLocks.range || editingLocks.drag;
   439|    }
   440|
   441|    function acquireEditingLock(lock: keyof typeof editingLocks): void {
   442|      if (editingLocks[lock]) return;
   443|      editingLocks[lock] = true;
   444|      self.editing = true;
   445|      tableEditingCount++;
   446|      ctx.acquireGuard(lock as InteractionGuardType);
   447|    }
   448|
   449|    function releaseEditingLock(lock: keyof typeof editingLocks): void {
   450|      if (!editingLocks[lock]) return;
   451|      editingLocks[lock] = false;
   452|      tableEditingCount = Math.max(0, tableEditingCount - 1);
   453|      self.editing = hasEditingLocks();
   454|      ctx.releaseGuard(lock as InteractionGuardType);
   455|    }
   456|
   457|    this.cleanupEditingLocks = () => {
   458|      releaseEditingLock("focus");
   459|      releaseEditingLock("range");
   460|      releaseEditingLock("drag");
   461|      ctx.releaseAllGuards();
   462|    };
   463|
   464|    function blurActiveCellForDrag(): void {
   465|      const active = document.activeElement;
   466|      if (!(active instanceof HTMLElement) || !wrapper.contains(active) || !active.classList.contains("nexus-cell")) return;
   467|      active.blur();
   468|      releaseEditingLock("focus");
   469|      active.contentEditable = "false";
   470|    }
   471|
   472|    // ── Root wrapper ──
   473|    const wrapper = document.createElement("div");
   474|    wrapper.className = "nexus-table-wrapper";
   475|    // CRITICAL: use padding, not margin. CM6 measures block widget height via
   476|    // getBoundingClientRect which EXCLUDES margin. margin:8px caused 16px of
   477|    // untracked height per table → cumulative click-drift below every table.
   478|    wrapper.style.cssText = "display:inline-block;position:relative;padding:8px 0;user-select:none;";
   479|
   480|    // ── Table ──
   481|    const table = document.createElement("table");
   482|    table.setAttribute("role", "grid");
   483|    table.setAttribute("aria-label", "Editable table");
   484|    table.style.cssText = "border-collapse:collapse;display:table;";
   485|    if (rows.length === 0) { wrapper.appendChild(table); return wrapper; }
   486|
   487|    // ── Column-width persistence ──
   488|    // Keyed by the table's header source line so widths stick across
   489|    // widget rebuilds caused by editing other cells.
   490|    const widthKey = sourceLines[dataLineIndices[0] ?? 0] ?? "";
   491|
   492|    /**
   493|     * Apply (or refresh) an explicit `<colgroup>` + `table-layout: fixed`
   494|     * with the given widths. `widths` is one entry per column in the
   495|     * rendered table — including the row-grip column at index 0.
   496|     */
   497|    const applyColumnWidths = (widths: number[]): void => {
   498|      let colgroup = table.querySelector(":scope > colgroup") as HTMLTableColElement | null;
   499|      if (!colgroup) {
   500|        colgroup = document.createElement("colgroup") as HTMLTableColElement;
   501|