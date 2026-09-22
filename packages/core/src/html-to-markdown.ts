/**
 * HTML to Markdown converter for clipboard smart-paste.
 *
 * Converts rich-text HTML (e.g. copied from web pages, Word, Google Docs,
 * Notion, Excel) into clean, standard GitHub Flavored Markdown (GFM).
 * Zero external dependencies; runs in both browser and JSDOM environments.
 */

/**
 * Checks if an HTML string contains meaningful structural elements that
 * warrant conversion to Markdown (as opposed to trivial plain text or metadata).
 */
export function isRichHtml(html: string): boolean {
  if (!html || typeof html !== "string") return false;
  // Exclude empty bodies or pure comments
  const stripped = html.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!stripped) return false;

  // Check for common rich text tags
  return /<(p|div|h[1-6]|table|thead|tbody|tr|th|td|ul|ol|li|blockquote|strong|b|em|i|s|del|strike|code|pre|a|img|hr|br)\b/i.test(
    stripped
  );
}

/**
 * Cleans inline whitespace while preserving necessary spaces.
 */
function cleanInlineText(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\s+/g, " ");
}

/**
 * Processes a DOM node and converts it to Markdown.
 */
function nodeToMarkdown(node: Node, indent = 0, listContext?: { ordered: boolean; index: number }): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    return text;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  // Skip non-content elements
  if (["script", "style", "noscript", "meta", "head", "title", "link"].includes(tag)) {
    return "";
  }

  // Children processor helper
  const getChildrenMarkdown = (customIndent = indent): string => {
    let result = "";
    for (let i = 0; i < el.childNodes.length; i++) {
      result += nodeToMarkdown(el.childNodes[i], customIndent);
    }
    return result;
  };

  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const depth = parseInt(tag[1], 10);
      const prefix = "#".repeat(depth) + " ";
      const text = cleanInlineText(getChildrenMarkdown()).trim();
      return `\n\n${prefix}${text}\n\n`;
    }

    case "p":
    case "div": {
      const text = getChildrenMarkdown().trim();
      return text ? `\n\n${text}\n\n` : "";
    }

    case "br":
      return "\n";

    case "hr":
      return "\n\n---\n\n";

    case "strong":
    case "b": {
      const text = getChildrenMarkdown().trim();
      return text ? `**${text}**` : "";
    }

    case "em":
    case "i": {
      const text = getChildrenMarkdown().trim();
      return text ? `*${text}*` : "";
    }

    case "s":
    case "del":
    case "strike": {
      const text = getChildrenMarkdown().trim();
      return text ? `~~${text}~~` : "";
    }

    case "u": {
      const text = getChildrenMarkdown().trim();
      return text ? `<u>${text}</u>` : "";
    }

    case "code": {
      // If parent is pre, handled by pre
      if (el.parentElement?.tagName.toLowerCase() === "pre") {
        return el.textContent ?? "";
      }
      const text = el.textContent ?? "";
      return text ? `\`${text}\`` : "";
    }

    case "pre": {
      let lang = "";
      const codeEl = el.querySelector("code");
      if (codeEl) {
        const cls = codeEl.className || "";
        const match = cls.match(/(?:lang|language)-(\w+)/);
        if (match) lang = match[1];
      }
      const content = el.textContent ?? "";
      return `\n\n\`\`\`${lang}\n${content.replace(/^\n+|\n+$/g, "")}\n\`\`\`\n\n`;
    }

    case "blockquote": {
      const inner = getChildrenMarkdown().trim();
      const lines = inner.split("\n").map((line) => `> ${line}`);
      return `\n\n${lines.join("\n")}\n\n`;
    }

    case "ul": {
      const items: string[] = [];
      for (let i = 0; i < el.children.length; i++) {
        const child = el.children[i];
        if (child.tagName.toLowerCase() === "li") {
          items.push(nodeToMarkdown(child, indent, { ordered: false, index: i + 1 }));
        }
      }
      return `\n\n${items.join("\n")}\n\n`;
    }

    case "ol": {
      const startAttr = el.getAttribute("start");
      const start = startAttr ? parseInt(startAttr, 10) || 1 : 1;
      const items: string[] = [];
      for (let i = 0; i < el.children.length; i++) {
        const child = el.children[i];
        if (child.tagName.toLowerCase() === "li") {
          items.push(nodeToMarkdown(child, indent, { ordered: true, index: start + i }));
        }
      }
      return `\n\n${items.join("\n")}\n\n`;
    }

    case "li": {
      const pad = "  ".repeat(indent);
      const isOrdered = listContext?.ordered ?? false;
      const prefix = isOrdered ? `${listContext?.index ?? 1}. ` : "- ";

      // Check for checkbox
      const checkbox = el.querySelector('input[type="checkbox"]');
      let checkboxPrefix = "";
      if (checkbox) {
        checkboxPrefix = (checkbox as HTMLInputElement).checked ? "[x] " : "[ ] ";
      }

      // Collect children text without duplicate checkbox text
      let itemContent = "";
      for (let i = 0; i < el.childNodes.length; i++) {
        const child = el.childNodes[i];
        if (child === checkbox) continue;
        if (child.nodeType === Node.ELEMENT_NODE) {
          const childTag = (child as HTMLElement).tagName.toLowerCase();
          if (childTag === "ul" || childTag === "ol") {
            // Nested list
            itemContent += "\n" + nodeToMarkdown(child, indent + 1);
            continue;
          }
        }
        itemContent += nodeToMarkdown(child, indent);
      }

      return `${pad}${prefix}${checkboxPrefix}${itemContent.trim()}`;
    }

    case "table": {
      return convertTableToMarkdown(el);
    }

    case "a": {
      const href = el.getAttribute("href") || "";
      const text = getChildrenMarkdown().trim();
      if (!href) return text;
      if (!text) return `<${href}>`;
      return `[${text}](${href})`;
    }

    case "img": {
      const src = el.getAttribute("src") || "";
      const alt = el.getAttribute("alt") || "";
      const title = el.getAttribute("title");
      if (!src) return "";
      return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
    }

    default:
      // Inline styles check
      {
        let res = getChildrenMarkdown();
        const style = el.getAttribute("style") || "";
        if (/font-weight:\s*(bold|[7-9]\d\d)/i.test(style) && res.trim()) {
          res = `**${res.trim()}**`;
        }
        if (/font-style:\s*italic/i.test(style) && res.trim()) {
          res = `*${res.trim()}*`;
        }
        if (/text-decoration:\s*[^;]*line-through/i.test(style) && res.trim()) {
          res = `~~${res.trim()}~~`;
        }
        return res;
      }
  }
}

