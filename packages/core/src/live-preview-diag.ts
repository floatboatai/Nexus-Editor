import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/**
 * Live-preview click-drift diagnostic instrumentation.
 *
 * ── HOW TO USE ──
 * 1. In the app, run:  window.__NEXUS_DIAG__ = true
 * 2. Perform the operation that causes drift (click where it misbehaves).
 * 3. Open the browser console, copy the `[NEXUS-DIAG] ...` group(s) and paste back.
 *
 * The log groups contain enough structured data to pinpoint the exact decoration
 * whose rendered height diverged from CM6's heightmap estimate.
 */

interface HeightProbe {
  pos: number;
  y: number | null;
}

interface WidgetSample {
  kind: string;
  top: number;
  height: number;
  docLineIndex?: number;
}

interface ClickSnapshot {
  clickNo: number;
  clickX: number;
  clickY: number;
  targetDescribe: string;
  posAtCoords: number | null;
  selectionHead: number;
  scrollTop: number;
  viewportFrom: number;
  viewportTo: number;
  contentHeight: number;
  probes: HeightProbe[];
  widgets: WidgetSample[];
  cmLineCount: number;
}

function diagOn(): boolean { return Boolean((globalThis as any).__NEXUS_DIAG__); }

let clickCounter = 0;
let txCounter = 0;

function describeTarget(el: EventTarget | null): string {
  if (!(el instanceof HTMLElement)) return String(el ?? "null");
  const tag = el.tagName.toLowerCase();
  const cls = el.className && typeof el.className === "string" ? "." + el.className.split(/\s+/).slice(0, 3).join(".") : "";
  const role = el.getAttribute("role");
  const txt = (el.textContent ?? "").trim().slice(0, 30).replace(/\s+/g, " ");
  return `${tag}${cls}${role ? `[role=${role}]` : ""} "${txt}"`;
}

function probeHeightmap(view: EditorView): HeightProbe[] {
  const docLen = view.state.doc.length;
  // Probe the whole doc at 10% intervals plus the viewport edges.
  const positions = new Set<number>([
    0,
    view.viewport.from,
    view.viewport.to,
    docLen,
  ]);
  for (let i = 1; i < 10; i++) positions.add(Math.floor((docLen * i) / 10));

  const probes: HeightProbe[] = [];
  for (const p of Array.from(positions).sort((a, b) => a - b)) {
    let y: number | null = null;
    try {
      const coords = view.coordsAtPos(p);
      y = coords ? Math.round(coords.top) : null;
    } catch {
      y = null;
    }
    probes.push({ pos: p, y });
  }
  return probes;
}

function auditWidgets(view: EditorView): WidgetSample[] {
  const samples: WidgetSample[] = [];
  const root = view.dom;
  const hostRect = root.getBoundingClientRect();

  const selectors: Array<[string, string]> = [
    [".nexus-table-wrapper", "table"],
    ["[data-live-preview-image]", "image"],
    ["blockquote", "blockquote"],
    ["hr", "hr"],
    [".cm-line[role='code']", "codeFence"],
    [".cm-line[aria-level]", "heading"],
  ];

  for (const [sel, kind] of selectors) {
    for (const el of Array.from(root.querySelectorAll(sel))) {
      const r = (el as HTMLElement).getBoundingClientRect();
      samples.push({
        kind,
        top: Math.round(r.top - hostRect.top),
        height: Math.round(r.height),
      });
    }
  }
  samples.sort((a, b) => a.top - b.top);
  return samples;
}

function diffProbes(before: HeightProbe[], after: HeightProbe[]): Array<{ pos: number; delta: number }> {
  const deltas: Array<{ pos: number; delta: number }> = [];
  const map = new Map(before.map((p) => [p.pos, p.y]));
  for (const a of after) {
    const b = map.get(a.pos);
    if (b != null && a.y != null) {
      const d = a.y - b;
      if (Math.abs(d) >= 1) deltas.push({ pos: a.pos, delta: d });
    }
  }
  return deltas;
}

function snapshot(view: EditorView, clickX: number, clickY: number, target: EventTarget | null): ClickSnapshot {
  return {
    clickNo: ++clickCounter,
    clickX,
    clickY,
    targetDescribe: describeTarget(target),
    posAtCoords: view.posAtCoords({ x: clickX, y: clickY }),
    selectionHead: view.state.selection.main.head,
    scrollTop: Math.round(view.scrollDOM.scrollTop),
    viewportFrom: view.viewport.from,
    viewportTo: view.viewport.to,
    contentHeight: Math.round(view.contentHeight),
    probes: probeHeightmap(view),
    widgets: auditWidgets(view),
    cmLineCount: view.dom.querySelectorAll(".cm-line").length,
  };
}

