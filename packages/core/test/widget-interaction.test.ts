     1|import { describe, expect, it, vi } from "vitest";
     2|import { EditorState } from "@codemirror/state";
     3|import { Decoration, EditorView, WidgetType } from "@codemirror/view";
     4|
     5|import { WidgetGuardState } from "../src/widget-extension";
     6|import type { InteractionGuardType, WidgetDefinition, WidgetRenderContext } from "../src/types";
     7|
     8|// ── Helper: minimal widget definition ──────────────────────────────────
     9|
    10|function makeWidgetDef(nodeType = "testWidget"): WidgetDefinition {
    11|  return {
    12|    nodeType,
    13|    block: true,
    14|    render(_node, _source, ctx) {
    15|      const el = document.createElement("div");
    16|      el.className = "test-widget";
    17|      el.textContent = "widget-content";
    18|      // Simulate interaction: click to acquire guard
    19|      el.addEventListener("mousedown", () => {
    20|        ctx.acquireGuard("interaction");
    21|      });
    22|      el.addEventListener("mouseup", () => {
    23|        ctx.releaseGuard("interaction");
    24|      });
    25|      return el;
    26|    },
    27|    destroy(el) {
    28|      el.textContent = "destroyed";
    29|    },
    30|  };
    31|}
    32|
    33|// ── WidgetGuardState unit tests ────────────────────────────────────────
    34|
    35|describe("WidgetGuardState DOM interactions", () => {
    36|  it("acquire/release tracks guard lifecycle correctly", () => {
    37|    const state = new WidgetGuardState();
    38|
    39|    expect(state.hasActiveGuards()).toBe(false);
    40|    expect(state.hasGuard("w1")).toBe(false);
    41|
    42|    state.acquire("w1", "interaction");
    43|    expect(state.hasActiveGuards()).toBe(true);
    44|    expect(state.hasGuard("w1")).toBe(true);
    45|
    46|    state.release("w1", "interaction");
    47|    expect(state.hasActiveGuards()).toBe(false);
    48|    expect(state.hasGuard("w1")).toBe(false);
    49|  });
    50|
    51|  it("multiple guard types on same widget", () => {
    52|    const state = new WidgetGuardState();
    53|
    54|    state.acquire("w1", "interaction");
    55|    state.acquire("w1", "focus");
    56|    state.acquire("w1", "drag");
    57|
    58|    expect(state.hasGuard("w1")).toBe(true);
    59|
    60|    state.release("w1", "interaction");
    61|    expect(state.hasGuard("w1")).toBe(true); // still has focus + drag
    62|
    63|    state.release("w1", "focus");
    64|    expect(state.hasGuard("w1")).toBe(true); // still has drag
    65|
    66|    state.release("w1", "drag");
    67|    expect(state.hasGuard("w1")).toBe(false);
    68|  });
    69|
    70|  it("releaseAll removes all guards for a widget", () => {
    71|    const state = new WidgetGuardState();
    72|
    73|    state.acquire("w1", "interaction");
    74|    state.acquire("w1", "focus");
    75|    state.acquire("w1", "drag");
    76|    state.acquire("w2", "interaction");
    77|
    78|    state.releaseAll("w1");
    79|    expect(state.hasGuard("w1")).toBe(false);
    80|    expect(state.hasGuard("w2")).toBe(true);
    81|    expect(state.hasActiveGuards()).toBe(true);
    82|  });
    83|
    84|  it("guards are independent across widgets", () => {
    85|    const state = new WidgetGuardState();
    86|
    87|    state.acquire("w1", "interaction");
    88|    state.acquire("w2", "interaction");
    89|
    90|    expect(state.hasGuard("w1")).toBe(true);
    91|    expect(state.hasGuard("w2")).toBe(true);
    92|
    93|    state.release("w1", "interaction");
    94|    expect(state.hasGuard("w1")).toBe(false);
    95|    expect(state.hasGuard("w2")).toBe(true);
    96|  });
    97|
    98|  it("release on non-existent widget is safe", () => {
    99|    const state = new WidgetGuardState();
   100|    // Should not throw
   101|    state.release("nonexistent", "interaction");
   102|    state.releaseAll("nonexistent");
   103|    expect(state.hasActiveGuards()).toBe(false);
   104|  });
   105|
   106|  it("double acquire is idempotent", () => {
   107|    const state = new WidgetGuardState();
   108|    state.acquire("w1", "interaction");
   109|    state.acquire("w1", "interaction"); // duplicate
   110|    expect(state.hasGuard("w1")).toBe(true);
   111|
   112|    state.release("w1", "interaction");
   113|    expect(state.hasGuard("w1")).toBe(false); // single release clears it
   114|  });
   115|
   116|  it("rapid acquire/release cycles", () => {
   117|    const state = new WidgetGuardState();
   118|    for (let i = 0; i < 1000; i++) {
   119|      state.acquire("w1", "interaction");
   120|      state.release("w1", "interaction");
   121|    }
   122|    expect(state.hasActiveGuards()).toBe(false);
   123|  });
   124|
   125|  it("concurrent widgets stress test", () => {
   126|    const state = new WidgetGuardState();
   127|    const widgetIds = Array.from({ length: 100 }, (_, i) => `widget-${i}`);
   128|
   129|    // Acquire all
   130|    for (const id of widgetIds) {
   131|      state.acquire(id, "interaction");
   132|    }
   133|    expect(state.hasActiveGuards()).toBe(true);
   134|
   135|    // Release odd ones
   136|    for (let i = 0; i < widgetIds.length; i += 2) {
   137|      state.release(widgetIds[i], "interaction");
   138|    }
   139|    // 50 widgets still have guards
   140|    expect(state.hasActiveGuards()).toBe(true);
   141|
   142|    // Release all remaining
   143|    for (const id of widgetIds) {
   144|      state.releaseAll(id);
   145|    }
   146|    expect(state.hasActiveGuards()).toBe(false);
   147|  });
   148|});
   149|
   150|// ── WidgetRenderContext guard integration ──────────────────────────────
   151|
   152|describe("WidgetRenderContext guard integration", () => {
   153|  it("acquireGuard/releaseGuard through context", () => {
   154|    const guardState = new WidgetGuardState();
   155|    const widgetId = "test-widget-1";
   156|
   157|    // Simulate what NexusWidget.toDOM() creates
   158|    const ctx: WidgetRenderContext = {
   159|      from: 0,
   160|      to: 10,
   161|      setSelection: vi.fn(),
   162|      focus: vi.fn(),
   163|      acquireGuard: (type: InteractionGuardType) => guardState.acquire(widgetId, type),
   164|      releaseGuard: (type: InteractionGuardType) => guardState.release(widgetId, type),
   165|      releaseAllGuards: () => guardState.releaseAll(widgetId),
   166|    };
   167|
   168|    ctx.acquireGuard("interaction");
   169|    expect(guardState.hasGuard(widgetId)).toBe(true);
   170|
   171|    ctx.releaseGuard("interaction");
   172|    expect(guardState.hasGuard(widgetId)).toBe(false);
   173|  });
   174|
   175|  it("releaseAllGuards clears all types", () => {
   176|    const guardState = new WidgetGuardState();
   177|    const widgetId = "test-widget-2";
   178|
   179|    const ctx: WidgetRenderContext = {
   180|      from: 0,
   181|      to: 10,
   182|      setSelection: vi.fn(),
   183|      focus: vi.fn(),
   184|      acquireGuard: (type: InteractionGuardType) => guardState.acquire(widgetId, type),
   185|      releaseGuard: (type: InteractionGuardType) => guardState.release(widgetId, type),
   186|      releaseAllGuards: () => guardState.releaseAll(widgetId),
   187|    };
   188|
   189|    ctx.acquireGuard("interaction");
   190|    ctx.acquireGuard("focus");
   191|    ctx.acquireGuard("drag");
   192|
   193|    ctx.releaseAllGuards();
   194|    expect(guardState.hasGuard(widgetId)).toBe(false);
   195|  });
   196|});
   197|
   198|// ── DOM element lifecycle tests ────────────────────────────────────────
   199|
   200|describe("Widget DOM lifecycle with guards", () => {
   201|  it("widget render creates expected DOM", () => {
   202|    const def = makeWidgetDef();
   203|    const guardState = new WidgetGuardState();
   204|    const widgetId = "dom-test-1";
   205|
   206|    const ctx: WidgetRenderContext = {
   207|      from: 0,
   208|      to: 10,
   209|      setSelection: vi.fn(),
   210|      focus: vi.fn(),
   211|      acquireGuard: (type: InteractionGuardType) => guardState.acquire(widgetId, type),
   212|      releaseGuard: (type: InteractionGuardType) => guardState.release(widgetId, type),
   213|      releaseAllGuards: () => guardState.releaseAll(widgetId),
   214|    };
   215|
   216|    const el = def.render({ type: "testWidget" } as any, "source", ctx);
   217|    expect(el.tagName).toBe("DIV");
   218|    expect(el.textContent).toBe("widget-content");
   219|  });
   220|
   221|  it("widget mousedown activates guard via context", () => {
   222|    const def = makeWidgetDef();
   223|    const guardState = new WidgetGuardState();
   224|    const widgetId = "dom-test-2";
   225|
   226|    const ctx: WidgetRenderContext = {
   227|      from: 0,
   228|      to: 10,
   229|      setSelection: vi.fn(),
   230|      focus: vi.fn(),
   231|      acquireGuard: (type: InteractionGuardType) => guardState.acquire(widgetId, type),
   232|      releaseGuard: (type: InteractionGuardType) => guardState.release(widgetId, type),
   233|      releaseAllGuards: () => guardState.releaseAll(widgetId),
   234|    };
   235|
   236|    const el = def.render({ type: "testWidget" } as any, "source", ctx);
   237|
   238|    // Simulate mousedown
   239|    el.dispatchEvent(new MouseEvent("mousedown"));
   240|    expect(guardState.hasGuard(widgetId)).toBe(true);
   241|
   242|    // Simulate mouseup
   243|    el.dispatchEvent(new MouseEvent("mouseup"));
   244|    expect(guardState.hasGuard(widgetId)).toBe(false);
   245|  });
   246|
   247|  it("widget destroy is called with element", () => {
   248|    const def = makeWidgetDef();
   249|    const el = document.createElement("div");
   250|    el.textContent = "alive";
   251|
   252|    def.destroy!(el);
   253|    expect(el.textContent).toBe("destroyed");
   254|  });
   255|
   256|  it("guard prevents simulated DOM destruction", () => {
   257|    const guardState = new WidgetGuardState();
   258|    const widgetId = "dom-test-3";
   259|
   260|    guardState.acquire(widgetId, "interaction");
   261|
   262|    // Simulate what eq() does: check guard before allowing DOM replacement
   263|    const shouldPreserve = guardState.hasGuard(widgetId);
   264|    expect(shouldPreserve).toBe(true);
   265|
   266|    // Release and check again
   267|    guardState.release(widgetId, "interaction");
   268|    const shouldRebuild = !guardState.hasGuard(widgetId);
   269|    expect(shouldRebuild).toBe(true);
   270|  });
   271|
   272|  it("typing simulation: guard active during cell edit", () => {
   273|    const guardState = new WidgetGuardState();
   274|    const widgetId = "dom-test-4";
   275|    const def = makeWidgetDef();
   276|
   277|    const ctx: WidgetRenderContext = {
   278|      from: 0,
   279|      to: 10,
   280|      setSelection: vi.fn(),
   281|      focus: vi.fn(),
   282|      acquireGuard: (type: InteractionGuardType) => guardState.acquire(widgetId, type),
   283|      releaseGuard: (type: InteractionGuardType) => guardState.release(widgetId, type),
   284|      releaseAllGuards: () => guardState.releaseAll(widgetId),
   285|    };
   286|
   287|    const el = def.render({ type: "testWidget" } as any, "source", ctx);
   288|
   289|    // Simulate: user clicks cell -> types -> clicks away
   290|    el.dispatchEvent(new MouseEvent("mousedown"));
   291|    expect(guardState.hasGuard(widgetId)).toBe(true);
   292|
   293|    // During typing, guard stays active
   294|    for (let i = 0; i < 50; i++) {
   295|      // Simulate keystrokes (guard should stay active)
   296|      expect(guardState.hasGuard(widgetId)).toBe(true);
   297|    }
   298|
   299|    el.dispatchEvent(new MouseEvent("mouseup"));
   300|    expect(guardState.hasGuard(widgetId)).toBe(false);
   301|  });
   302|
   303|  it("multi-widget interaction: guards are independent", () => {
   304|    const guardState = new WidgetGuardState();
   305|    const def = makeWidgetDef();
   306|
   307|    const makeCtx = (id: string): WidgetRenderContext => ({
   308|      from: 0,
   309|      to: 10,
   310|      setSelection: vi.fn(),
   311|      focus: vi.fn(),
   312|      acquireGuard: (type: InteractionGuardType) => guardState.acquire(id, type),
   313|      releaseGuard: (type: InteractionGuardType) => guardState.release(id, type),
   314|      releaseAllGuards: () => guardState.releaseAll(id),
   315|    });
   316|
   317|    const el1 = def.render({ type: "testWidget" } as any, "src1", makeCtx("w1"));
   318|    const el2 = def.render({ type: "testWidget" } as any, "src2", makeCtx("w2"));
   319|
   320|    // Click on widget 1
   321|    el1.dispatchEvent(new MouseEvent("mousedown"));
   322|    expect(guardState.hasGuard("w1")).toBe(true);
   323|    expect(guardState.hasGuard("w2")).toBe(false);
   324|
   325|    // Widget 2 is independent
   326|    el2.dispatchEvent(new MouseEvent("mousedown"));
   327|    expect(guardState.hasGuard("w1")).toBe(true);
   328|    expect(guardState.hasGuard("w2")).toBe(true);
   329|
   330|    // Release widget 1, widget 2 stays
   331|    el1.dispatchEvent(new MouseEvent("mouseup"));
   332|    expect(guardState.hasGuard("w1")).toBe(false);
   333|    expect(guardState.hasGuard("w2")).toBe(true);
   334|  });
   335|});
   336|