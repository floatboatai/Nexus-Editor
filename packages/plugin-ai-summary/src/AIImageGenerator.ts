// AIImageGenerator — generate a simple SVG tree/mindmap from text headings
// Includes simple in-memory + localStorage caching and options to toggle connectors

// Simple hash for caching (djb2-like)
function _hashStringImg(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

const _imageCache: Map<string, string> = new Map();
const _IMAGE_CACHE_PREFIX = 'plugin-ai-summary.img.';

export function clearImageCache() {
  _imageCache.clear();
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i) || '';
        if (k.startsWith(_IMAGE_CACHE_PREFIX)) keys.push(k);
      }
      for (const k of keys) window.localStorage.removeItem(k);
    }
  } catch (e) {
    // ignore
  }
}

export async function generateImageFromText(text: string, opts?: { connectors?: boolean }): Promise<string> {
  type Node = { id: number; title: string; level: number; children: Node[]; parent?: Node | null };

  function buildTreeFromHeadings(input: string): Node[] {
    const lines = input.split(/\r?\n/);
    const roots: Node[] = [];
    const stack: Node[] = [];
    let id = 1;
    for (const raw of lines) {
      const heading = raw.match(/^\s*(#{1,6})\s+(.*)$/);
      if (!heading) continue;
      const level = heading[1].length;
      const rawTitle = heading[2].trim();
      let title = rawTitle;

      // Support a simple 'Title: subtitle' pattern where the subtitle becomes a direct child
      let appendChild: Node | null = null;
      if (/[：:]/.test(rawTitle)) {
        const parts = rawTitle.split(/[：:]/);
        title = parts.shift()!.trim();
        const childTitle = parts.join(':').trim();
        if (childTitle.length > 0) {
          appendChild = { id: id++, title: childTitle, level: Math.min(6, level + 1), children: [], parent: null };
        }
      }

      const node: Node = { id: id++, title, level, children: [], parent: null };

      // Pop stack until we find a parent with smaller level
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      if (stack.length === 0) {
        roots.push(node);
      } else {
        const parent = stack[stack.length - 1];
        parent.children.push(node);
        node.parent = parent;
      }

      // Push node to stack; if we created an appended child, attach and push it too
      stack.push(node);
      if (appendChild) {
        appendChild.parent = node;
        node.children.push(appendChild);
        stack.push(appendChild);
      }
    }
    return roots;
  }

  function buildFallbackTree(input: string): Node[] {
    const lines = input
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(0, 12);
    const roots: Node[] = [];
    let id = 1;
    const root: Node = { id: id++, title: 'Document', level: 1, children: [], parent: null };
    for (const l of lines) {
      root.children.push({ id: id++, title: l.slice(0, 60), level: 2, children: [], parent: root });
    }
    roots.push(root);
    return roots;
  }

  const roots = buildTreeFromHeadings(text);
  const tree = roots.length > 0 ? roots : buildFallbackTree(text);

  // Layout: collect nodes by level. Compute depth from tree and adapt columns, width and gaps.
  const margin = 32;
  // compute structural depth of the parsed tree (max nesting)
  function getTreeDepth(list: Node[]): number {
    let best = 0;
    function walk(nodes: Node[], depth = 1) {
      best = Math.max(best, depth);
      for (const n of nodes) if (n.children && n.children.length) walk(n.children, depth + 1);
    }
    walk(list, 1);
    return best;
  }
  const structuralDepth = Math.max(1, getTreeDepth(tree));
  const maxDepth = Math.min(4, structuralDepth); // support up to 4 adaptive columns
  // adapt column width based on depth and a typical canvas width heuristic
  const colWidth = Math.max(260, Math.min(460, Math.floor(960 / maxDepth)));
  // vertical gap adapts to node density: denser columns need smaller gaps
  let verticalGap = 36; // default

  // Helper: calculate adaptive box dimensions based on text length
  function calcBoxSize(title: string, level = 1): { w: number; h: number } {
    const baseW = 220;
    const maxW = 360;
    const minW = 100;
    const baseH = 60;
    // For level 3 nodes, force single-line sizing and cap to 10 characters
    if (level >= 3) {
      const chars = Array.from(title).slice(0, 10).length;
      const w = Math.max(minW, 16 + chars * 14 + 20); // padding
      const h = 44; // single line height with padding
      return { w, h };
    }
    const charLen = Array.from(title).length;
    // Estimate: ~20 chars per line at 14px font with 10px padding
    const estLines = Math.max(1, Math.ceil(charLen / 20));
    const w = Math.min(maxW, Math.max(minW, 100 + charLen * 8));
    const h = Math.max(baseH, 30 + estLines * 24);
    return { w, h };
  }

  // Collect nodes per level in document order (pre-order traversal)
  const levelsArr: Node[][] = Array.from({ length: maxDepth }, () => [] as Node[]);
  function collect(nlist: Node[], depth = 1) {
    for (const n of nlist) {
      const d = Math.min(maxDepth, depth);
      levelsArr[d - 1].push(n);
      if (n.children && n.children.length > 0) collect(n.children, depth + 1);
    }
  }
  collect(tree, 1);

  // Compute positions: each level is a column; within a level nodes are stacked by their computed heights
  const nodes: { node: Node; x: number; y: number }[] = [];
  // Precompute sizes for all nodes so stacking uses actual heights
  const sizeMap: Map<number, { w: number; h: number }> = new Map();
  for (const lvl of levelsArr) {
    for (const n of lvl) {
      sizeMap.set(n.id, calcBoxSize(n.title, n.level));
    }
  }

  // Adapt vertical gap based on density (nodes per column)
  const maxNodesPerCol = Math.max(0, ...levelsArr.map((c) => c.length));
  if (maxNodesPerCol > 10) verticalGap = 14;
  else if (maxNodesPerCol > 6) verticalGap = 20;
  else if (maxNodesPerCol > 3) verticalGap = 28;
  else verticalGap = 36;

  // For each column, stack nodes top-to-bottom using their heights + verticalGap
  for (let li = 0; li < levelsArr.length; li++) {
    const col = levelsArr[li];
    let cursorY = margin;
    for (let i = 0; i < col.length; i++) {
      const n = col[i];
      const { w, h } = sizeMap.get(n.id)!;
      // left-align boxes within each column with a small left padding
      const columnLeft = margin + li * colWidth;
      const leftPadding = 12;
      const maxBoxW = Math.max(80, colWidth - leftPadding - 12);
      const boxW = Math.min(w, maxBoxW);
      const x = columnLeft + leftPadding;
      const y = cursorY;
      nodes.push({ node: n, x, y });
      // if we capped width, update sizeMap so later rendering uses capped width
      if (boxW !== w) {
        sizeMap.set(n.id, { w: boxW, h });
      }
      cursorY += h + verticalGap;
    }
  }

  const maxLevel = Math.max(1, ...levelsArr.map((c) => (c.length ? levelsArr.indexOf(c) + 1 : 0)));
  
  // Compute canvas size based on adaptive box dimensions and positioned nodes
  let maxY = 0;
  let maxX = 0;
  for (const item of nodes) {
    const { w, h } = sizeMap.get(item.node.id)!;
    maxY = Math.max(maxY, item.y + h);
    maxX = Math.max(maxX, item.x + w);
  }

  const width = Math.max(640, maxX + margin);
  const height = Math.max(220, maxY + margin);

  // Build visual elements: vertical dashed column lines + connector branches + boxes with wrapped text
  const linesArr: string[] = [];
  const boxes: string[] = [];
  const posMap: Map<number, { node: Node; x: number; y: number; w: number; h: number }> = new Map();

  // Precompute unique levels
  const levels = Array.from(new Set(nodes.map((n) => n.node.level))).sort((a, b) => a - b);

  // No vertical separators; use dashed connectors between levels instead.

  const palette = ['#4f46e5', '#7c3aed', '#2563eb', '#06b6d4', '#1d4ed8'];

  // First pass: compute all box sizes and positions
  for (const item of nodes) {
    const { node, x, y } = item;
    const { w, h } = sizeMap.get(node.id) ?? calcBoxSize(node.title, node.level);
    const boxX = x;
    const boxY = y;
    posMap.set(node.id, { node, x: boxX, y: boxY, w, h });
  }

  // Draw grouped trunk + branches orthogonal connectors between level-1->2 and level-2->3
  // Respect opts.connectors (default true)
  const drawConnectors = opts?.connectors !== false;
  if (drawConnectors) {
    // For each parent node (level 1 or 2) with immediate children, draw:
    // 1) a short horizontal from the parent box to a shared trunk X,
    // 2) a vertical trunk spanning all children mid-Ys,
    // 3) per-child horizontal branches from trunk to child box.
    for (const item of nodes) {
      const { node } = item;
      if (!node.children || node.children.length === 0) continue;
      if (node.level !== 1 && node.level !== 2) continue;
      const parentPos = posMap.get(node.id);
      if (!parentPos) continue;
      const parentRightX = parentPos.x + parentPos.w;
      const parentMidY = parentPos.y + parentPos.h / 2;

      // Collect valid immediate-child positions
      const childInfos: { leftX: number; midY: number }[] = [];
      for (const child of node.children) {
        if (child.level !== node.level + 1) continue;
        const cp = posMap.get(child.id);
        if (!cp) continue;
        childInfos.push({ leftX: cp.x, midY: cp.y + cp.h / 2 });
      }
      if (childInfos.length === 0) continue;

      // Determine trunk X: prefer a point with some indent from parent, but before children
      const indent = 36 + node.level * 6; // tunable
      const startX = parentRightX + 6; // start a few px outside parent box
      const minChildLeft = Math.min(...childInfos.map((c) => c.leftX));
      const maxChildLeft = Math.max(...childInfos.map((c) => c.leftX));
      // trunkX should sit between startX and (minChildLeft - 8)
      let trunkX = Math.min(parentRightX + indent, minChildLeft - 12);
      if (trunkX <= startX + 6) trunkX = startX + Math.min(24, Math.max(8, indent));

      // Draw main horizontal from parent to trunkX (at parentMidY)
      const safeStartX = startX;
      const mainPath = `M ${safeStartX} ${parentMidY} L ${trunkX} ${parentMidY}`;
      linesArr.push(`<path d='${mainPath}' stroke='#9ca3af' stroke-width='1.2' fill='none' stroke-linecap='round' stroke-linejoin='round' opacity='0.95'/>`);

      // If only one child, draw a simple elbow from trunkX to child
      if (childInfos.length === 1) {
        const child = childInfos[0];
        const branchEndX = Math.max(child.leftX - 6, trunkX + 6);
        const branchPath = `M ${trunkX} ${parentMidY} L ${trunkX} ${child.midY} L ${branchEndX} ${child.midY}`;
        linesArr.push(`<path d='${branchPath}' stroke='#9ca3af' stroke-width='1.2' fill='none' stroke-linecap='round' stroke-linejoin='round' opacity='0.95'/>`);
        continue;
      }

      // For multiple children: draw vertical trunk between top and bottom child midYs, then branches
      const topY = Math.min(...childInfos.map((c) => c.midY));
      const bottomY = Math.max(...childInfos.map((c) => c.midY));
      // Vertical trunk from topY to bottomY at trunkX
      const trunkPath = `M ${trunkX} ${topY} L ${trunkX} ${bottomY}`;
      linesArr.push(`<path d='${trunkPath}' stroke='#9ca3af' stroke-width='1.2' fill='none' stroke-linecap='round' stroke-linejoin='round' opacity='0.9'/>`);

      // For each child draw short horizontal from trunkX to child (ending just before box)
      for (const child of childInfos) {
        const branchEndX = Math.max(child.leftX - 6, trunkX + 6);
        const branchPath = `M ${trunkX} ${child.midY} L ${branchEndX} ${child.midY}`;
        linesArr.push(`<path d='${branchPath}' stroke='#9ca3af' stroke-width='1.2' fill='none' stroke-linecap='round' stroke-linejoin='round' opacity='0.95'/>`);
      }
    }
  }

  // Second pass: render boxes with adaptive sizes
  for (const [, pos] of posMap) {
    const { node, x: boxX, y: boxY, w, h } = pos;
    // For level 3 nodes, render only first 10 characters (single line) and no background
    const rawTitle = node.title;
    const displayTitle = node.level >= 3 ? Array.from(rawTitle).slice(0, 10).join('') : rawTitle;
    const safeTitle = displayTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    if (node.level >= 3) {
      // Plain text, no background box
      boxes.push(`
      <g>
        <foreignObject x='${boxX}' y='${boxY}' width='${w}' height='${h}'>
          <div xmlns='http://www.w3.org/1999/xhtml' style='font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #e5e7eb; font-size:13px; padding:6px 8px; line-height:1; overflow:hidden; display:flex; align-items:center;'>
            <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${safeTitle}</div>
          </div>
        </foreignObject>
      </g>
    `);
      } else {
      const fill = palette[(node.level - 1) % palette.length];
      // Use foreignObject so text can wrap and show emoji/icons
      boxes.push(`
      <g>
        <rect x='${boxX}' y='${boxY}' width='${w}' height='${h}' rx='14' fill='${fill}' opacity='1' filter='url(#boxShadow)' />
        <foreignObject x='${boxX}' y='${boxY}' width='${w}' height='${h}'>
          <div xmlns='http://www.w3.org/1999/xhtml' style='font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: rgba(255,255,255,0.96); font-size:14px; padding:10px; line-height:1.2; overflow:hidden; display:flex; align-items:center;'>
            <div style="word-break:break-word; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${safeTitle}</div>
          </div>
        </foreignObject>
      </g>
    `);
    }
  }

  // Use Electron-like deep background color and add defs for shadow
  const bgColor = '#0b0f14';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>\n  <defs>\n    <filter id='boxShadow' x='-50%' y='-50%' width='200%' height='200%'>\n      <feDropShadow dx='0' dy='4' stdDeviation='8' flood-color='#000000' flood-opacity='0.45'/>\n    </filter>\n  </defs>\n  <rect width='100%' height='100%' fill='${bgColor}'/>\n  ${linesArr.join('\n  ')}\n  ${boxes.join('\n  ')}\n</svg>`;

  // Encode for Node/browser
  let b64: string;
  try {
    // @ts-ignore
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
      // @ts-ignore
      b64 = Buffer.from(svg).toString('base64');
    } else if (typeof btoa !== 'undefined') {
      b64 = btoa(unescape(encodeURIComponent(svg)));
    } else {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }
  } catch (e) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  return `data:image/svg+xml;base64,${b64}`;
}
