import type {
  Blockquote,
  Code,
  Content,
  Definition,
  Delete,
  Emphasis,
  FootnoteDefinition,
  FootnoteReference,
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

import { defaultSanitizeHtml, isHtmlComment, sanitizeUrl } from "./html-sanitizer";
import type { ExportHTMLResult, ExportHTMLSourceMapEntry } from "./types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function textOf(children: readonly Content[] | undefined): string {
  if (!children) return "";
  return children.map((child) => {
    if ("value" in child && typeof child.value === "string") return child.value;
    if ("children" in child && Array.isArray(child.children)) return textOf(child.children as Content[]);
    return "";
  }).join("");
}

type ResolveLineAtOffset = (offset: number) => number;

function sourceEntry(
  node: { type?: string; position?: RootContent["position"] },
  resolveLineAtOffset?: ResolveLineAtOffset
): ExportHTMLSourceMapEntry | null {
  const start = node.position?.start;
  const end = node.position?.end;
  if (typeof start?.offset !== "number") return null;
  return {
    line: typeof start.line === "number" && start.line >= 1
      ? start.line
      : resolveLineAtOffset?.(start.offset) ?? 0,
    offset: start.offset,
    endLine: typeof end?.line === "number" && end.line >= 1
      ? end.line
      : typeof end?.offset === "number"
        ? resolveLineAtOffset?.(end.offset)
        : undefined,
    endOffset: typeof end?.offset === "number" ? end.offset : undefined,
    type: node.type ?? "unknown",
  };
}

function sourceAttrs(entry: ExportHTMLSourceMapEntry | null): string {
  if (!entry) return "";
  const attrs = [
    `data-source-line="${entry.line}"`,
    `data-source-offset="${entry.offset}"`,
    `data-source-type="${escapeAttr(entry.type)}"`,
  ];
  if (typeof entry.endLine === "number") attrs.push(`data-source-end-line="${entry.endLine}"`);
  if (typeof entry.endOffset === "number") attrs.push(`data-source-end-offset="${entry.endOffset}"`);
  return ` ${attrs.join(" ")}`;
}

function withSource(
  tagName: string,
  node: { type?: string; position?: RootContent["position"] },
  inner = "",
  extraAttrs = "",
  voidElement = false,
  sourceMap?: ExportHTMLSourceMapEntry[],
  resolveLineAtOffset?: ResolveLineAtOffset
): string {
  const entry = sourceMap ? sourceEntry(node, resolveLineAtOffset) : null;
  if (entry) sourceMap?.push(entry);
  const attrs = `${extraAttrs}${sourceAttrs(entry)}`;
  if (voidElement) return `<${tagName}${attrs}>`;
  return `<${tagName}${attrs}>${inner}</${tagName}>`;
}

function renderInline(node: Content): string {
  switch (node.type) {
    case "text":
      return escapeHtml((node as Text).value);
    case "strong":
      return `<strong>${(node as Strong).children.map((child) => renderInline(child as Content)).join("")}</strong>`;
    case "emphasis":
      return `<em>${(node as Emphasis).children.map((child) => renderInline(child as Content)).join("")}</em>`;
    case "delete":
      return `<del>${(node as Delete).children.map((child) => renderInline(child as Content)).join("")}</del>`;
    case "inlineCode":
      return `<code>${escapeHtml((node as InlineCode).value)}</code>`;
    case "link": {
      const link = node as Link;
      const title = link.title ? ` title="${escapeAttr(link.title)}"` : "";
      return `<a href="${escapeAttr(sanitizeUrl(link.url))}" rel="noopener noreferrer"${title}>${link.children
        .map((child) => renderInline(child as Content))
        .join("")}</a>`;
    }
    case "image": {
      const image = node as Image;
      const title = image.title ? ` title="${escapeAttr(image.title)}"` : "";
      return `<img src="${escapeAttr(sanitizeUrl(image.url))}" alt="${escapeAttr(image.alt ?? "")}"${title}>`;
    }
    case "footnoteReference":
      return `<sup>${escapeHtml((node as FootnoteReference).identifier)}</sup>`;
    default:
      return escapeHtml(textOf("children" in node ? (node.children as Content[]) : undefined));
  }
}

function renderInlineChildren(children: readonly Content[] | undefined): string {
  return (children ?? []).map((child) => renderInline(child)).join("");
}

function renderListItem(
  item: ListItem,
  sourceMap?: ExportHTMLSourceMapEntry[],
  resolveLineAtOffset?: ResolveLineAtOffset
): string {
  const inner = item.children.map((child) => {
    if (child.type === "paragraph") return renderInlineChildren((child as Paragraph).children as Content[]);
    return renderBlock(child as RootContent, sourceMap, resolveLineAtOffset);
  }).join("");
  return withSource("li", item, inner, "", false, sourceMap, resolveLineAtOffset);
}