/**
 * Converts an HTML `<table>` element into a standard GFM Markdown table.
 */
function convertTableToMarkdown(tableEl: HTMLElement): string {
  const rows: string[][] = [];
  const trElements = tableEl.querySelectorAll("tr");

  if (trElements.length === 0) return "";

  trElements.forEach((tr) => {
    const row: string[] = [];
    tr.querySelectorAll("th, td").forEach((cell) => {
      const cellText = cleanInlineText(
        Array.from(cell.childNodes)
          .map((n) => nodeToMarkdown(n))
          .join("")
      ).trim().replace(/\|/g, "\\|");
      row.push(cellText);
    });
    if (row.length > 0) {
      rows.push(row);
    }
  });

  if (rows.length === 0) return "";

  // Normalize column count across all rows
  const maxCols = Math.max(...rows.map((r) => r.length));
  if (maxCols === 0) return "";

  const paddedRows = rows.map((r) => {
    while (r.length < maxCols) {
      r.push("");
    }
    return r;
  });

  const headerRow = paddedRows[0];
  const bodyRows = paddedRows.slice(1);

  const delimiterRow = Array(maxCols).fill("---");

  const lines: string[] = [];
  lines.push(`| ${headerRow.join(" | ")} |`);
  lines.push(`| ${delimiterRow.join(" | ")} |`);

  bodyRows.forEach((row) => {
    lines.push(`| ${row.join(" | ")} |`);
  });

  return `\n\n${lines.join("\n")}\n\n`;
}

/**
 * Converts an HTML string into clean, formatted GitHub Flavored Markdown.
 *
 * @param html The input HTML string (typically from clipboardData `text/html`).
 * @returns Clean Markdown string.
 */
export function htmlToMarkdown(html: string): string {
  if (!html || typeof html !== "string") return "";

  // Parse HTML using DOMParser
  if (typeof DOMParser === "undefined") {
    // Basic fallback if no DOMParser in environment
    return html.replace(/<[^>]+>/g, "");
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  let markdown = nodeToMarkdown(doc.body).trim();

  // Normalize multiple consecutive blank lines (limit to max 2 newlines)
  markdown = markdown.replace(/\n{3,}/g, "\n\n");

  return markdown;
}
