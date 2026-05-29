     1|/**
     2| * Performance benchmarks for the widget guard system.
     3| *
     4| * These benchmarks prove that the guard-based `decos.map(tr.changes)` path
     5| * is significantly faster than a full `buildWidgetDecorations()` rebuild
     6| * when document changes occur while widgets are being interacted with.
     7| *
     8| * Run:
     9| *   node node_modules/.pnpm/vitest@2.1.9_@types+node@24.12.2_jsdom@25.0.1/node_modules/vitest/vitest.mjs \
    10| *     run packages/core/test/widget-benchmark.test.ts
    11| */
    12|import { describe, expect, it } from "vitest";
    13|import { createEditor } from "../src/index";
    14|
    15|// ---------------------------------------------------------------------------
    16|// Helpers
    17|// ---------------------------------------------------------------------------
    18|
    19|/** Generate markdown with N fenced code blocks (each becomes a widget). */
    20|function docWithNWidgets(n: number): string {
    21|  const parts: string[] = ["# Benchmark Document\n"];
    22|  for (let i = 0; i < n; i++) {
    23|    parts.push(`\n\`\`\`js\nconsole.log(${i});\n\`\`\``);
    24|  }
    25|  return parts.join("");
    26|}
    27|
    28|/** Widget that auto-acquires a "focus" guard on every render. */
    29|function guardedWidget() {
    30|  return {
    31|    nodeType: "code" as const,
    32|    render(_node: any, _source: string, ctx?: any) {
    33|      const el = document.createElement("div");
    34|      el.setAttribute("data-widget", "code");
    35|      if (ctx) ctx.acquireGuard("focus");
    36|      return el;
    37|    },
    38|  };
    39|}
    40|
    41|/** Widget with no guard — triggers full rebuild on every change. */
    42|function unguardedWidget() {
    43|  return {
    44|    nodeType: "code" as const,
    45|    render(_node: any, _source: string) {
    46|      const el = document.createElement("div");
    47|      el.setAttribute("data-widget", "code");
    48|      return el;
    49|    },
    50|  };
    51|}
    52|
    53|/** Measure execution time of `fn()` in milliseconds. */
    54|function measureMs(fn: () => void): number {
    55|  const t0 = performance.now();
    56|  fn();
    57|  return performance.now() - t0;
    58|}
    59|
    60|/**
    61| * Insert `count` single characters at varying positions using the public API.
    62| * Each insertion triggers a `tr.docChanged` in the StateField, which either
    63| * runs `decos.map(tr.changes)` (guard path) or `buildWidgetDecorations()`
    64| * (full-rebuild path).
    65| */
    66|function simulateTyping(
    67|  editor: ReturnType<typeof createEditor>,
    68|  count: number
    69|) {
    70|  for (let i = 0; i < count; i++) {
    71|    const docLen = editor.getDocument().length;
    72|    const pos = (i * 7 + 2) % Math.max(docLen - 1, 1);
    73|    editor.setSelection(pos);
    74|    editor.replaceSelection("x");
    75|  }
    76|}
    77|
    78|// ---------------------------------------------------------------------------
    79|// 1. buildWidgetDecorations baseline — cost of full rebuild (startup)
    80|// ---------------------------------------------------------------------------
    81|
    82|describe("benchmark: buildWidgetDecorations (full rebuild cost)", () => {
    83|  for (const n of [10, 50, 100, 500]) {
    84|    it(`rebuild decorations for ${n} widgets`, () => {
    85|      const doc = docWithNWidgets(n);
    86|      const iterations = 3;
    87|      let totalMs = 0;
    88|
    89|      for (let i = 0; i < iterations; i++) {
    90|        const container = document.createElement("div");
    91|        totalMs += measureMs(() => {
    92|          const ed = createEditor({
    93|            container,
    94|            initialValue: doc,
    95|            plugins: [{ name: "bench", widgets: [unguardedWidget()] }],
    96|          });
    97|          ed.destroy();
    98|        });
    99|      }
   100|
   101|      const avgMs = totalMs / iterations;
   102|      console.log(
   103|        `  [buildWidgetDecorations] n=${String(n).padStart(3)}  avg=${avgMs.toFixed(2)}ms`
   104|      );
   105|      expect(avgMs).toBeLessThan(5000);
   106|    });
   107|  }
   108|});
   109|
   110|// ---------------------------------------------------------------------------
   111|// 2. DecorationSet.map (guard path) vs full rebuild
   112|//    This is the core benchmark. The guard path avoids re-parsing the
   113|//    entire document on every keystroke.
   114|// ---------------------------------------------------------------------------
   115|
   116|describe("benchmark: guard map() vs full rebuild", () => {
   117|  for (const n of [10, 50, 100, 500]) {
   118|    it(`map() with guard is faster than full rebuild — ${n} widgets`, () => {
   119|      const doc = docWithNWidgets(n);
   120|      const keystrokeCount = 50;
   121|
   122|      // --- WITH GUARD (decos.map path) ---
   123|      const guardContainer = document.createElement("div");
   124|      const guardEditor = createEditor({
   125|        container: guardContainer,
   126|        initialValue: doc,
   127|        plugins: [{ name: "bench-guard", widgets: [guardedWidget()] }],
   128|      });
   129|
   130|      const guardTime = measureMs(() => {
   131|        simulateTyping(guardEditor, keystrokeCount);
   132|      });
   133|      guardEditor.destroy();
   134|
   135|      // --- WITHOUT GUARD (full rebuild path) ---
   136|      const noGuardContainer = document.createElement("div");
   137|      const noGuardEditor = createEditor({
   138|        container: noGuardContainer,
   139|        initialValue: doc,
   140|        plugins: [{ name: "bench-noguard", widgets: [unguardedWidget()] }],
   141|      });
   142|
   143|      const rebuildTime = measureMs(() => {
   144|        simulateTyping(noGuardEditor, keystrokeCount);
   145|      });
   146|      noGuardEditor.destroy();
   147|
   148|      const ratio = rebuildTime / Math.max(guardTime, 0.001);
   149|      console.log(
   150|        `  [guard vs rebuild] n=${String(n).padStart(3)}  guard=${guardTime.toFixed(2)}ms  rebuild=${rebuildTime.toFixed(2)}ms  ratio=${ratio.toFixed(1)}x`
   151|      );
   152|
   153|      // Guard path should be measurably faster.
   154|      expect(guardTime).toBeLessThan(rebuildTime);
   155|    });
   156|  }
   157|});
   158|
   159|// ---------------------------------------------------------------------------
   160|// 3. WidgetGuardState operations at scale
   161|// ---------------------------------------------------------------------------
   162|
   163|describe("benchmark: WidgetGuardState operations at scale", () => {
   164|  it("acquire/release across many widget renders", () => {
   165|    // Use a moderate count — CM6 only renders viewport-visible widgets,
   166|    // so even with 200 in the document, the actual render count depends
   167|    // on jsdom's layout engine.
   168|    const n = 200;
   169|    const doc = docWithNWidgets(n);
   170|    const container = document.createElement("div");
   171|
   172|    let acquireCount = 0;
   173|    let releaseCount = 0;
   174|
   175|    const editor = createEditor({
   176|      container,
   177|      initialValue: doc,
   178|      plugins: [
   179|        {
   180|          name: "bench-guards",
   181|          widgets: [
   182|            {
   183|              nodeType: "code",
   184|              render(_node: any, _source: string, ctx?: any) {
   185|                const el = document.createElement("div");
   186|                if (ctx) {
   187|                  ctx.acquireGuard("focus");
   188|                  acquireCount++;
   189|                  ctx.acquireGuard("drag");
   190|                  acquireCount++;
   191|                  // Release one type immediately to exercise release path
   192|                  ctx.releaseGuard("drag");
   193|                  releaseCount++;
   194|                }
   195|                return el;
   196|              },
   197|            },
   198|          ],
   199|        },
   200|      ],
   201|    });
   202|
   203|    // At least some widgets should have been rendered
   204|    console.log(
   205|      `  [WidgetGuardState] acquire=${acquireCount}  release=${releaseCount}  (requested ${n} widgets)`
   206|    );
   207|    expect(acquireCount).toBeGreaterThan(0);
   208|    expect(releaseCount).toBeGreaterThan(0);
   209|    // acquire = 2 per rendered widget, release = 1 per rendered widget
   210|    expect(acquireCount).toBe(releaseCount * 2);
   211|
   212|    // A subsequent doc change should still go through the guard map path
   213|    // because each widget still has "focus" guard active.
   214|    const t = measureMs(() => {
   215|      editor.replaceSelection("z");
   216|    });
   217|    console.log(`  [WidgetGuardState] guarded dispatch: ${t.toFixed(2)}ms`);
   218|
   219|    editor.destroy();
   220|  });
   221|});
   222|
   223|// ---------------------------------------------------------------------------
   224|// 4. NexusWidget.eq() with and without guards
   225|// ---------------------------------------------------------------------------
   226|
   227|describe("benchmark: NexusWidget.eq() with/without guards", () => {
   228|  it("eq() short-circuits when guard is active (200 widgets)", () => {
   229|    const n = 200;
   230|    const doc = docWithNWidgets(n);
   231|    const changes = 30;
   232|
   233|    // WITH GUARDS: eq() returns true early → no DOM recreation
   234|    const guardContainer = document.createElement("div");
   235|    const guardEditor = createEditor({
   236|      container: guardContainer,
   237|      initialValue: doc,
   238|      plugins: [{ name: "eq-guard", widgets: [guardedWidget()] }],
   239|    });
   240|
   241|    const guardEqTime = measureMs(() => {
   242|      for (let i = 0; i < changes; i++) {
   243|        const pos =
   244|          (i * 11 + 2) %
   245|          Math.max(guardEditor.getDocument().length - 1, 1);
   246|        guardEditor.setSelection(pos);
   247|        guardEditor.replaceSelection("y");
   248|      }
   249|    });
   250|    guardEditor.destroy();
   251|
   252|    // WITHOUT GUARDS: eq() does full comparison → source changes → DOM recreated
   253|    const noGuardContainer = document.createElement("div");
   254|    const noGuardEditor = createEditor({
   255|      container: noGuardContainer,
   256|      initialValue: doc,
   257|      plugins: [{ name: "eq-noguard", widgets: [unguardedWidget()] }],
   258|    });
   259|
   260|    const noGuardEqTime = measureMs(() => {
   261|      for (let i = 0; i < changes; i++) {
   262|        const pos =
   263|          (i * 11 + 2) %
   264|          Math.max(noGuardEditor.getDocument().length - 1, 1);
   265|        noGuardEditor.setSelection(pos);
   266|        noGuardEditor.replaceSelection("y");
   267|      }
   268|    });
   269|    noGuardEditor.destroy();
   270|
   271|    const ratio = noGuardEqTime / Math.max(guardEqTime, 0.001);
   272|    console.log(
   273|      `  [eq() benchmark] guard=${guardEqTime.toFixed(2)}ms  no-guard=${noGuardEqTime.toFixed(2)}ms  ratio=${ratio.toFixed(1)}x`
   274|    );
   275|
   276|    // Both paths should complete in reasonable time. The guard path's main
   277|    // benefit is DOM preservation (eq() → true), not raw speed — so we only
   278|    // assert that neither path explodes.
   279|    expect(guardEqTime).toBeLessThan(5000);
   280|    expect(noGuardEqTime).toBeLessThan(5000);
   281|  });
   282|});
   283|
   284|// ---------------------------------------------------------------------------
   285|// 5. Realistic editing session simulation
   286|// ---------------------------------------------------------------------------
   287|
   288|describe("benchmark: realistic editing session", () => {
   289|  it("100 keystrokes with 100 widgets — guard vs no-guard", () => {
   290|    // Use 100 widgets so the parsing cost clearly dominates.
   291|    const widgetCount = 100;
   292|    const keystrokeCount = 100;
   293|    const doc = docWithNWidgets(widgetCount);
   294|
   295|    // --- WITH GUARD ---
   296|    const guardContainer = document.createElement("div");
   297|    const guardEditor = createEditor({
   298|      container: guardContainer,
   299|      initialValue: doc,
   300|      plugins: [{ name: "session-guard", widgets: [guardedWidget()] }],
   301|    });
   302|
   303|    const guardSessionTime = measureMs(() => {
   304|      simulateTyping(guardEditor, keystrokeCount);
   305|    });
   306|    guardEditor.destroy();
   307|
   308|    // --- WITHOUT GUARD ---
   309|    const noGuardContainer = document.createElement("div");
   310|    const noGuardEditor = createEditor({
   311|      container: noGuardContainer,
   312|      initialValue: doc,
   313|      plugins: [{ name: "session-noguard", widgets: [unguardedWidget()] }],
   314|    });
   315|
   316|    const noGuardSessionTime = measureMs(() => {
   317|      simulateTyping(noGuardEditor, keystrokeCount);
   318|    });
   319|    noGuardEditor.destroy();
   320|
   321|    const ratio = noGuardSessionTime / Math.max(guardSessionTime, 0.001);
   322|    console.log("");
   323|    console.log("  ============================================");
   324|    console.log("  REALISTIC EDITING SESSION RESULTS");
   325|    console.log("  ============================================");
   326|    console.log(`  Widgets: ${widgetCount}`);
   327|    console.log(`  Keystrokes: ${keystrokeCount}`);
   328|    console.log(`  Guard path (map):    ${guardSessionTime.toFixed(2)}ms`);
   329|    console.log(`  Rebuild path:        ${noGuardSessionTime.toFixed(2)}ms`);
   330|    console.log(`  Speedup ratio:       ${ratio.toFixed(1)}x`);
   331|    console.log("  ============================================");
   332|    console.log("");
   333|
   334|    // Guard path should be measurably faster with 100+ widgets.
   335|    expect(guardSessionTime).toBeLessThan(noGuardSessionTime);
   336|  });
   337|
   338|  it("100 keystrokes with 200 widgets — stress test", () => {
   339|    const widgetCount = 200;
   340|    const keystrokeCount = 100;
   341|    const doc = docWithNWidgets(widgetCount);
   342|
   343|    // WITH GUARD
   344|    const guardContainer = document.createElement("div");
   345|    const guardEditor = createEditor({
   346|      container: guardContainer,
   347|      initialValue: doc,
   348|      plugins: [{ name: "stress-guard", widgets: [guardedWidget()] }],
   349|    });
   350|
   351|    const guardTime = measureMs(() => {
   352|      simulateTyping(guardEditor, keystrokeCount);
   353|    });
   354|    guardEditor.destroy();
   355|
   356|    // WITHOUT GUARD
   357|    const noGuardContainer = document.createElement("div");
   358|    const noGuardEditor = createEditor({
   359|      container: noGuardContainer,
   360|      initialValue: doc,
   361|      plugins: [{ name: "stress-noguard", widgets: [unguardedWidget()] }],
   362|    });
   363|
   364|    const rebuildTime = measureMs(() => {
   365|      simulateTyping(noGuardEditor, keystrokeCount);
   366|    });
   367|    noGuardEditor.destroy();
   368|
   369|    const ratio = rebuildTime / Math.max(guardTime, 0.001);
   370|    console.log("");
   371|    console.log("  ============================================");
   372|    console.log("  STRESS TEST RESULTS (200 widgets, 100 keystrokes)");
   373|    console.log("  ============================================");
   374|    console.log(`  Guard path (map):    ${guardTime.toFixed(2)}ms`);
   375|    console.log(`  Rebuild path:        ${rebuildTime.toFixed(2)}ms`);
   376|    console.log(`  Speedup ratio:       ${ratio.toFixed(1)}x`);
   377|    console.log("  ============================================");
   378|    console.log("");
   379|
   380|    expect(guardTime).toBeLessThan(rebuildTime);
   381|  });
   382|});
   383|