function renderTable(
  table: Table,
  sourceMap?: ExportHTMLSourceMapEntry[],
  resolveLineAtOffset?: ResolveLineAtOffset
): string {
  const rows = table.children as TableRow[];
  const body = rows.map((row, rowIndex) => {
    const cells = (row.children as TableCell[]).map((cell) => {
      const tag = rowIndex === 0 ? "th" : "td";
      return `<${tag}>${renderInlineChildren(cell.children as Content[])}</${tag}>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return withSource("table", table, body, "", false, sourceMap, resolveLineAtOffset);
}

function renderDefinition(
  definition: Definition | FootnoteDefinition,
  sourceMap?: ExportHTMLSourceMapEntry[],
  resolveLineAtOffset?: ResolveLineAtOffset
): string {
  return withSource(
    "div",
    definition,
    escapeHtml("value" in definition && typeof definition.value === "string" ? definition.value : ""),
    ' hidden=""',
    false,
    sourceMap,
    resolveLineAtOffset
  );
}

function renderBlock(
  node: RootContent,
  sourceMap?: ExportHTMLSourceMapEntry[],
  resolveLineAtOffset?: ResolveLineAtOffset
): string {
  switch (node.type) {
    case "heading": {
      const heading = node as Heading;
      const depth = Math.max(1, Math.min(6, heading.depth));
      return withSource(`h${depth}`, heading, renderInlineChildren(heading.children as Content[]), "", false, sourceMap, resolveLineAtOffset);
    }
    case "paragraph": {
      const paragraph = node as Paragraph;
      return withSource("p", paragraph, renderInlineChildren(paragraph.children as Content[]), "", false, sourceMap, resolveLineAtOffset);
    }
    case "blockquote": {
      const quote = node as Blockquote;
      return withSource(
        "blockquote",
        quote,
        quote.children.map((child) => renderBlock(child as RootContent, sourceMap, resolveLineAtOffset)).join(""),
        "",
        false,
        sourceMap,
        resolveLineAtOffset
      );
    }
    case "list": {
      const list = node as List;
      const tag = list.ordered ? "ol" : "ul";
      return withSource(
        tag,
        list,
        list.children.map((item) => renderListItem(item, sourceMap, resolveLineAtOffset)).join(""),
        "",
        false,
        sourceMap,
        resolveLineAtOffset
      );
    }
    case "code": {
      const code = node as Code;
      const className = code.lang ? ` class="language-${escapeAttr(code.lang)}"` : "";
      return withSource("pre", code, `<code${className}>${escapeHtml(code.value)}</code>`, "", false, sourceMap, resolveLineAtOffset);
    }
    case "table":
      return renderTable(node as Table, sourceMap, resolveLineAtOffset);
    case "thematicBreak":
      return withSource("hr", node as ThematicBreak, "", "", true, sourceMap, resolveLineAtOffset);
    case "html": {
      const html = node as Html;
      const raw = html.value ?? "";
      const inner = isHtmlComment(raw)
        ? `<div class="nexus-html-comment">${escapeHtml(raw)}</div>`
        : defaultSanitizeHtml(raw);
      return withSource("div", html, inner, ' class="nexus-html-block-content"', false, sourceMap, resolveLineAtOffset);
    }
    case "definition":
    case "footnoteDefinition":
      return renderDefinition(node as Definition | FootnoteDefinition, sourceMap, resolveLineAtOffset);
    default:
      return withSource(
        "p",
        node,
        escapeHtml(textOf("children" in node ? (node.children as Content[]) : undefined)),
        "",
        false,
        sourceMap,
        resolveLineAtOffset
      );
  }
}

export function exportMarkdownHtml(root: Root, sourceMapEnabled: true, resolveLineAtOffset?: ResolveLineAtOffset): ExportHTMLResult;
export function exportMarkdownHtml(root: Root, sourceMapEnabled?: false): string;
export function exportMarkdownHtml(
  root: Root,
  sourceMapEnabled = false,
  resolveLineAtOffset?: ResolveLineAtOffset
): string | ExportHTMLResult {
  const sourceMap: ExportHTMLSourceMapEntry[] | undefined = sourceMapEnabled ? [] : undefined;
  const html = root.children.map((child) => renderBlock(child, sourceMap, resolveLineAtOffset)).join("\n");
  if (!sourceMapEnabled) return html;
  return { html, sourceMap: sourceMap ?? [] };
}