function logClick(snap: ClickSnapshot, post: {
  selectionHead: number;
  scrollTop: number;
  probes: HeightProbe[];
  cursorY: number | null;
  contentHeightAfter: number;
  widgets: WidgetSample[];
}): void {
  const probeDeltas = diffProbes(snap.probes, post.probes);
  const scrollDelta = post.scrollTop - snap.scrollTop;
  const clickToCursorDrift = post.cursorY != null ? Math.round(post.cursorY - snap.clickY) : null;

  const suspicious =
    (clickToCursorDrift != null && Math.abs(clickToCursorDrift) > 5) ||
    probeDeltas.some((d) => Math.abs(d.delta) > 1);

  const icon = suspicious ? "🔴" : "🟢";
  const probesPre = snap.probes.map((p) => `${p.pos}→${p.y}`).join(" | ");
  const probesPost = post.probes.map((p) => `${p.pos}→${p.y}`).join(" | ");
  const widgetDiff = compareWidgets(snap.widgets, post.widgets);
  const widgetsPre = snap.widgets.map((w) => `${w.kind}@${w.top}h${w.height}`).join(" | ");
  const hmShift = probeDeltas.length > 0
    ? "HEIGHTMAP SHIFTED: " + probeDeltas.map((d) => `pos ${d.pos} Δ${d.delta > 0 ? "+" : ""}${d.delta}px`).join(", ")
    : "heightmap stable";
  const wShift = widgetDiff.length > 0
    ? "WIDGETS SHIFTED: " + widgetDiff.map((w) => `${w.kind} top:${w.beforeTop}→${w.afterTop} hΔ:${w.heightDelta}`).join(", ")
    : `widgets(n=${snap.widgets.length}) stable`;

  console.log(
    `${icon} [NEXUS-DIAG] click #${snap.clickNo}\n` +
    `  click        (${snap.clickX},${snap.clickY})\n` +
    `  target       ${snap.targetDescribe}\n` +
    `  posAtCoords  ${snap.posAtCoords} → after: ${post.selectionHead} (Δ=${post.selectionHead - (snap.posAtCoords ?? 0)})\n` +
    `  scroll       ${snap.scrollTop} → ${post.scrollTop} (Δ=${scrollDelta})\n` +
    `  viewport     [${snap.viewportFrom}, ${snap.viewportTo}]\n` +
    `  contentH     ${snap.contentHeight} → ${post.contentHeightAfter} (Δ=${post.contentHeightAfter - snap.contentHeight})\n` +
    `  cursorY      ${post.cursorY} vs clickY ${snap.clickY}  drift=${clickToCursorDrift}px\n` +
    `  ${hmShift}\n` +
    `  ${wShift}\n` +
    `  probes(pre)  ${probesPre}\n` +
    `  probes(post) ${probesPost}\n` +
    `  widgets      ${widgetsPre}`
  );
}

function compareWidgets(before: WidgetSample[], after: WidgetSample[]): Array<{ kind: string; beforeTop: number; afterTop: number; heightDelta: number }> {
  const out: Array<{ kind: string; beforeTop: number; afterTop: number; heightDelta: number }> = [];
  // Pair widgets by kind + order (approximate — no stable IDs).
  const byKind = new Map<string, WidgetSample[]>();
  for (const w of before) {
    if (!byKind.has(w.kind)) byKind.set(w.kind, []);
    byKind.get(w.kind)!.push(w);
  }
  const afterByKind = new Map<string, WidgetSample[]>();
  for (const w of after) {
    if (!afterByKind.has(w.kind)) afterByKind.set(w.kind, []);
    afterByKind.get(w.kind)!.push(w);
  }
  for (const [kind, bList] of byKind) {
    const aList = afterByKind.get(kind) ?? [];
    const n = Math.min(bList.length, aList.length);
    for (let i = 0; i < n; i++) {
      const b = bList[i];
      const a = aList[i];
      if (Math.abs(b.top - a.top) > 1 || Math.abs(b.height - a.height) > 1) {
        out.push({
          kind: `${kind}#${i}`,
          beforeTop: b.top,
          afterTop: a.top,
          heightDelta: a.height - b.height,
        });
      }
    }
  }
  return out;
}

/** Diagnostic extension. Always safe to include — does nothing until `window.__NEXUS_DIAG__ = true`. */
export function createLivePreviewDiagnostics(): Extension {
  let bannerShown = false;

  const clickHandler = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!diagOn()) return false;

      const snap = snapshot(view, event.clientX, event.clientY, event.target);

      requestAnimationFrame(() => {
        // Second rAF — ensures the next paint cycle has completed.
        requestAnimationFrame(() => {
          const sel = view.state.selection.main.head;
          let cursorY: number | null = null;
          try {
            const c = view.coordsAtPos(sel);
            cursorY = c ? Math.round(c.top) : null;
          } catch { cursorY = null; }

          logClick(snap, {
            selectionHead: sel,
            scrollTop: Math.round(view.scrollDOM.scrollTop),
            probes: probeHeightmap(view),
            cursorY,
            contentHeightAfter: Math.round(view.contentHeight),
            widgets: auditWidgets(view),
          });
        });
      });
      return false;
    },
  });

  const updatePlugin = ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        if (diagOn() && !bannerShown) {
          bannerShown = true;
          const docLen = view.state.doc.length;
          console.log(
            "%c[NEXUS-DIAG]%c active — docLen=" + docLen + " lines=" + (view.state.doc.lines) +
              "\n  click anywhere to capture a snapshot.",
            "background:#f60;color:#fff;padding:2px 6px;border-radius:3px",
            "color:#888"
          );
        }
      }
      update(u: ViewUpdate) {
        if (!diagOn()) return;
        if (u.docChanged || u.selectionSet || u.viewportChanged || u.heightChanged) {
          txCounter++;
          if (txCounter % 1 === 0) {
            // Fine-grained transaction log — lightweight enough to always emit.
            const changed: string[] = [];
            if (u.docChanged) changed.push("doc");
            if (u.selectionSet) changed.push("sel");
            if (u.viewportChanged) changed.push("vp");
            if (u.heightChanged) changed.push("H");
            const sel = u.state.selection.main.head;
            console.debug(
              `[NEXUS-DIAG tx#${txCounter}] ${changed.join(",")} sel=${sel} scroll=${Math.round(u.view.scrollDOM.scrollTop)} contentH=${Math.round(u.view.contentHeight)}`
            );
          }
        }
      }
    }
  );

  return [clickHandler, updatePlugin];
}
