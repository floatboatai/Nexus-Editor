export async function generateImageFromText(text: string): Promise<string> {
  // 将文本解析为以 Markdown 标题为准的树结构，并渲染为简单的 SVG 树图。
  type Node = { id: number; title: string; level: number; children: Node[]; parent?: Node | null };

  function buildTreeFromHeadings(input: string): Node[] {
    const lines = input.split(/\r?\n/);
    const roots: Node[] = [];
    const stack: Node[] = [];
    let id = 1;
    for (const raw of lines) {
      const heading = raw.match(/^\s*(#{1,6})\s+(.*)$/);
      const list = raw.match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        const title = heading[2].trim();
        const node: Node = { id: id++, title, level, children: [], parent: null };
        while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
        if (stack.length === 0) {
          roots.push(node);
        } else {
          const parent = stack[stack.length - 1];
          parent.children.push(node);
          node.parent = parent;
        }
        stack.push(node);
      } else if (list) {
        const title = list[2].trim();
        const parent = stack.length > 0 ? stack[stack.length - 1] : null;
        const level = parent ? parent.level + 1 : 2;
        const node: Node = { id: id++, title, level, children: [], parent: parent };
        if (parent) parent.children.push(node);
        else roots.push(node);
        // NOTE: do NOT push list items onto the heading stack. Pushing
        // causes subsequent headings to become children of a list item.
        // Nested lists are not deeply supported in this stub; keep list
        // items as siblings under their nearest heading.
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

  // Layout: collect nodes by level (support up to 3 levels). Ensure same-level headings line up vertically.
  const colWidth = 260;
  const rowHeight = 84;
  const margin = 28;
  const maxDepth = 3;

  // Helper: calculate adaptive box dimensions based on text length
  function calcBoxSize(title: string): { w: number; h: number } {
    const baseW = 220;
    const maxW = 320;
    const minW = 120;
    const baseH = 60;
    const charLen = title.length;
    // Estimate: ~20 chars per line at 14px font with 10px padding
    const estLines = Math.max(1, Math.ceil(charLen / 20));
    const w = Math.min(maxW, Math.max(minW, 100 + charLen * 8));
    const h = Math.max(baseH, 30 + estLines * 24);
    return { w, h };
  }

  // Collect nodes per level in document order (pre-order traversal)
  const levelsArr: Node[][] = [[], [], []];
  function collect(nlist: Node[], depth = 1) {
    for (const n of nlist) {
      const d = Math.min(maxDepth, depth);
      levelsArr[d - 1].push(n);
      if (n.children && n.children.length > 0) collect(n.children, depth + 1);
    }
  }
  collect(tree, 1);

  // Compute positions: each level is a column; within a level nodes are stacked by order
  const nodes: { node: Node; x: number; y: number }[] = [];
  let maxCount = 0;
  for (let li = 0; li < levelsArr.length; li++) {
    const col = levelsArr[li];
    maxCount = Math.max(maxCount, col.length);
    for (let i = 0; i < col.length; i++) {
      const n = col[i];
      const x = margin + li * colWidth;
      const y = margin + i * rowHeight;
      nodes.push({ node: n, x, y });
    }
  }

  const maxLevel = Math.max(1, ...levelsArr.map((c) => (c.length ? levelsArr.indexOf(c) + 1 : 0)));
  
  // Compute canvas size based on adaptive box dimensions
  let maxY = 0;
  for (const item of nodes) {
    const { w, h } = calcBoxSize(item.node.title);
    maxY = Math.max(maxY, item.y + h);
  }
  
  const width = Math.max(640, margin * 2 + maxDepth * colWidth);
  const height = Math.max(220, maxY + margin);

  // Build visual elements: vertical dashed column lines + connector branches + boxes with wrapped text
  const linesArr: string[] = [];
  const boxes: string[] = [];
  const posMap: Map<number, { node: Node; x: number; y: number; w: number; h: number }> = new Map();

  // Precompute unique levels
  const levels = Array.from(new Set(nodes.map((n) => n.node.level))).sort((a, b) => a - b);

  // No vertical separators; use dashed connectors between levels instead.

  const palette = ['#4338ca', '#7c3aed', '#1e40af', '#0ea5a3', '#2563eb'];

  // First pass: compute all box sizes and positions
  for (const item of nodes) {
    const { node, x, y } = item;
    const { w, h } = calcBoxSize(node.title);
    const boxX = x;
    const boxY = y;
    posMap.set(node.id, { node, x: boxX, y: boxY, w, h });
  }

  // Connector layout constants (tweak to match visual sample)
  const axisOffset = 40; // how far left of the parent box the vertical axis sits
  const stubGap = 12; // gap between axis and box edge for horizontal stubs
  const dashArray = '6,6';

  // Draw connectors: from parent to all children
  for (const item of nodes) {
    const { node } = item;
    const nodePos = posMap.get(node.id)!;
    const { x: nodeX, y: nodeY, w: nodeW, h: nodeH } = nodePos;
    const nodeMidY = nodeY + nodeH / 2;
    const axisX = nodeX - axisOffset;

    // For each child, draw vertical then horizontal dashed connector
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        const childPos = posMap.get(child.id);
        if (childPos) {
          const { y: childY, h: childH } = childPos;
          const childMidY = childY + childH / 2;

          // Vertical dashed line from parent mid to child mid at axisX
          // Horizontal dashed from axis to parent box (small stub)
          const parentStubStart = axisX + stubGap;
          const parentStubEnd = nodePos.x - stubGap;
          if (parentStubEnd > parentStubStart) {
            linesArr.push(`<path d='M ${parentStubStart} ${nodeMidY} L ${parentStubEnd} ${nodeMidY}' stroke='#9ca3af' stroke-width='1.5' stroke-linecap='round' stroke-dasharray='${dashArray}' opacity='0.45'/>`);
          }

          // Vertical dashed line from parent mid to child mid at axisX
          linesArr.push(`<path d='M ${axisX} ${nodeMidY} L ${axisX} ${childMidY}' stroke='#9ca3af' stroke-width='1.5' stroke-linecap='round' stroke-dasharray='${dashArray}' opacity='0.45'/>`);

          // Horizontal dashed from axis to child box (leave small gap)
          const startX = axisX + stubGap;
          const endX = childPos.x - stubGap;
          if (endX > startX) {
            linesArr.push(`<path d='M ${startX} ${childMidY} L ${endX} ${childMidY}' stroke='#9ca3af' stroke-width='1.5' stroke-linecap='round' stroke-dasharray='${dashArray}' opacity='0.45'/>`);
          }
        }
      }
    }
  }

  // Second pass: render boxes with adaptive sizes
  for (const [, pos] of posMap) {
    const { node, x: boxX, y: boxY, w, h } = pos;
    // box background color by level
    const fill = palette[(node.level - 1) % palette.length];
    const safeTitle = node.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Use foreignObject so text can wrap and show emoji/icons
    boxes.push(`
      <g>
        <rect x='${boxX}' y='${boxY}' width='${w}' height='${h}' rx='12' fill='${fill}' opacity='1' />
        <foreignObject x='${boxX}' y='${boxY}' width='${w}' height='${h}'>
          <div xmlns='http://www.w3.org/1999/xhtml' style='font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: rgba(255,255,255,0.95); font-size:14px; padding:10px; line-height:1.2; overflow:hidden; display:flex; align-items:center;'>
            <div style="word-break:break-word;">${safeTitle}</div>
          </div>
        </foreignObject>
      </g>
    `);
  }

  // Use Electron-like deep background color
  const bgColor = '#0b0f14';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>\n  <rect width='100%' height='100%' fill='${bgColor}'/>\n  ${linesArr.join('\n  ')}\n  ${boxes.join('\n  ')}\n</svg>`;

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
