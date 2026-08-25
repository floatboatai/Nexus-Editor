/**
 * HTML `<table>` → GFM pipe-table conversion for smart paste.
 *
 * Pure function: takes the `text/html` clipboard flavor, returns the Markdown
 * serialization or `null` when the markup does not contain a convertible table.
 * No editor-instance coupling, so the converter is unit-testable in isolation.
 *
 * DOMParser (browser-native) is used instead of a converter dependency — the
 * table subset we serialize (rows, cells, alignment, inline formatting) is
 * small enough that a hand-rolled walker is both smaller than turndown and
 * strict about what it emits.
 */

const ALIGNMENTS = new Set(["left", "center", "right"]);

type CellAlignment = "left" | "center" | "right" | null;

/** Convert an HTML fragment to a GFM pipe table. Returns `null` when not a table. */
export function htmlTableToGfm(html: string): string | null {
  if (!html || typeof DOMParser === "undefined") return null;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }

  const table = doc.querySelector("table");
  if (!table) return null;

  const rows = Array.from(table.querySelectorAll("tr"));
  if (rows.length === 0) return null;

  const matrix = rows.map((row) =>
    Array.from(row.querySelectorAll("th,td")).map((cell) => ({
      text: serializeCell(cell),
      alignment: readCellAlignment(cell),
    })),
  );

  const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  if (width === 0) return null;

  // Ragged rows: pad to the widest row, drop overflow cells. GFM tables are
  // rectangular; silently normalizing beats emitting a table that re-parses
  // with a different column count than the user saw in the source.
  const normalized = matrix.map((row) => {
    const cells = row.slice(0, width).map((cell) => cell.text);
    while (cells.length < width) cells.push("");
    return cells;
  });

  // GFM alignment lives in the delimiter row, derived from the header cells.
  const headerRow = matrix[0];
  const delimiter = Array.from({ length: width }, (_, column) =>
    delimiterCell(headerRow[column]?.alignment),
  );

  return [
    formatGfmRow(normalized[0]),
    formatGfmRow(delimiter),
    ...normalized.slice(1).map(formatGfmRow),
  ].join("\n");
}

function delimiterCell(alignment: CellAlignment): string {
  switch (alignment) {
    case "center":
      return ":---:";
    case "right":
      return "---:";
    case "left":
      return ":---";
    default:
      return "---";
  }
}

function formatGfmRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function readCellAlignment(cell: Element): CellAlignment {
  const attribute = cell.getAttribute("align");
  if (attribute && ALIGNMENTS.has(attribute.toLowerCase())) {
    return attribute.toLowerCase() as Exclude<CellAlignment, null>;
  }

  // Word/Excel serialize alignment as inline style; match `text-align` in
  // either quoted or unquoted form.
  const style = cell.getAttribute("style") ?? "";
  const match = /text-align\s*:\s*["']?(left|center|right)\b/i.exec(style);
  return match ? (match[1].toLowerCase() as Exclude<CellAlignment, null>) : null;
}

function serializeCell(cell: Element): string {
  return serializeChildren(cell);
}

/**
 * Serialize an element's children into inline Markdown. Unknown wrapper
 * elements (span, div, font, Office namespaced tags…) are transparent — only
 * their text survives — so office clipboard noise never leaks into the output.
 *
 * Whitespace is collapsed and trimmed at each formatting boundary (not only at
 * the cell level) because `** a **` is not a valid CommonMark emphasis.
 */
function serializeChildren(element: Element): string {
  return Array.from(element.childNodes)
    .map(serializeNode)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapePipe(node.textContent ?? "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as Element;
  switch (element.tagName.toLowerCase()) {
    case "br":
      // GFM cells cannot contain line breaks.
      return " ";
    case "strong":
    case "b": {
      const inner = serializeChildren(element);
      return inner ? `**${inner}**` : "";
    }
    case "em":
    case "i": {
      const inner = serializeChildren(element);
      return inner ? `*${inner}*` : "";
    }
    case "code": {
      const raw = escapePipe(element.textContent ?? "");
      // A cell containing backticks cannot form a single code span; fall back
      // to plain escaped text rather than emit broken Markdown.
      return !raw || raw.includes("`") ? raw : `\`${raw}\``;
    }
    case "a": {
      const inner = serializeChildren(element);
      const href = element.getAttribute("href");
      return inner && href ? formatLink(inner, href) : inner;
    }
    case "img": {
      const src = element.getAttribute("src");
      const alt = element.getAttribute("alt") ?? "";
      return src ? `![${escapeSquareBrackets(alt)}](${formatLinkTarget(src)})` : "";
    }
    case "table":
      // Nested tables cannot nest inside a GFM cell; flatten to text.
      return escapePipe(element.textContent ?? "");
    default:
      return serializeChildren(element);
  }
}

function escapePipe(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function escapeSquareBrackets(text: string): string {
  return text.replace(/([[\\\]])/g, "\\$1");
}

/** Shared with url-linkify: spaces / parentheses force the angle-bracket target form. */
export function formatLinkTarget(url: string): string {
  return /[\s()]/.test(url) ? `<${url}>` : url;
}

function formatLink(label: string, url: string): string {
  return `[${escapeSquareBrackets(label)}](${formatLinkTarget(url)})`;
}
