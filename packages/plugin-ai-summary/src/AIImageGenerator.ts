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
        const level = m[1].length;
        const title = m[2].trim();
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
      }
        } else if (list) {
          const title = list[2].trim();
          // attach to nearest heading (stack top) or to roots
          const parent = stack.length > 0 ? stack[stack.length - 1] : null;
          const level = parent ? parent.level + 1 : 2;
          const node: Node = { id: id++, title, level, children: [], parent: parent };
          if (parent) parent.children.push(node);
          else roots.push(node);
          // push list items onto stack so nested lists work
          stack.push(node);
        }
        // otherwise ignore non-heading/list lines here (fallback handles them)
    }
    return roots;
    // Use Electron-like deep background color
    const bgColor = '#0b0f14';
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>\n  <rect width='100%' height='100%' fill='${bgColor}'/>\n  ${lines.join('\n  ')}\n  ${boxes.join('\n  ')}\n</svg>`;

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

  // Layout
  const colWidth = 220;
  const rowHeight = 56;
  const margin = 20;
  const nodes: { node: Node; x: number; y: number }[] = [];
  let currentY = margin + 20;

  function walk(nlist: Node[], level = 1) {
    for (const n of nlist) {
      const x = margin + (level - 1) * colWidth;
      const y = currentY;
      nodes.push({ node: n, x, y });
      currentY += rowHeight;
      if (n.children && n.children.length > 0) walk(n.children, level + 1);
    }
  }

  walk(tree, 1);

  const maxLevel = Math.max(...nodes.map((n) => n.node.level), 1);
  const width = Math.max(600, margin * 2 + maxLevel * colWidth);
  const height = Math.max(200, currentY + margin);

  const lines: string[] = [];
  const boxes: string[] = [];
  for (const item of nodes) {
    const { node, x, y } = item;
    const w = 180;
    const h = 40;
    const cx = x + w / 2;
    const cy = y + h / 2;
    if (node.parent) {
      const p = nodes.find((it) => it.node === node.parent);
      if (p) {
        const px = p.x + w / 2;
        const py = p.y + h / 2;
        lines.push(`<line x1='${px}' y1='${py}' x2='${cx}' y2='${cy}' stroke='#9ca3af' stroke-width='2' />`);
      }
    }
    const safeTitle = node.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    boxes.push(`<rect x='${x}' y='${y}' width='${w}' height='${h}' rx='6' fill='#0f172a' stroke='#374151' />`);
    boxes.push(`<text x='${x + 12}' y='${y + 24}' font-family='system-ui, -apple-system, Segoe UI, Roboto, sans-serif' font-size='13' fill='#fff'>${safeTitle}</text>`);
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>\n  <rect width='100%' height='100%' fill='#0b1220'/>\n  ${lines.join('\n  ')}\n  ${boxes.join('\n  ')}\n</svg>`;

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
