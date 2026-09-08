import type { Content, PhrasingContent, Root, RootContent } from "mdast";

// Minimal mdast → HTML serializer for the node subset the lezer-mdast-adapter
// emits. Used to render fenced-callout bodies: the body source is re-parsed
// into mdast children, then this walks them into HTML that the live-preview
// html-block renderer mounts via innerHTML (after its sanitizer pass).
//
// Deliberately mirrors remark-html's output shape for the supported subset
// (no pretty-printing between tags, escaped text/attributes) so callout
// bodies look identical to the same markdown rendered at top level.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeUrl(s: string): string {
  return s.replace(/"/g, "%22");
}

function inlineNodes(nodes: readonly PhrasingContent[]): string {
  return nodes.map(renderInline).join("");
}

function renderInline(node: PhrasingContent): string {
  switch (node.type) {
    case "text":
      return escapeHtml(node.value);
    case "strong":
      return `<strong>${inlineNodes(node.children)}</strong>`;
    case "emphasis":
      return `<em>${inlineNodes(node.children)}</em>`;
    case "delete":
      return `<del>${inlineNodes(node.children)}</del>`;
    case "inlineCode":
      return `<code>${escapeHtml(node.value)}</code>`;
    case "link":
      return `<a href="${escapeUrl(node.url)}">${inlineNodes(node.children)}</a>`;
    case "image":
      return `<img src="${escapeUrl(node.url)}" alt="${escapeHtml(node.alt ?? "")}" />`;
    case "html":
      // Raw inline HTML passes through — the html-block sanitizer strips
      // dangerous constructs before this markup reaches the DOM.
      return node.value;
    case "footnoteReference":
      return `<sup>${escapeHtml(node.label ?? node.identifier)}</sup>`;
    default:
      return "";
  }
}

function renderBlock(node: RootContent | Content): string {
  switch (node.type) {
    case "paragraph":
      return `<p>${inlineNodes(node.children)}</p>`;
    case "heading": {
      const depth = Math.min(Math.max(node.depth, 1), 6);
      return `<h${depth}>${inlineNodes(node.children)}</h${depth}>`;
    }
    case "blockquote":
      return `<blockquote>${renderBlocks(node.children)}</blockquote>`;
    case "list": {
      const tag = node.ordered ? "ol" : "ul";
      const start = node.ordered && typeof node.start === "number" && node.start !== 1
        ? ` start="${node.start}"`
        : "";
      return `<${tag}${start}>${renderBlocks(node.children)}</${tag}>`;
    }
    case "listItem": {
      const inner = renderBlocks(node.children);
      if (node.checked === true) return `<li><input type="checkbox" checked disabled /> ${inner}</li>`;
      if (node.checked === false) return `<li><input type="checkbox" disabled /> ${inner}</li>`;
      return `<li>${inner}</li>`;
    }
    case "code": {
      const cls = node.lang ? ` class="language-${escapeHtml(node.lang)}"` : "";
      return `<pre><code${cls}>${escapeHtml(node.value)}</code></pre>`;
    }
    case "thematicBreak":
      return "<hr />";
    case "table": {
      const [head, ...bodyRows] = node.children;
      let html = "<table>";
      if (head && head.type === "tableRow") {
        html += "<thead><tr>";
        for (const cell of head.children) {
          html += `<th>${inlineNodes(cell.children)}</th>`;
        }
        html += "</tr></thead>";
      }
      if (bodyRows.length > 0) {
        html += "<tbody>";
        for (const row of bodyRows) {
          html += "<tr>";
          for (const cell of row.children) {
            html += `<td>${inlineNodes(cell.children)}</td>`;
          }
          html += "</tr>";
        }
        html += "</tbody>";
      }
      html += "</table>";
      return html;
    }
    case "html":
      return node.value;
    // definition / footnoteDefinition carry no rendered output in a
    // standalone callout body.
    default:
      return "";
  }
}

function renderBlocks(nodes: readonly (RootContent | Content)[]): string {
  return nodes.map(renderBlock).join("");
}

/** Serialize an mdast Root (or any block list) into an HTML string. */
export function mdastToHtml(root: Root): string {
  return renderBlocks(root.children);
}
