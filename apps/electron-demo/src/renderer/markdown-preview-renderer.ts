import type {
  Blockquote,
  Code,
  Content,
  Delete,
  Emphasis,
  Heading,
  Html,
  Image,
  InlineCode,
  Link,
  List,
  ListItem,
  Paragraph,
  Root,
  RootContent,
  Strong,
  Table,
  TableCell,
  TableRow,
  Text,
  ThematicBreak,
} from "mdast";

function markSource(
  el: HTMLElement,
  node: { type?: string; position?: { start?: { line?: number; offset?: number }; end?: { line?: number; offset?: number } } }
): HTMLElement {
  const line = node.position?.start?.line;
  const offset = node.position?.start?.offset;
  const endLine = node.position?.end?.line;
  const endOffset = node.position?.end?.offset;
  if (typeof line === "number" && Number.isFinite(line)) el.dataset.sourceLine = String(line);
  if (typeof offset === "number" && Number.isFinite(offset)) el.dataset.sourceOffset = String(offset);
  if (typeof endLine === "number" && Number.isFinite(endLine)) el.dataset.sourceEndLine = String(endLine);
  if (typeof endOffset === "number" && Number.isFinite(endOffset)) el.dataset.sourceEndOffset = String(endOffset);
  if (node.type) el.dataset.sourceType = node.type;
  return el;
}

function textOf(children: readonly Content[] | undefined): string {
  if (!children) return "";
  return children.map((child) => {
    if ("value" in child && typeof child.value === "string") return child.value;
    if ("children" in child && Array.isArray(child.children)) return textOf(child.children as Content[]);
    return "";
  }).join("");
}

function renderInline(node: Content): Node {
  switch (node.type) {
    case "text":
      return document.createTextNode((node as Text).value);
    case "strong": {
      const el = document.createElement("strong");
      for (const child of (node as Strong).children) el.appendChild(renderInline(child as Content));
      return el;
    }
    case "emphasis": {
      const el = document.createElement("em");
      for (const child of (node as Emphasis).children) el.appendChild(renderInline(child as Content));
      return el;
    }
    case "delete": {
      const el = document.createElement("del");
      for (const child of (node as Delete).children) el.appendChild(renderInline(child as Content));
      return el;
    }
    case "inlineCode": {
      const el = document.createElement("code");
      el.textContent = (node as InlineCode).value;
      return el;
    }
    case "link": {
      const link = node as Link;
      const el = document.createElement("a");
      el.href = link.url;
      el.rel = "noopener noreferrer";
      if (link.title) el.title = link.title;
      for (const child of link.children) el.appendChild(renderInline(child as Content));
      return el;
    }
    case "image": {
      const image = node as Image;
      const el = document.createElement("img");
      el.src = image.url;
      el.alt = image.alt ?? "";
      if (image.title) el.title = image.title;
      return el;
    }
    default:
      return document.createTextNode(textOf("children" in node ? (node.children as Content[]) : undefined));
  }
}

function appendInlineChildren(el: HTMLElement, children: readonly Content[] | undefined): void {
  for (const child of children ?? []) el.appendChild(renderInline(child));
}

function renderListItem(item: ListItem): HTMLElement {
  const el = document.createElement("li");
  for (const child of item.children) {
    if (child.type === "paragraph") {
      appendInlineChildren(el, (child as Paragraph).children as Content[]);
    } else {
      el.appendChild(renderBlock(child as RootContent));
    }
  }
  return markSource(el, item);
}

function renderTable(table: Table): HTMLElement {
  const el = document.createElement("table");
  const rows = table.children as TableRow[];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const tr = document.createElement("tr");
    const row = rows[rowIndex];
    for (const cell of row.children as TableCell[]) {
      const td = document.createElement(rowIndex === 0 ? "th" : "td");
      appendInlineChildren(td, cell.children as Content[]);
      tr.appendChild(td);
    }
    el.appendChild(tr);
  }
  return markSource(el, table);
}

function renderBlock(node: RootContent): HTMLElement {
  switch (node.type) {
    case "heading": {
      const heading = node as Heading;
      const el = document.createElement(`h${heading.depth}`);
      appendInlineChildren(el, heading.children as Content[]);
      return markSource(el, heading);
    }
    case "paragraph": {
      const paragraph = node as Paragraph;
      const el = document.createElement("p");
      appendInlineChildren(el, paragraph.children as Content[]);
      return markSource(el, paragraph);
    }
    case "blockquote": {
      const quote = node as Blockquote;
      const el = document.createElement("blockquote");
      for (const child of quote.children) el.appendChild(renderBlock(child as RootContent));
      return markSource(el, quote);
    }
    case "list": {
      const list = node as List;
      const el = document.createElement(list.ordered ? "ol" : "ul");
      for (const item of list.children) el.appendChild(renderListItem(item));
      return markSource(el, list);
    }
    case "code": {
      const code = node as Code;
      const pre = document.createElement("pre");
      const codeEl = document.createElement("code");
      codeEl.textContent = code.value;
      if (code.lang) codeEl.className = `language-${code.lang}`;
      pre.appendChild(codeEl);
      return markSource(pre, code);
    }
    case "table":
      return renderTable(node as Table);
    case "thematicBreak": {
      const el = document.createElement("hr");
      return markSource(el, node as ThematicBreak);
    }
    case "html": {
      const el = document.createElement("div");
      el.innerHTML = (node as Html).value;
      return markSource(el, node as Html);
    }
    default: {
      const el = document.createElement("p");
      el.textContent = textOf("children" in node ? (node.children as Content[]) : undefined);
      return markSource(el, node);
    }
  }
}

export function renderMarkdownPreview(root: Root): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const child of root.children) fragment.appendChild(renderBlock(child));
  return fragment;
}
