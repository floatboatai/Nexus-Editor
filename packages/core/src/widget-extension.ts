     1|import {
     2|  type Extension,
     3|  type Range,
     4|  type SelectionRange,
     5|  StateField,
     6|  type Transaction,
     7|} from "@codemirror/state";
     8|import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
     9|import type { Content, Parent, Root } from "mdast";
    10|
    11|import type { InteractionGuardType, ParserLike, WidgetDefinition, WidgetRenderContext } from "./types";
    12|
    13|function createEmptyAst(): Root {
    14|  return { type: "root", children: [] };
    15|}
    16|
    17|function parseDocument(parser: ParserLike, markdown: string): Root {
    18|  try {
    19|    return parser.parse(markdown);
    20|  } catch {
    21|    return createEmptyAst();
    22|  }
    23|}
    24|
    25|function selectionIntersects(
    26|  from: number,
    27|  to: number,
    28|  selection: readonly SelectionRange[]
    29|): boolean {
    30|  return selection.some((range) => {
    31|    const rangeFrom = Math.min(range.anchor, range.head);
    32|    const rangeTo = Math.max(range.anchor, range.head);
    33|
    34|    if (range.empty) {
    35|      // Inclusive at `to` so clicking just after a block widget (cursor at
    36|      // the widget end) toggles into edit mode. Without this, block widgets
    37|      // like math `$$...$$` render correctly but can never be entered for
    38|      // editing — CM6's click-to-pos usually lands the cursor at the end of
    39|      // the widget range, not inside it.
    40|      return range.anchor >= from && range.anchor <= to;
    41|    }
    42|
    43|    return rangeFrom < to && from < rangeTo;
    44|  });
    45|}
    46|
    47|interface WidgetRange {
    48|  from: number;
    49|  to: number;
    50|  node: Content;
    51|  source: string;
    52|  definition: WidgetDefinition;
    53|}
    54|
    55|function collectWidgetRanges(
    56|  ast: Root,
    57|  doc: string,
    58|  selection: readonly SelectionRange[],
    59|  widgets: WidgetDefinition[]
    60|): WidgetRange[] {
    61|  const ranges: WidgetRange[] = [];
    62|
    63|  function visit(parent: Parent | Root): void {
    64|    for (const child of parent.children) {
    65|      const from = child.position?.start.offset;
    66|      const to = child.position?.end.offset;
    67|
    68|      if (typeof from === "number" && typeof to === "number") {
    69|        const matched = widgets.find(
    70|          (w) => w.nodeType === child.type && (!w.match || w.match(child))
    71|        );
    72|
    73|        if (matched && !selectionIntersects(from, to, selection)) {
    74|          ranges.push({
    75|            from,
    76|            to,
    77|            node: child,
    78|            source: doc.slice(from, to),
    79|            definition: matched,
    80|          });
    81|          continue;
    82|        }
    83|      }
    84|
    85|      if ("children" in child && Array.isArray(child.children)) {
    86|        visit(child as Parent);
    87|      }
    88|    }
    89|  }
    90|
    91|  visit(ast);
    92|  return ranges.sort((a, b) => a.from - b.from);
    93|}
    94|
    95|/**
    96| * Tracks active interaction guards across all widget instances.
    97| * When any guard is active, the widget StateField skips decoration
    98| * rebuilds and uses `decos.map(tr.changes)` instead.
    99| */
   100|export class WidgetGuardState {
   101|  private guards = new Map<string, Set<InteractionGuardType>>();
   102|
   103|  acquire(widgetId: string, type: InteractionGuardType): void {
   104|    let set = this.guards.get(widgetId);
   105|    if (!set) {
   106|      set = new Set();
   107|      this.guards.set(widgetId, set);
   108|    }
   109|    set.add(type);
   110|  }
   111|
   112|  release(widgetId: string, type: InteractionGuardType): void {
   113|    const set = this.guards.get(widgetId);
   114|    if (set) {
   115|      set.delete(type);
   116|      if (set.size === 0) {
   117|        this.guards.delete(widgetId);
   118|      }
   119|    }
   120|  }
   121|
   122|  releaseAll(widgetId: string): void {
   123|    this.guards.delete(widgetId);
   124|  }
   125|
   126|  hasActiveGuards(): boolean {
   127|    return this.guards.size > 0;
   128|  }
   129|
   130|  hasGuard(widgetId: string): boolean {
   131|    const set = this.guards.get(widgetId);
   132|    return set !== undefined && set.size > 0;
   133|  }
   134|}
   135|
   136|// Singleton guard state shared across all widget instances
   137|export const globalGuardState = new WidgetGuardState();
   138|
   139|let widgetIdCounter = 0;
   140|
   141|class NexusWidget extends WidgetType {
   142|  private widgetId = `widget-${++widgetIdCounter}`;
   143|
   144|  constructor(
   145|    private definition: WidgetDefinition,
   146|    private node: Content,
   147|    private source: string,
   148|    private from: number,
   149|    private to: number,
   150|    private viewRef: { current: EditorView | null }
   151|  ) {
   152|    super();
   153|  }
   154|
   155|  eq(other: NexusWidget): boolean {
   156|    // If this widget has active guards, return true to prevent DOM recreation
   157|    if (globalGuardState.hasGuard(this.widgetId)) {
   158|      return true;
   159|    }
   160|    return (
   161|      other.definition === this.definition &&
   162|      other.from === this.from &&
   163|      other.to === this.to &&
   164|      other.source === this.source
   165|    );
   166|  }
   167|
   168|  toDOM(): HTMLElement {
   169|    const self = this;
   170|    const ctx: WidgetRenderContext = {
   171|      from: this.from,
   172|      to: this.to,
   173|      setSelection: (anchor, head) => {
   174|        const v = this.viewRef.current;
   175|        if (!v) return;
   176|        const safeAnchor = Math.max(0, Math.min(anchor, v.state.doc.length));
   177|        const safeHead = head === undefined
   178|          ? safeAnchor
   179|          : Math.max(0, Math.min(head, v.state.doc.length));
   180|        v.dispatch({ selection: { anchor: safeAnchor, head: safeHead } });
   181|      },
   182|      focus: () => {
   183|        this.viewRef.current?.focus();
   184|      },
   185|      acquireGuard: (type: InteractionGuardType) => {
   186|        globalGuardState.acquire(self.widgetId, type);
   187|      },
   188|      releaseGuard: (type: InteractionGuardType) => {
   189|        globalGuardState.release(self.widgetId, type);
   190|      },
   191|      releaseAllGuards: () => {
   192|        globalGuardState.releaseAll(self.widgetId);
   193|      },
   194|    };
   195|    const el = this.definition.render(this.node, this.source, ctx);
   196|    el.setAttribute("data-nexus-widget", this.definition.nodeType);
   197|    el.setAttribute("data-nexus-widget-id", this.widgetId);
   198|    return el;
   199|  }
   200|
   201|  destroy(dom: HTMLElement): void {
   202|    // Release all guards for this widget to prevent leaks
   203|    globalGuardState.releaseAll(this.widgetId);
   204|    this.definition.destroy?.(dom);
   205|  }
   206|
   207|  ignoreEvent(): boolean {
   208|    return this.definition.ignoreEvents === true;
   209|  }
   210|}
   211|
   212|function buildWidgetDecorations(
   213|  doc: string,
   214|  selection: readonly SelectionRange[],
   215|  parser: ParserLike,
   216|  widgets: WidgetDefinition[],
   217|  viewRef: { current: EditorView | null }
   218|): DecorationSet {
   219|  const ast = parseDocument(parser, doc);
   220|  const ranges = collectWidgetRanges(ast, doc, selection, widgets);
   221|  const decos: Range<Decoration>[] = [];
   222|
   223|  for (const range of ranges) {
   224|    const isBlock = range.definition.block !== false;
   225|    decos.push(
   226|      Decoration.replace({
   227|        widget: new NexusWidget(
   228|          range.definition,
   229|          range.node,
   230|          range.source,
   231|          range.from,
   232|          range.to,
   233|          viewRef
   234|        ),
   235|        block: isBlock,
   236|      }).range(range.from, range.to)
   237|    );
   238|  }
   239|
   240|  return Decoration.set(decos, true);
   241|}
   242|
   243|export function createWidgetExtension(
   244|  parser: ParserLike,
   245|  widgets: WidgetDefinition[]
   246|): Extension[] {
   247|  if (widgets.length === 0) return [];
   248|
   249|  const viewRef: { current: EditorView | null } = { current: null };
   250|
   251|  const field = StateField.define<DecorationSet>({
   252|    create(state) {
   253|      return buildWidgetDecorations(
   254|        state.doc.toString(),
   255|        state.selection.ranges,
   256|        parser,
   257|        widgets,
   258|        viewRef
   259|      );
   260|    },
   261|    update(decos: DecorationSet, tr: Transaction) {
   262|      if (tr.docChanged || tr.selection) {
   263|        // When any widget has active interaction guards, skip the full
   264|        // rebuild and map existing decorations instead. This prevents
   265|        // CM6 from destroying widget DOM mid-interaction (e.g., during
   266|        // a drag or cell edit).
   267|        if (globalGuardState.hasActiveGuards()) {
   268|          return tr.changes ? decos.map(tr.changes) : decos;
   269|        }
   270|        return buildWidgetDecorations(
   271|          tr.state.doc.toString(),
   272|          tr.state.selection.ranges,
   273|          parser,
   274|          widgets,
   275|          viewRef
   276|        );
   277|      }
   278|      return decos;
   279|    },
   280|    provide(field) {
   281|      return EditorView.decorations.from(field);
   282|    },
   283|  });
   284|
   285|  const viewCapture = ViewPlugin.fromClass(
   286|    class {
   287|      constructor(readonly view: EditorView) {
   288|        viewRef.current = view;
   289|      }
   290|      update(): void {
   291|        viewRef.current = this.view;
   292|      }
   293|      destroy(): void {
   294|        if (viewRef.current === this.view) viewRef.current = null;
   295|      }
   296|    }
   297|  );
   298|
   299|  return [field, viewCapture];
   300|}
   301|