import type {
  LivePreviewNode,
  LivePreviewNodeType,
  LivePreviewRenderContext,
  LivePreviewRenderer
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
            .map((nested) => ("value" in nested && typeof nested.value === "string" ? nested.value : ""))
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
      element.textContent = context.text;
      element.href = context.node.url;
      element.rel = "noopener noreferrer";
      element.title = `${context.node.url} (Ctrl+Click to open)`;
      element.addEventListener("click", (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          window.open(context.node.url, "_blank", "noopener,noreferrer");
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
      const element = document.createElement("blockquote");
      element.textContent = context.text;
      element.style.display = "block";
      return element;
    }
    case "delete": {
      const element = document.createElement("del");
      element.textContent = context.text;
      return element;
    }
    case "thematicBreak": {
      const element = document.createElement("hr");
      element.style.display = "block";
      return element;
    }
    case "image": {
      const wrapper = document.createElement("span");
      const label = document.createElement("span");
      const element = document.createElement("img");
      wrapper.setAttribute("data-live-preview-image", context.node.url);
      element.src = context.node.url;
      element.alt = context.node.alt ?? "";
      label.textContent = context.node.alt ?? context.node.url;
      wrapper.appendChild(label);
      wrapper.appendChild(element);
      return wrapper;
    }
  }
}

export function renderLivePreviewNode(
  node: LivePreviewNode,
  source: string,
  renderers: Partial<Record<LivePreviewNodeType, LivePreviewRenderer>>
): HTMLElement {
  const context: LivePreviewRenderContext = {
    node,
    nodeType: node.type,
    source,
    text: getText(node)
  };

  return renderers[node.type]?.(context) ?? createDefaultRenderer(context);
}
