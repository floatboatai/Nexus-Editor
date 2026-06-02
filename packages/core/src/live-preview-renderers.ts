// NOTE: highlight.js is NO LONGER imported on the main thread. The default
// code renderer produces a plain <pre><code>. Live-preview colour spans come
// from the parser worker (see live-preview.ts buildCodeBlockDecorations),
// so there's no need for a synchronous hljs path here. Consumers who pass a
// custom `code` renderer can run their own highlighter.

import type {
  LivePreviewNode,
  LivePreviewNodeType,
  LivePreviewRenderContext,
  LivePreviewRenderer,
} from "./types";

function getText(node: LivePreviewNode): string {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }

  if (node.type === "image") {
    return node.alt ?? "";
  }

  if ("children" in node && Array.isArray(node.children)) {
    return node.children
      .map((child) => {
        if ("value" in child && typeof child.value === "string") {
          return child.value;
        }

        if ("children" in child && Array.isArray(child.children)) {
          return child.children
            .map((nested) =>
              "value" in nested && typeof nested.value === "string" ? nested.value : "",
            )
            .join("");
        }

        return "";
      })
      .join("");
  }

  return "";
}

export function createDefaultRenderer(context: LivePreviewRenderContext): HTMLElement {
  switch (context.node.type) {
    case "strong": {
      const element = document.createElement("strong");
      element.textContent = context.text;
      return element;
    }
    case "emphasis": {
      const element = document.createElement("em");
      element.textContent = context.text;
      return element;
    }
    case "inlineCode": {
      const element = document.createElement("code");
      element.textContent = context.text;
      return element;
    }
    case "link": {
      const element = document.createElement("a");
      const url = context.node.url;
      element.textContent = context.text;
      element.href = url;
      element.rel = "noopener noreferrer";
      element.title = `${url} (Ctrl+Click to open)`;
      element.addEventListener("click", (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          window.open(url, "_blank", "noopener,noreferrer");
        }
      });
      return element;
    }
    case "heading": {
      const element = document.createElement("span");
      element.textContent = context.text;
      element.style.display = "block";
      element.style.fontWeight = "bold";
      element.setAttribute("data-heading-level", String(context.node.depth));
      return element;
    }
    case "blockquote": {
      // CRITICAL: margin:0 — CM6 measures block widgets via getBoundingClientRect
      // which EXCLUDES margin. Browser default <blockquote> has 1em top/bottom margin
      // (~30px untracked height) → every blockquote would silently shift heightmap.
      const element = document.createElement("blockquote");
      element.textContent = context.text;
      element.style.cssText =
        "display:block;margin:0;padding:8px 0 8px 16px;border-left:3px solid var(--nexus-border);color:var(--nexus-text-muted);";
      return element;
    }
    case "delete": {
      const element = document.createElement("del");
      element.textContent = context.text;
      return element;
    }
    case "thematicBreak": {
      // CRITICAL: margin:0 — browser default <hr> has ~8px top/bottom margin.
      // Use padding for visual spacing so CM6 measures the full height.
      const element = document.createElement("hr");
      element.style.cssText =
        "display:block;margin:0;padding:8px 0;border:0;background:transparent;";
      const inner = document.createElement("span");
      inner.style.cssText = "display:block;height:1px;background:var(--nexus-border);";
      element.appendChild(inner);
      return element;
    }
    case "code": {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      const lang = context.node.lang;

      // Plain text — colouring happens via hljs-* class decorations emitted
      // by the worker-backed live-preview pipeline.
      code.textContent = context.node.value;

      if (lang) {
        code.setAttribute("data-language", lang);
        code.className = `hljs language-${lang}`;
      } else {
        code.className = "hljs";
      }

      // Inject minimal hljs theme as inline styles (no external CSS needed)
      const style = document.createElement("style");
      style.textContent = [
        ".hljs-keyword,.hljs-selector-tag,.hljs-built_in,.hljs-name{color:var(--nexus-hl-keyword)}",
        ".hljs-string,.hljs-attr,.hljs-symbol,.hljs-bullet,.hljs-addition{color:var(--nexus-hl-string)}",
        ".hljs-title,.hljs-section,.hljs-title.function_{color:var(--nexus-hl-title)}",
        ".hljs-comment,.hljs-quote,.hljs-meta{color:var(--nexus-hl-comment)}",
        ".hljs-number,.hljs-literal{color:var(--nexus-hl-number)}",
        ".hljs-type,.hljs-params{color:var(--nexus-hl-type)}",
        ".hljs-variable,.hljs-template-variable{color:var(--nexus-hl-variable)}",
        ".hljs-deletion{color:var(--nexus-hl-deletion)}",
        ".hljs-regexp,.hljs-link{color:var(--nexus-hl-string)}",
        ".hljs-doctag{color:var(--nexus-hl-keyword)}",
      ].join("");
      pre.appendChild(style);

      pre.style.display = "block";
      pre.style.position = "relative";
      pre.style.margin = "0"; // browser default <pre> has 1em top/bottom margin → untracked by CM6
      pre.style.padding = "8px 12px";
      pre.style.background = "var(--nexus-bg-subtle)";
      pre.style.borderRadius = "4px";
      pre.style.overflow = "auto";
      pre.style.fontFamily = "monospace";
      pre.style.color = "var(--nexus-text)";
      if (lang) {
        pre.style.paddingTop = "28px";
        const langLabel = document.createElement("span");
        langLabel.textContent = lang;
        langLabel.style.cssText =
          "position:absolute;top:4px;right:8px;font-size:11px;color:var(--nexus-text-muted);" +
          "font-family:sans-serif;user-select:none;";
        pre.appendChild(langLabel);
      }
      pre.appendChild(code);
      return pre;
    }
    case "table": {
      const table = document.createElement("table");
      table.style.display = "table";
      table.style.borderCollapse = "collapse";
      table.style.width = "100%";

      const rows = context.node.children ?? [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const tr = document.createElement("tr");
        const cells = "children" in row && Array.isArray(row.children) ? row.children : [];
        for (const cell of cells) {
          const td = document.createElement(i === 0 ? "th" : "td");
          td.style.border = "1px solid var(--nexus-border-subtle)";
          td.style.padding = "6px 10px";
          td.style.textAlign = "left";
          if (i === 0) {
            td.style.fontWeight = "bold";
            td.style.background = "var(--nexus-bg-subtle)";
          }
          // Extract cell text
          if ("children" in cell && Array.isArray(cell.children)) {
            td.textContent = cell.children.map((c: any) => ("value" in c ? c.value : "")).join("");
          }
          tr.appendChild(td);
        }
        table.appendChild(tr);
      }
      return table;
    }
    case "image": {
      const wrapper = document.createElement("span");
      const label = document.createElement("span");
      const element = document.createElement("img");
      wrapper.setAttribute("data-live-preview-image", context.node.url);
      element.src = context.node.url;
      element.alt = context.node.alt ?? "";
      element.referrerPolicy = "no-referrer";
      label.textContent = context.node.alt ?? context.node.url;
      wrapper.appendChild(label);
      wrapper.appendChild(element);
      return wrapper;
    }
  }

  const fallback = document.createElement("span");
  fallback.textContent = context.text;
  return fallback;
}

export function renderLivePreviewNode(
  node: LivePreviewNode,
  source: string,
  renderers: Partial<Record<LivePreviewNodeType, LivePreviewRenderer>>,
  from = 0,
  to = 0,
): HTMLElement {
  const context: LivePreviewRenderContext = {
    node,
    nodeType: node.type,
    source,
    text: getText(node),
    from,
    to,
  };

  return renderers[node.type]?.(context) ?? createDefaultRenderer(context);
}
