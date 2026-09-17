/**
 * Clipboard HTML → Markdown converter.
 *
 * Used by the editor paste path (`htmlPaste`) and exported for hosts that
 * want to convert HTML without creating an editor. No Turndown / extra
 * runtime dependency — the tag set we accept is small enough to walk with
 * DOMParser.
 */

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "META",
  "LINK",
  "HEAD",
  "IFRAME",
  "OBJECT",
  "EMBED",
]);

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "DL",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "UL",
]);

const STRUCTURE_RE =
  /(?:^|\n)#{1,6} |\*\*|~~|`{1,3}|\[[^\]]*\]\([^)]+\)|!\[[^\]]*\]\([^)]+\)|(?:^|\n)(?:[-*+] |\d+\. |> |\|.+\|)/;

interface InlineFlags {
  bold: boolean;
  italic: boolean;
  strike: boolean;
}

const EMPTY_FLAGS: InlineFlags = { bold: false, italic: false, strike: false };

function parseHtml(html: string): Document | null {
  if (typeof DOMParser === "undefined") return null;
  try {
    return new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

function isText(node: Node): node is Text {
  return node.nodeType === 3;
}

function tagName(el: Element): string {
  return el.tagName.toUpperCase();
}

function collapseWs(text: string): string {
  return text.replace(/\s+/g, " ");
}

function parseStyleFlags(el: Element): InlineFlags {
  const style = el.getAttribute("style") ?? "";
  const flags: InlineFlags = { ...EMPTY_FLAGS };

  if (/font-weight\s*:\s*(bold|[7-9]00)/i.test(style)) flags.bold = true;
  if (/font-weight\s*:\s*(normal|400)/i.test(style)) flags.bold = false;

  if (/font-style\s*:\s*italic/i.test(style)) flags.italic = true;
  if (/font-style\s*:\s*normal/i.test(style)) flags.italic = false;

  if (/text-decoration(?:-line)?\s*:[^;]*line-through/i.test(style)) flags.strike = true;

  return flags;
}

function tagFlags(el: Element): InlineFlags {
  const tag = tagName(el);
  const style = parseStyleFlags(el);
  const flags: InlineFlags = { ...style };

  if (tag === "STRONG" || tag === "B") {
    // Google Docs wraps the fragment in <b style="font-weight:normal">.
    flags.bold = style.bold || !/font-weight\s*:\s*(normal|400)/i.test(el.getAttribute("style") ?? "");
    if (/font-weight\s*:\s*(normal|400)/i.test(el.getAttribute("style") ?? "")) flags.bold = false;
  }
  if (tag === "EM" || tag === "I") flags.italic = true;
  if (tag === "S" || tag === "DEL" || tag === "STRIKE") flags.strike = true;

  return flags;
}

function wrapInline(content: string, flags: InlineFlags): string {
  const trimmed = content.trim();
  if (!trimmed) return content;

  let inner = content;
  // Preserve a single leading/trailing space outside the markers so
  // `foo <b>bar</b> baz` does not become `foo**bar**baz`.
  const lead = inner.match(/^\s+/)?.[0] ?? "";
  const trail = inner.match(/\s+$/)?.[0] ?? "";
  inner = inner.trim();
  if (!inner) return content;

  if (flags.strike) inner = `~~${inner}~~`;
  if (flags.bold && flags.italic) inner = `***${inner}***`;
  else if (flags.bold) inner = `**${inner}**`;
  else if (flags.italic) inner = `*${inner}*`;

  return `${lead}${inner}${trail}`;
}

const SAFE_URL = /^(https?:|mailto:|\/|#)/i;
const SAFE_IMG = /^(https?:|data:image\/|\/)/i;

export function isSafeHref(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/^(javascript|vbscript|file):/i.test(trimmed)) return false;
  if (/^data:/i.test(trimmed)) return false;
  return SAFE_URL.test(trimmed) || !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
}

export function isSafeImgSrc(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/^(javascript|vbscript|file):/i.test(trimmed)) return false;
  return SAFE_IMG.test(trimmed) || !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
}

function escapeLinkText(text: string): string {
  return text.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function fenceLang(el: Element): string {
  const klass = `${el.getAttribute("class") ?? ""} ${el.parentElement?.getAttribute("class") ?? ""}`;
  const match = /\blanguage-([A-Za-z0-9_+-]+)\b/.exec(klass);
  return match?.[1] ?? "";
}

function serializeInline(node: Node): string {
  if (isText(node)) return collapseWs(node.data);
  if (!isElement(node)) return "";
  if (SKIP_TAGS.has(tagName(node))) return "";

  const tag = tagName(node);

  if (tag === "BR") return "\n";

  if (tag === "CODE" && tagName(node.parentElement ?? node) !== "PRE") {
    const text = (node.textContent ?? "").replace(/\n/g, " ");
    if (!text) return "";
    const fence = text.includes("`") ? "``" : "`";
    return `${fence}${text}${fence}`;
  }

  if (tag === "A") {
    const href = node.getAttribute("href") ?? "";
    const text = serializeChildrenInline(node).trim() || href;
    if (!text) return "";
    if (!isSafeHref(href)) return text;
    return `[${escapeLinkText(text)}](${href.trim()})`;
  }

  if (tag === "IMG") {
    const src = node.getAttribute("src") ?? "";
    const alt = node.getAttribute("alt") ?? "";
    if (!isSafeImgSrc(src)) return alt;
    return `![${escapeLinkText(alt)}](${src.trim()})`;
  }

  const inner = serializeChildrenInline(node);
  const flags = tagFlags(node);
  if (flags.bold || flags.italic || flags.strike) return wrapInline(inner, flags);
  return inner;
}

function serializeChildrenInline(el: Element): string {
  let out = "";
  for (const child of Array.from(el.childNodes)) out += serializeInline(child);
  return out;
}

function headingLevel(tag: string): number | null {
  if (/^H[1-6]$/.test(tag)) return Number(tag.slice(1));
  return null;
}

function isTaskCheckbox(li: Element): { checked: boolean } | null {
  const input = li.querySelector(":scope > input[type=checkbox]");
  if (!(input instanceof HTMLInputElement)) return null;
  return { checked: input.checked || input.hasAttribute("checked") };
}

function takeDirectLists(li: Element): Element[] {
  return Array.from(li.children).filter((el) => {
    const tag = tagName(el);
    return tag === "UL" || tag === "OL";
  });
}

function serializeList(list: Element, ordered: boolean, indent: number): string {
  const items = Array.from(list.children).filter((el) => tagName(el) === "LI");
  const lines: string[] = [];
  const pad = "  ".repeat(indent);

  items.forEach((li, index) => {
    const task = isTaskCheckbox(li);
    const marker = task ? (task.checked ? "- [x] " : "- [ ] ") : ordered ? `${index + 1}. ` : "- ";
    const nestedLists = takeDirectLists(li);

    const clone = li.cloneNode(true) as Element;
    for (const nested of takeDirectLists(clone)) nested.remove();
    for (const box of Array.from(clone.querySelectorAll(":scope > input[type=checkbox]"))) {
      box.remove();
    }

    const body = serializeBlocks(clone, indent + 1).trim();
    // Word wraps li content in <p>; flatten the first paragraph onto the marker line.
    const bodyLines = body.split("\n");
    const first = bodyLines[0] ?? "";
    const rest = bodyLines
      .slice(1)
      .map((line) => (line.length > 0 ? `${pad}  ${line}` : ""))
      .join("\n");

    let chunk = `${pad}${marker}${first}`;
    if (rest.trim().length > 0) chunk += `\n${rest}`;

    for (const nested of nestedLists) {
      const nestedMd = serializeList(nested, tagName(nested) === "OL", indent + 1);
      if (nestedMd) chunk += `\n${nestedMd}`;
    }

    lines.push(chunk.replace(/\s+$/, ""));
  });

  return lines.join("\n");
}

function serializeTable(table: Element): string {
  const rows: string[][] = [];
  const rowEls = Array.from(table.querySelectorAll("tr"));
  for (const row of rowEls) {
    const cells = Array.from(row.querySelectorAll("th, td")).map((cell) =>
      serializeChildrenInline(cell).trim().replace(/\|/g, "\\|").replace(/\n+/g, " ")
    );
    if (cells.length > 0) rows.push(cells);
  }
  if (rows.length === 0) return "";

  const width = Math.max(...rows.map((r) => r.length));
  const padded = rows.map((r) => {
    const copy = r.slice();
    while (copy.length < width) copy.push("");
    return copy;
  });

  const header = padded[0];
  const sep = header.map(() => "---");
  const body = padded.slice(1);
  const fmt = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [fmt(header), fmt(sep), ...body.map(fmt)].join("\n");
}

function serializePre(el: Element): string {
  const codeEl = el.querySelector("code") ?? el;
  const lang = fenceLang(codeEl) || fenceLang(el);
  let text = codeEl.textContent ?? "";
  text = text.replace(/\n$/, "");
  const fence = text.includes("```") ? "~~~~" : "```";
  return `${fence}${lang}\n${text}\n${fence}`;
}

function serializeBlock(node: Node, indent: number): string {
  if (isText(node)) {
    const text = collapseWs(node.data).trim();
    return text;
  }
  if (!isElement(node)) return "";
  if (SKIP_TAGS.has(tagName(node))) return "";

  const tag = tagName(node);
  const heading = headingLevel(tag);
  if (heading) {
    const inner = serializeChildrenInline(node).trim();
    return inner ? `${"#".repeat(heading)} ${inner}` : "";
  }

  if (tag === "P") return serializeChildrenInline(node).trim();
  if (tag === "BR") return "";
  if (tag === "HR") return "---";
  if (tag === "PRE") return serializePre(node);
  if (tag === "BLOCKQUOTE") {
    const inner = serializeBlocks(node, indent).trim();
    if (!inner) return "";
    return inner
      .split("\n")
      .map((line) => (line.length > 0 ? `> ${line}` : ">"))
      .join("\n");
  }
  if (tag === "UL" || tag === "OL") return serializeList(node, tag === "OL", indent);
  if (tag === "TABLE") return serializeTable(node);
  if (tag === "LI") return serializeChildrenInline(node).trim();

  if (BLOCK_TAGS.has(tag) || tag === "BODY" || tag === "HTML") {
    return serializeBlocks(node, indent);
  }

  return serializeInline(node).trim();
}

function serializeBlocks(parent: Element, indent: number): string {
  const parts: string[] = [];
  for (const child of Array.from(parent.childNodes)) {
    const chunk = serializeBlock(child, indent).trim();
    if (chunk) parts.push(chunk);
  }
  return parts.join("\n\n");
}

function tidyMarkdown(md: string): string {
  return md
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Convert an HTML clipboard fragment to Markdown. Returns an empty string
 * when the input has no convertible content (caller should fall through).
 */
export function htmlToMarkdown(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return "";
  const doc = parseHtml(trimmed);
  if (!doc?.body) return "";
  return tidyMarkdown(serializeBlocks(doc.body, 0));
}

function normalizeComparable(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function introducesMarkdownStructure(markdown: string, plain: string): boolean {
  if (normalizeComparable(markdown) === normalizeComparable(plain)) return false;
  return STRUCTURE_RE.test(markdown);
}

/**
 * Decide whether clipboard HTML should replace `text/plain` on paste.
 * Returns the Markdown to insert, or `null` to leave paste to CodeMirror.
 */
export function markdownFromClipboard(html: string, plain = ""): string | null {
  const markdown = htmlToMarkdown(html);
  if (!markdown) return null;
  if (plain && !introducesMarkdownStructure(markdown, plain)) return null;
  return markdown;
}
