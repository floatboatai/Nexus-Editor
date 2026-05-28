import type { NexusPlugin, WidgetRenderContext } from "@floatboat/nexus-core";
import katex from "katex";
import remarkMath from "remark-math";

/**
 * Attach a hover-revealed ✎ edit button to a rendered block math widget.
 * Clicking moves the editor's caret to the source start, which makes the
 * host re-render the range as raw markdown (edit mode). Mirrors the
 * mermaid edit-button pattern so users have one consistent affordance.
 *
 * Only used for BLOCK math. Inline math relies on CM6's native cursor
 * placement (combined with inclusive-end `selectionIntersects` in
 * widget-extension) — clicking on an inline formula already drops the
 * caret adjacent to it and toggles into edit mode automatically.
 */
function attachBlockEditButton(
  host: HTMLElement,
  ctx: WidgetRenderContext | undefined
): void {
  if (!ctx) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "✎";
  btn.title = "Edit formula";
  btn.setAttribute("aria-label", "Edit formula");
  btn.style.cssText = [
    "position:absolute",
    "top:4px",
    "right:8px",
    "padding:1px 6px",
    "font-size:11px",
    "font-family:system-ui,sans-serif",
    "line-height:1.4",
    "background:var(--nexus-bg,#fff)",
    "border:1px solid var(--nexus-border-subtle,rgba(15,23,42,.14))",
    "border-radius:3px",
    "color:var(--nexus-text-muted,#6b7280)",
    "cursor:pointer",
    "opacity:0",
    "z-index:2",
    "user-select:none",
    "transition:opacity .15s",
    "pointer-events:auto",
  ].join(";") + ";";

  host.addEventListener("mouseenter", () => { btn.style.opacity = "1"; });
  host.addEventListener("mouseleave", () => { btn.style.opacity = "0"; });
  btn.addEventListener("mouseenter", () => { btn.style.opacity = "1"; });

  // Button events must escape the widget body's `ignoreEvents: true`
  // swallow. The button preventDefaults + stopPropagation so CM6 doesn't
  // see the click at all.
  btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    ctx.setSelection(ctx.from);
    ctx.focus();
  });

  if (!host.style.position || host.style.position === "static") {
    host.style.position = "relative";
  }
  host.appendChild(btn);
}

export function createMathPlugin(): NexusPlugin {
  return {
    name: "plugin-math",
    remarkPlugins: [remarkMath],
    widgets: [
      {
        nodeType: "math",
        block: true,
        // Block formulas: swallow clicks so accidental clicks on the diagram
        // body don't move the cursor to unexpected places. The hover ✎
        // button is the only entry into edit mode.
        ignoreEvents: true,
        render(node: any, source: string, ctx?: WidgetRenderContext) {
          const container = document.createElement("div");
          container.className = "nexus-math-display";
          container.style.position = "relative";
          container.style.textAlign = "center";
          container.style.padding = "8px 32px";
          try {
            katex.render(node.value ?? source, container, {
              displayMode: true,
              throwOnError: false,
            });
          } catch {
            container.textContent = source;
          }
          attachBlockEditButton(container, ctx);
          return container;
        },
      },
      {
        nodeType: "inlineMath",
        // Inline math: NOT a block widget — otherwise CM6 hoists the formula
        // onto its own line and breaks surrounding paragraph flow.
        block: false,
        // Inline math does NOT swallow events. CM6 handles the click and
        // places the cursor adjacent to the widget; combined with the
        // inclusive-end `selectionIntersects` check, that lands the caret
        // at the widget's `to` offset, which toggles the widget back to
        // raw source — natural text-cursor UX for inline formulas.
        ignoreEvents: false,
        render(node: any, source: string) {
          // Render KaTeX directly into the host span without an extra
          // display:inline-block wrapper. KaTeX's own `.katex` span is
          // inline, so passing the host directly keeps the formula in
          // the surrounding paragraph's line box.
          const span = document.createElement("span");
          span.className = "nexus-math-inline";
          span.style.cursor = "text";
          try {
            katex.render(node.value ?? source, span, {
              displayMode: false,
              throwOnError: false,
            });
          } catch {
            span.textContent = source;
          }
          return span;
        },
      },
    ],
  };
}
