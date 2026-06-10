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
  const width = Math.max(640, margin * 2 + maxDepth * colWidth);
  const height = Math.max(220, margin * 2 + maxCount * rowHeight);

  // Build visual elements: vertical dashed column lines + connector branches + boxes with wrapped text
  const linesArr: string[] = [];
  const boxes: string[] = [];

  // Precompute unique levels
  const levels = Array.from(new Set(nodes.map((n) => n.node.level))).sort((a, b) => a - b);

  // Vertical dashed guide lines per level (positioned slightly left of the boxes column)
  for (const lvl of levels) {
    const xLine = margin + (lvl - 1) * colWidth - 30;
    linesArr.push(`<line x1='${xLine}' y1='${margin}' x2='${xLine}' y2='${height - margin}' stroke='#374151' stroke-width='2' stroke-dasharray='6,6' opacity='0.35'/>`);
  }

  const palette = ['#4338ca', '#7c3aed', '#1e40af', '#0ea5a3', '#2563eb'];

  for (const item of nodes) {
    const { node, x, y } = item;
    const w = 220;
    const h = 60;
    const boxX = x;
    const boxY = y;
    const vertX = margin + (node.level - 1) * colWidth - 30;

    // connector: horizontal line from vertical guide to box left
    const startX = vertX + 8;
    const endX = boxX - 8;
    const midY = boxY + h / 2;
    if (endX > startX) {
      linesArr.push(`<path d='M ${startX} ${midY} L ${endX} ${midY}' stroke='#9ca3af' stroke-width='1.5' stroke-linecap='round' opacity='0.45'/>`);
    }

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
