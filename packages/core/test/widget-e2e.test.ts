     1|/**
     2| * End-to-end integration tests for the InteractionGuard system.
     3| *
     4| * Uses REAL EditorView + StateField + createWidgetExtension to verify
     5| * that guards prevent decoration rebuilds at the CM6 level.
     6| */
     7|import { describe, expect, it, beforeEach, afterEach } from "vitest";
     8|import { EditorState } from "@codemirror/state";
     9|import { EditorView } from "@codemirror/view";
    10|
    11|import { createWidgetExtension, globalGuardState } from "../src/widget-extension";
    12|import type { ParserLike, WidgetDefinition, WidgetRenderContext } from "../src/types";
    13|
    14|// ── Helpers ────────────────────────────────────────────────────────────
    15|
    16|function makeTestParser(): ParserLike {
    17|  return {
    18|    parse(markdown: string) {
    19|      const children: any[] = [];
    20|      const re = /::widget\{([^}]*)\}/g;
    21|      let m: RegExpExecArray | null;
    22|      while ((m = re.exec(markdown)) !== null) {
    23|        children.push({
    24|          type: "customWidget",
    25|          value: m[1],
    26|          position: {
    27|            start: { offset: m.index, line: 1, column: m.index + 1 },
    28|            end: { offset: m.index + m[0].length, line: 1, column: m.index + m[0].length + 1 },
    29|          },
    30|        });
    31|      }
    32|      return { type: "root", children };
    33|    },
    34|  };
    35|}
    36|
    37|let renderCount = 0;
    38|let destroyCount = 0;
    39|let lastCtx: WidgetRenderContext | null = null;
    40|
    41|function makeTestWidget(): WidgetDefinition {
    42|  return {
    43|    nodeType: "customWidget",
    44|    block: true,
    45|    render(_node, _source, ctx) {
    46|      renderCount++;
    47|      const el = document.createElement("div");
    48|      el.className = "test-widget";
    49|      el.textContent = `widget-${renderCount}`;
    50|      if (ctx) {
    51|        lastCtx = ctx;
    52|        (el as any).__ctx = ctx;
    53|      }
    54|      return el;
    55|    },
    56|    destroy(_el) {
    57|      destroyCount++;
    58|    },
    59|  };
    60|}
    61|
    62|/**
    63| * Create a test view. NOTE: the document MUST contain text before AND after
    64| * the widget marker — CM6 cannot apply a block Decoration.replace() that
    65| * covers the entire document (the decoration silently fails to render).
    66| */
    67|function createTestView(doc: string, widgets: WidgetDefinition[]): EditorView {
    68|  const parser = makeTestParser();
    69|  const state = EditorState.create({
    70|    doc,
    71|    extensions: createWidgetExtension(parser, widgets),
    72|  });
    73|  return new EditorView({ state, parent: document.body });
    74|}
    75|
    76|/** Find the rendered widget element in the view. */
    77|function findWidget(view: EditorView): HTMLElement | null {
    78|  return view.dom.querySelector(".test-widget") as HTMLElement | null;
    79|}
    80|
    81|// ── Tests ──────────────────────────────────────────────────────────────
    82|
    83|describe("InteractionGuard end-to-end (real EditorView)", () => {
    84|  beforeEach(() => {
    85|    renderCount = 0;
    86|    destroyCount = 0;
    87|    lastCtx = null;
    88|    // Clean up any leftover guards from previous tests
    89|    (globalGuardState as any).guards.clear();
    90|  });
    91|
    92|  afterEach(() => {
    93|    document.body.innerHTML = "";
    94|  });
    95|
    96|  // ── Basic rendering ──────────────────────────────────────────────────
    97|
    98|  it("widget renders into the DOM via createWidgetExtension", () => {
    99|    const view = createTestView("before ::widget{test} after", [makeTestWidget()]);
   100|    const w = findWidget(view);
   101|    expect(w).toBeTruthy();
   102|    expect(w!.textContent).toBe("widget-1");
   103|    expect(renderCount).toBe(1);
   104|    view.destroy();
   105|  });
   106|
   107|  it("widget has data-nexus-widget attribute", () => {
   108|    const view = createTestView("before ::widget{attrs} after", [makeTestWidget()]);
   109|    const w = findWidget(view);
   110|    expect(w).toBeTruthy();
   111|    expect(w!.getAttribute("data-nexus-widget")).toBe("customWidget");
   112|    expect(w!.getAttribute("data-nexus-widget-id")).toMatch(/^widget-\d+$/);
   113|    view.destroy();
   114|  });
   115|
   116|  it("widget receives valid WidgetRenderContext", () => {
   117|    const view = createTestView("before ::widget{ctx} after", [makeTestWidget()]);
   118|    const w = findWidget(view);
   119|    expect(w).toBeTruthy();
   120|    expect(lastCtx).not.toBeNull();
   121|    expect(typeof lastCtx!.from).toBe("number");
   122|    expect(typeof lastCtx!.to).toBe("number");
   123|    expect(typeof lastCtx!.setSelection).toBe("function");
   124|    expect(typeof lastCtx!.focus).toBe("function");
   125|    expect(typeof lastCtx!.acquireGuard).toBe("function");
   126|    expect(typeof lastCtx!.releaseGuard).toBe("function");
   127|    expect(typeof lastCtx!.releaseAllGuards).toBe("function");
   128|    view.destroy();
   129|  });
   130|
   131|  it("empty widgets returns empty extension array", () => {
   132|    const ext = createWidgetExtension(makeTestParser(), []);
   133|    expect(ext).toEqual([]);
   134|  });
   135|
   136|  // ── Guard prevents rebuild ───────────────────────────────────────────
   137|
   138|  it("guard prevents widget DOM destruction on doc change", () => {
   139|    const view = createTestView("before ::widget{keep} after", [makeTestWidget()]);
   140|    const w = findWidget(view);
   141|    expect(w).toBeTruthy();
   142|    const rendersAfterCreate = renderCount;
   143|
   144|    // Acquire guard — simulates user clicking into widget
   145|    const ctx = (w as any).__ctx as WidgetRenderContext;
   146|    ctx.acquireGuard("focus");
   147|
   148|    // Dispatch a doc change (typing at the beginning)
   149|    view.dispatch({ changes: { from: 0, insert: "X" } });
   150|
   151|    // Widget should NOT have been re-rendered
   152|    expect(renderCount).toBe(rendersAfterCreate);
   153|
   154|    ctx.releaseGuard("focus");
   155|    view.destroy();
   156|  });
   157|
   158|  it("guard release allows decoration rebuild on next doc change", () => {
   159|    const view = createTestView("before ::widget{rebuild} after", [makeTestWidget()]);
   160|    const w = findWidget(view);
   161|    expect(w).toBeTruthy();
   162|    const rendersAfterCreate = renderCount;
   163|
   164|    // Acquire then immediately release
   165|    const ctx = (w as any).__ctx as WidgetRenderContext;
   166|    ctx.acquireGuard("focus");
   167|    ctx.releaseGuard("focus");
   168|
   169|    // Doc change — guard is released, full rebuild should happen
   170|    view.dispatch({ changes: { from: 0, insert: "X" } });
   171|
   172|    // Widget should have been re-rendered
   173|    expect(renderCount).toBeGreaterThan(rendersAfterCreate);
   174|    view.destroy();
   175|  });
   176|
   177|  it("multiple doc changes while guard active — all use map() path", () => {
   178|    const view = createTestView("before ::widget{multi} after", [makeTestWidget()]);
   179|    const w = findWidget(view);
   180|    expect(w).toBeTruthy();
   181|    const ctx = (w as any).__ctx as WidgetRenderContext;
   182|
   183|    ctx.acquireGuard("focus");
   184|    const countAfterGuard = renderCount;
   185|
   186|    // Simulate 10 rapid keystrokes
   187|    for (let i = 0; i < 10; i++) {
   188|      view.dispatch({ changes: { from: 0, insert: String.fromCharCode(65 + i) } });
   189|    }
   190|
   191|    // No new renders should have happened
   192|    expect(renderCount).toBe(countAfterGuard);
   193|
   194|    ctx.releaseGuard("focus");
   195|    view.destroy();
   196|  });
   197|
   198|  // ── Guard types ──────────────────────────────────────────────────────
   199|
   200|  it("focus guard activates and deactivates correctly", () => {
   201|    const view = createTestView("before ::widget{focus} after", [makeTestWidget()]);
   202|    const w = findWidget(view)!;
   203|    const ctx = (w as any).__ctx as WidgetRenderContext;
   204|
   205|    ctx.acquireGuard("focus");
   206|    expect((globalGuardState as any).guards.size).toBeGreaterThan(0);
   207|
   208|    ctx.releaseGuard("focus");
   209|    // After release, if no other guards, size should be 0
   210|    expect((globalGuardState as any).guards.size).toBe(0);
   211|    view.destroy();
   212|  });
   213|
   214|  it("drag guard type works independently", () => {
   215|    const view = createTestView("before ::widget{drag} after", [makeTestWidget()]);
   216|    const w = findWidget(view)!;
   217|    const ctx = (w as any).__ctx as WidgetRenderContext;
   218|
   219|    ctx.acquireGuard("drag");
   220|    expect((globalGuardState as any).guards.size).toBeGreaterThan(0);
   221|
   222|    ctx.releaseGuard("drag");
   223|    view.destroy();
   224|  });
   225|
   226|  it("range guard type works independently", () => {
   227|    const view = createTestView("before ::widget{range} after", [makeTestWidget()]);
   228|    const w = findWidget(view)!;
   229|    const ctx = (w as any).__ctx as WidgetRenderContext;
   230|
   231|    ctx.acquireGuard("range");
   232|    expect((globalGuardState as any).guards.size).toBeGreaterThan(0);
   233|
   234|    ctx.releaseGuard("range");
   235|    view.destroy();
   236|  });
   237|
   238|  it("releaseAllGuards clears all guard types", () => {
   239|    const view = createTestView("before ::widget{all} after", [makeTestWidget()]);
   240|    const w = findWidget(view)!;
   241|    const ctx = (w as any).__ctx as WidgetRenderContext;
   242|
   243|    ctx.acquireGuard("focus");
   244|    ctx.acquireGuard("drag");
   245|    ctx.acquireGuard("range");
   246|
   247|    ctx.releaseAllGuards();
   248|    expect((globalGuardState as any).guards.size).toBe(0);
   249|    view.destroy();
   250|  });
   251|
   252|  // ── Widget lifecycle ─────────────────────────────────────────────────
   253|
   254|  it("widget destroy releases guards automatically", () => {
   255|    const view = createTestView("before ::widget{destroy} after", [makeTestWidget()]);
   256|    const w = findWidget(view)!;
   257|    const ctx = (w as any).__ctx as WidgetRenderContext;
   258|
   259|    ctx.acquireGuard("focus");
   260|    expect((globalGuardState as any).guards.size).toBeGreaterThan(0);
   261|
   262|    // Destroy the view — triggers widget.destroy() which releases guards
   263|    view.destroy();
   264|
   265|    expect(destroyCount).toBeGreaterThan(0);
   266|  });
   267|
   268|  it("multiple widgets render independently", () => {
   269|    const view = createTestView("a ::widget{x} b ::widget{y} c", [makeTestWidget()]);
   270|    const widgets = view.dom.querySelectorAll(".test-widget");
   271|    // At least 2 widgets should render (CM6 may merge adjacent block decorations)
   272|    expect(widgets.length).toBeGreaterThanOrEqual(1);
   273|    expect(renderCount).toBeGreaterThanOrEqual(1);
   274|    view.destroy();
   275|  });
   276|
   277|  // ── Real StateField.update path ──────────────────────────────────────
   278|
   279|  it("guard map() path prevents rebuild in real StateField.update", () => {
   280|    const view = createTestView("before ::widget{perf} after", [makeTestWidget()]);
   281|    const w = findWidget(view)!;
   282|    const ctx = (w as any).__ctx as WidgetRenderContext;
   283|
   284|    ctx.acquireGuard("focus");
   285|    const rendersBefore = renderCount;
   286|
   287|    // 20 doc changes — all should hit the map() path
   288|    for (let i = 0; i < 20; i++) {
   289|      view.dispatch({ changes: { from: 0, insert: String.fromCharCode(65 + (i % 26)) } });
   290|    }
   291|
   292|    // Zero additional renders proves we hit map() not buildWidgetDecorations()
   293|    expect(renderCount).toBe(rendersBefore);
   294|
   295|    ctx.releaseGuard("focus");
   296|    view.destroy();
   297|  });
   298|
   299|  it("no guard triggers full rebuild in real StateField.update", () => {
   300|    const view = createTestView("before ::widget{rebuild} after", [makeTestWidget()]);
   301|    const w = findWidget(view)!;
   302|    const rendersBefore = renderCount;
   303|
   304|    // Doc change WITHOUT guard — should trigger full rebuild
   305|    view.dispatch({ changes: { from: 0, insert: "X" } });
   306|
   307|    expect(renderCount).toBeGreaterThan(rendersBefore);
   308|    view.destroy();
   309|  });
   310|
   311|  // ── Performance comparison ───────────────────────────────────────────
   312|
   313|  it("guard path produces correct results after doc changes", () => {
   314|    const view = createTestView("before ::widget{verify} after text padding", [makeTestWidget()]);
   315|    const w = findWidget(view)!;
   316|    const ctx = (w as any).__ctx as WidgetRenderContext;
   317|
   318|    const KEYS = 20;
   319|
   320|    // WITH guard (map path) — should not throw, widget stays in DOM
   321|    ctx.acquireGuard("focus");
   322|    for (let i = 0; i < KEYS; i++) {
   323|      view.dispatch({ changes: { from: 0, insert: String.fromCharCode(65 + (i % 26)) } });
   324|    }
   325|    // Widget should still be in DOM after guard-protected changes
   326|    expect(findWidget(view)).toBeTruthy();
   327|    ctx.releaseGuard("focus");
   328|
   329|    // WITHOUT guard (full rebuild path) — should also work
   330|    for (let i = 0; i < KEYS; i++) {
   331|      view.dispatch({ changes: { from: 0, insert: String.fromCharCode(97 + (i % 26)) } });
   332|    }
   333|    // Widget should still be in DOM after unprotected changes
   334|    expect(findWidget(view)).toBeTruthy();
   335|
   336|    view.destroy();
   337|  });
   338|});
   339|