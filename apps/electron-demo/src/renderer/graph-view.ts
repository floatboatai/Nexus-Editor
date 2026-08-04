/**
 * Force-directed knowledge-graph view for the vault's wiki-link network.
 *
 * Data comes straight from `LinkIndex.getGraph()` — the same forward/backward
 * edges that power the backlinks panel — so the graph needs no extra parsing.
 * It renders on a <canvas> with a lightweight spring/repulsion simulation
 * cooled by an alpha term, and reads the shell's `--ds-*` CSS variables so it
 * tracks the light/dark theme automatically.
 *
 * Interactions: drag a node to reposition (and pin) it, wheel to zoom around
 * the cursor, drag empty space to pan, hover to spotlight a node's neighbours,
 * click a resolved node to open that file.
 */
import { iconEl } from "./icons";
import type { LinkIndex } from "./link-index";
import { normalizeSlashes } from "./path-utils";

export interface GraphViewOptions {
  index: LinkIndex;
  onOpenFile(filePath: string): void;
  getActiveFile(): string | null;
}

export interface GraphView {
  element: HTMLElement;
  /** Rebuild nodes/edges from the index, preserving positions of survivors. */
  refresh(): void;
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

/** Upper bound on rendered nodes — keeps the O(n²) repulsion pass smooth. */
const MAX_NODES = 500;

// Simulation tuning. World units are arbitrary; the view transform maps them
// to screen pixels. Values chosen for a calm settle on a few-hundred-node vault.
const REPULSION = 5200;
const LINK_DIST = 74;
const LINK_STRENGTH = 0.045;
const CENTER_PULL = 0.012;
const DAMPING = 0.82;
const ALPHA_DECAY = 0.986;
const ALPHA_MIN = 0.02;
const ALPHA_REHEAT = 0.55;

interface SimNode {
  id: string;
  label: string;
  resolved: boolean;
  degree: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Pinned by a user drag — kept out of the centering drift once released. */
  pinned: boolean;
}

interface SimEdge {
  source: SimNode;
  target: SimNode;
}

interface Palette {
  edge: string;
  node: string;
  ghost: string;
  active: string;
  label: string;
  ring: string;
}

function readPalette(host: HTMLElement): Palette {
  const cs = getComputedStyle(host);
  const v = (name: string, fallback: string): string =>
    cs.getPropertyValue(name).trim() || fallback;
  return {
    edge: v("--ds-hairline-strong", "#d6d3d1"),
    node: v("--ds-body", "#4e4e4e"),
    ghost: v("--ds-muted-soft", "#a8a29e"),
    active: v("--ds-primary", "#292524"),
    label: v("--ds-body", "#4e4e4e"),
    ring: v("--ds-primary", "#292524"),
  };
}
function basename(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const slash = norm.lastIndexOf("/");
  return slash >= 0 ? norm.slice(slash + 1) : norm;
}

/** Deterministic pseudo-random in [0,1) seeded by the node id (no Math.random,
 * so the same vault lays out the same way each open). */
function seededUnit(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // xorshift the hash into a float
  h ^= h << 13;
  h ^= h >>> 17;
  h ^= h << 5;
  return ((h >>> 0) % 100000) / 100000;
}

export function createGraphView(options: GraphViewOptions): GraphView {
  const { index, onOpenFile, getActiveFile } = options;

  const root = document.createElement("div");
  root.className = "nx-graph";
  root.style.display = "none";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Knowledge graph");

  const canvas = document.createElement("canvas");
  canvas.className = "nx-graph__canvas";
  root.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  // Floating header: title + node/edge counts + close button.
  const header = document.createElement("div");
  header.className = "nx-graph__header";
  const heading = document.createElement("div");
  heading.className = "nx-graph__heading";
  heading.textContent = "Knowledge Graph";
  const meta = document.createElement("div");
  meta.className = "nx-graph__meta";
  header.append(heading, meta);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "nx-btn nx-btn--icon nx-graph__close";
  closeBtn.title = "Close graph (Esc)";
  closeBtn.setAttribute("aria-label", "Close graph");
  closeBtn.appendChild(iconEl("close"));
  header.appendChild(closeBtn);
  root.appendChild(header);

  // Floating controls: reset view + a tiny legend.
  const controls = document.createElement("div");
  controls.className = "nx-graph__controls";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "nx-btn nx-btn--ghost nx-graph__reset";
  resetBtn.textContent = "Reset view";
  const legend = document.createElement("div");
  legend.className = "nx-graph__legend";
  legend.innerHTML =
    '<span class="nx-graph__dot nx-graph__dot--note"></span>Note' +
    '<span class="nx-graph__dot nx-graph__dot--ghost"></span>Unresolved';
  controls.append(resetBtn, legend);
  root.appendChild(controls);

  const empty = document.createElement("div");
  empty.className = "nx-graph__empty";
  empty.style.display = "none";
  root.appendChild(empty);

  let nodes: SimNode[] = [];
  let edges: SimEdge[] = [];
  let palette = readPalette(root);

  // View transform (world → screen): screen = world * scale + offset.
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  let hovered: SimNode | null = null;
  let neighbours = new Set<string>();
  let alpha = 1;
  let rafId: number | null = null;
  let opened = false;
  let destroyed = false;
  let dpr = 1;
  // Set whenever something visible changes (hover, pan, zoom, rebuild) so the
  // rAF loop can skip redrawing a settled, unchanged graph — otherwise the
  // canvas repaints 60fps forever after the layout converges (battery drain).
  let needsDraw = true;
  function cssSize(): { w: number; h: number } {
    const rect = root.getBoundingClientRect();
    return { w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
  }

  function resize(): void {
    if (!ctx) return;
    dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const { w, h } = cssSize();
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }

  /** Rebuild sim nodes/edges from the index, keeping positions of survivors. */
  function build(): void {
    const graph = index.getGraph();
    const prev = new Map(nodes.map((n) => [n.id, n]));

    // Cap to the highest-degree nodes on very large vaults so the O(n²)
    // repulsion pass stays within a frame budget.
    let gNodes = graph.nodes;
    let capped = false;
    if (gNodes.length > MAX_NODES) {
      gNodes = [...gNodes].sort((a, b) => b.degree - a.degree).slice(0, MAX_NODES);
      capped = true;
    }
    const kept = new Set(gNodes.map((n) => n.id));

    const { w, h } = cssSize();
    const cx = w / 2;
    const cy = h / 2;

    nodes = gNodes.map((n) => {
      const old = prev.get(n.id);
      if (old) {
        return { ...old, label: n.label, resolved: n.resolved, degree: n.degree };
      }
      // Seed new nodes on a deterministic ring around center so layouts are
      // stable across reopens but still spread out.
      const ang = seededUnit(n.id, 1) * Math.PI * 2;
      const rad = 40 + seededUnit(n.id, 2) * Math.min(w, h) * 0.32;
      return {
        id: n.id,
        label: n.label,
        resolved: n.resolved,
        degree: n.degree,
        x: cx + Math.cos(ang) * rad,
        y: cy + Math.sin(ang) * rad,
        vx: 0,
        vy: 0,
        pinned: false,
      };
    });

    const byId = new Map(nodes.map((n) => [n.id, n]));
    edges = [];
    for (const e of graph.edges) {
      const source = byId.get(e.source);
      const target = byId.get(e.target);
      if (source && target) edges.push({ source, target });
    }

    const noteCount = nodes.filter((n) => n.resolved).length;
    meta.textContent =
      `${noteCount} note${noteCount === 1 ? "" : "s"} · ${edges.length} link${edges.length === 1 ? "" : "s"}` +
      (capped ? ` · showing top ${MAX_NODES}` : "");

    if (nodes.length === 0) {
      empty.style.display = "";
      empty.innerHTML =
        '<div class="nx-graph__empty-title">No connections yet</div>' +
        '<div class="nx-graph__empty-body">Link notes with <code>[[wiki links]]</code> to grow your graph.</div>';
    } else {
      empty.style.display = "none";
    }

    // Reheat the simulation so new/removed nodes settle.
    alpha = ALPHA_REHEAT;
    // Re-resolve references that point into the OLD node array — build() makes
    // fresh SimNode objects (`{...old}`), so a rebuild mid-drag or mid-hover
    // would otherwise leave these pointing at orphans that are no longer in
    // `nodes`. `dragNode` especially: `step()` skips `node === dragNode`, and
    // if that identity is stale the dragged node drifts away under the cursor.
    if (hovered) hovered = byId.get(hovered.id) ?? null;
    if (dragNode) dragNode = byId.get(dragNode.id) ?? null;
    recomputeNeighbours();
    needsDraw = true;
  }

  function recomputeNeighbours(): void {
    neighbours = new Set();
    if (!hovered) return;
    for (const e of edges) {
      if (e.source.id === hovered.id) neighbours.add(e.target.id);
      else if (e.target.id === hovered.id) neighbours.add(e.source.id);
    }
  }

  function worldToScreen(x: number, y: number): { sx: number; sy: number } {
    return { sx: x * scale + offsetX, sy: y * scale + offsetY };
  }

  function screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - offsetX) / scale, y: (sy - offsetY) / scale };
  }

  function nodeRadius(n: SimNode): number {
    return 4 + Math.min(9, Math.sqrt(n.degree) * 2.1);
  }
  /** One physics step: repulsion (O(n²)), link springs, gentle centering. */
  function step(): void {
    if (alpha < ALPHA_MIN) return;
    const { w, h } = cssSize();
    const cx = w / 2;
    const cy = h / 2;
    const n = nodes.length;

    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          // Coincident nodes — nudge apart deterministically.
          dx = seededUnit(a.id + b.id, 3) - 0.5;
          dy = seededUnit(b.id + a.id, 4) - 0.5;
          d2 = dx * dx + dy * dy + 0.01;
        }
        const dist = Math.sqrt(d2);
        const force = (REPULSION / d2) * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    for (const e of edges) {
      const dx = e.target.x - e.source.x;
      const dy = e.target.y - e.source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const disp = (dist - LINK_DIST) * LINK_STRENGTH * alpha;
      const fx = (dx / dist) * disp;
      const fy = (dy / dist) * disp;
      e.source.vx += fx;
      e.source.vy += fy;
      e.target.vx -= fx;
      e.target.vy -= fy;
    }

    for (const node of nodes) {
      // Dragged and user-pinned nodes hold their position. Zero the velocity
      // that repulsion/springs accumulated above so releasing a node doesn't
      // fling it, and a pinned node stays exactly where it was placed instead
      // of drifting back under CENTER_PULL.
      if (node === dragNode || node.pinned) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx += (cx - node.x) * CENTER_PULL * alpha;
      node.vy += (cy - node.y) * CENTER_PULL * alpha;
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x += node.vx;
      node.y += node.vy;
    }

    alpha *= ALPHA_DECAY;
  }

  function draw(): void {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { w, h } = cssSize();
    ctx.clearRect(0, 0, w, h);

    const dim = hovered !== null;

    // Edges.
    ctx.lineWidth = 1;
    for (const e of edges) {
      const lit = dim && (e.source.id === hovered!.id || e.target.id === hovered!.id);
      const s = worldToScreen(e.source.x, e.source.y);
      const t = worldToScreen(e.target.x, e.target.y);
      ctx.strokeStyle = lit ? palette.active : palette.edge;
      ctx.globalAlpha = dim ? (lit ? 0.9 : 0.12) : 0.55;
      ctx.beginPath();
      ctx.moveTo(s.sx, s.sy);
      ctx.lineTo(t.sx, t.sy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Nodes.
    // Node ids come from `contents.keys()`, which are normalizeSlashes'd; the
    // active file path is the raw IPC path. Normalize so the active ring shows
    // on Windows (backslash vs forward-slash would never match otherwise).
    const rawActive = getActiveFile();
    const active = rawActive != null ? normalizeSlashes(rawActive) : null;
    for (const node of nodes) {
      const s = worldToScreen(node.x, node.y);
      const r = nodeRadius(node) * Math.min(1.4, Math.max(0.7, scale));
      const isHover = hovered?.id === node.id;
      const isNeighbour = neighbours.has(node.id);
      const isActive = active != null && node.id === active;

      if (dim && !isHover && !isNeighbour) ctx.globalAlpha = 0.25;
      else ctx.globalAlpha = 1;

      ctx.beginPath();
      ctx.arc(s.sx, s.sy, r, 0, Math.PI * 2);
      ctx.fillStyle = node.resolved ? palette.node : palette.ghost;
      ctx.fill();

      if (isActive || isHover) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = palette.ring;
        ctx.stroke();
      }

      // Labels: always for hub/hover/active, otherwise only when zoomed in.
      const showLabel = isHover || isActive || isNeighbour || node.degree >= 4 || scale > 1.5;
      if (showLabel) {
        ctx.globalAlpha = dim && !isHover && !isNeighbour ? 0.3 : 1;
        ctx.fillStyle = palette.label;
        ctx.font = `${isHover ? 600 : 400} ${11}px var(--ds-font-ui, Inter, sans-serif)`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const label = node.label.length > 24 ? node.label.slice(0, 23) + "…" : node.label;
        ctx.fillText(label, s.sx, s.sy + r + 3);
      }
    }
    ctx.globalAlpha = 1;
  }

  function frame(): void {
    if (destroyed || !opened) return;
    // Only do work when the sim is still moving (alpha above the floor) or an
    // interaction flagged a one-off redraw. A converged, idle graph parks here
    // cheaply instead of clearing+repainting an identical frame every 16ms.
    const running = alpha >= ALPHA_MIN;
    if (running) step();
    if (running || needsDraw) {
      draw();
      needsDraw = false;
    }
    rafId = requestAnimationFrame(frame);
  }
  // ── Interaction ──────────────────────────────────────────────
  let dragNode: SimNode | null = null;
  let panning = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;

  function localPoint(e: MouseEvent): { sx: number; sy: number } {
    const rect = canvas.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }

  function hitTest(sx: number, sy: number): SimNode | null {
    // Iterate back-to-front so topmost (later-drawn) nodes win.
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      const s = worldToScreen(node.x, node.y);
      const r = nodeRadius(node) * Math.min(1.4, Math.max(0.7, scale)) + 4;
      const dx = sx - s.sx;
      const dy = sy - s.sy;
      if (dx * dx + dy * dy <= r * r) return node;
    }
    return null;
  }

  function onMouseDown(e: MouseEvent): void {
    const { sx, sy } = localPoint(e);
    downX = sx;
    downY = sy;
    moved = false;
    const hit = hitTest(sx, sy);
    if (hit) {
      dragNode = hit;
      dragNode.pinned = true;
      alpha = Math.max(alpha, 0.3);
    } else {
      panning = true;
    }
    lastX = sx;
    lastY = sy;
  }

  function onMouseMove(e: MouseEvent): void {
    const { sx, sy } = localPoint(e);
    if (Math.abs(sx - downX) > 3 || Math.abs(sy - downY) > 3) moved = true;

    if (dragNode) {
      const world = screenToWorld(sx, sy);
      dragNode.x = world.x;
      dragNode.y = world.y;
      dragNode.vx = 0;
      dragNode.vy = 0;
      alpha = Math.max(alpha, 0.25);
      needsDraw = true;
      return;
    }
    if (panning) {
      offsetX += sx - lastX;
      offsetY += sy - lastY;
      lastX = sx;
      lastY = sy;
      needsDraw = true;
      return;
    }
    // Hover highlight.
    const hit = hitTest(sx, sy);
    if (hit?.id !== hovered?.id) {
      hovered = hit;
      recomputeNeighbours();
      needsDraw = true;
    }
    canvas.style.cursor = hit ? "pointer" : "grab";
  }

  function onMouseUp(e: MouseEvent): void {
    const wasDrag = dragNode;
    const didPan = panning;
    dragNode = null;
    panning = false;
    if (!moved) {
      const { sx, sy } = localPoint(e);
      const hit = hitTest(sx, sy);
      if (hit && hit.resolved) {
        onOpenFile(hit.id);
        close();
        return;
      }
    }
    // A quick click on empty space (no drag) clears any pin-less hover.
    if (didPan && !moved) {
      hovered = null;
      recomputeNeighbours();
      needsDraw = true;
    }
    void wasDrag;
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const { sx, sy } = localPoint(e);
    const before = screenToWorld(sx, sy);
    const factor = Math.exp(-e.deltaY * 0.0015);
    scale = Math.min(4, Math.max(0.2, scale * factor));
    // Keep the cursor anchored over the same world point while zooming.
    offsetX = sx - before.x * scale;
    offsetY = sy - before.y * scale;
    needsDraw = true;
  }

  function onLeave(): void {
    if (!dragNode && !panning && hovered) {
      hovered = null;
      recomputeNeighbours();
      needsDraw = true;
    }
  }

  /** Fit all nodes into view with padding — used on open and Reset. */
  function fitToView(): void {
    needsDraw = true;
    if (nodes.length === 0) {
      // Nothing to frame — reset to identity so the empty-state paints cleanly.
      scale = 1;
      offsetX = 0;
      offsetY = 0;
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x);
      maxY = Math.max(maxY, n.y);
    }
    const { w, h } = cssSize();
    const gw = Math.max(1, maxX - minX);
    const gh = Math.max(1, maxY - minY);
    const pad = 80;
    scale = Math.min(2, Math.max(0.3, Math.min((w - pad) / gw, (h - pad) / gh)));
    offsetX = w / 2 - ((minX + maxX) / 2) * scale;
    offsetY = h / 2 - ((minY + maxY) / 2) * scale;
  }
  // ── Lifecycle ────────────────────────────────────────────────
  function settle(iterations: number): void {
    // Run headless steps so the first painted frame is already relaxed
    // instead of showing the initial ring exploding outward.
    const savedAlpha = alpha;
    alpha = 1;
    for (let i = 0; i < iterations; i++) step();
    alpha = savedAlpha;
  }

  function open(): void {
    if (opened) return;
    opened = true;
    root.style.display = "";
    palette = readPalette(root);
    resize();
    build();
    settle(120);
    fitToView();
    if (rafId == null) rafId = requestAnimationFrame(frame);
  }

  function close(): void {
    if (!opened) return;
    opened = false;
    root.style.display = "none";
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    hovered = null;
    neighbours = new Set();
  }

  function refresh(): void {
    if (!opened) return;
    palette = readPalette(root);
    build();
  }

  const unsubscribe = index.subscribe(() => {
    // Only rebuild while visible; reopening rebuilds from scratch anyway.
    if (opened) build();
  });

  const ro =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          if (opened) {
            resize();
            alpha = Math.max(alpha, 0.15);
            needsDraw = true;
          }
        })
      : null;
  ro?.observe(root);

  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("mouseleave", onLeave);
  closeBtn.addEventListener("click", () => close());
  resetBtn.addEventListener("click", () => {
    build();
    settle(60);
    fitToView();
  });

  const onKey = (e: KeyboardEvent) => {
    if (opened && e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  window.addEventListener("keydown", onKey);

  return {
    element: root,
    refresh,
    open,
    close,
    isOpen: () => opened,
    destroy() {
      destroyed = true;
      close();
      unsubscribe();
      ro?.disconnect();
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("keydown", onKey);
      root.remove();
    },
  };
}





