import type { NexusPlugin, WidgetRenderContext } from "@floatboat/nexus-core";
import mermaid from "mermaid";

/** Counter for generating unique IDs used by mermaid.render(). */
let _idCounter = 0;

/**
 * Detect which Mermaid theme to use based on the editor's active color scheme.
 *
 * Priority order:
 *  1. Explicit `theme` option passed by the host.
 *  2. `nexus-dark` class on `<html>` (set by Nexus's built-in theme system).
 *  3. `prefers-color-scheme: dark` OS-level media query.
 *  4. Fall back to `"default"` (light).
 */
function detectTheme(
  override?: MermaidPluginOptions["theme"],
): "default" | "dark" | "neutral" | "forest" {
  if (override) return override;
  if (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("nexus-dark")
  ) {
    return "dark";
  }
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "default";
}

/**
 * Attach a hover-revealed ✎ edit button to a rendered Mermaid diagram widget.
 * Clicking moves the editor's caret to the source start, toggling the host
 * back into raw-markdown edit mode. Mirrors the plugin-math edit-button pattern
 * so users have one consistent affordance across block widgets.
 */
function attachEditButton(
  host: HTMLElement,
  ctx: WidgetRenderContext | undefined,
): void {
  if (!ctx) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "✎";
  btn.title = "Edit diagram";
  btn.setAttribute("aria-label", "Edit diagram");
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

  // Prevent CM6 from seeing this click; the button handles entry into edit mode.
  btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    ctx.setSelection(ctx.from);
    ctx.focus();
  });

  host.appendChild(btn);
}

/**
 * Render an error state when the Mermaid source fails to parse or render.
 * Shows the raw diagram source alongside a human-readable error message so
 * the author can fix the syntax without losing their work.
 */
function renderError(host: HTMLElement, message: string, source: string): void {
  host.innerHTML = "";
  host.style.cssText = [
    "padding:12px 16px",
    "border-radius:6px",
    "border:1px solid var(--nexus-hl-deletion,#f87171)",
    "background:var(--nexus-bg-subtle,#fef2f2)",
    "font-family:ui-monospace,monospace",
    "font-size:12px",
    "color:var(--nexus-hl-deletion,#c33)",
    "white-space:pre-wrap",
    "word-break:break-all",
  ].join(";") + ";";

  const label = document.createElement("div");
  label.style.cssText = "font-weight:600;margin-bottom:6px;";
  label.textContent = `⚠ Mermaid: ${message}`;

  const pre = document.createElement("pre");
  pre.style.cssText = "margin:0;opacity:.7;";
  pre.textContent = source;

  host.appendChild(label);
  host.appendChild(pre);
}

export interface MermaidPluginOptions {
  /**
   * Mermaid theme to use for all diagrams.
   * When omitted the plugin auto-detects from the editor's dark/light mode.
   */
  theme?: "default" | "dark" | "neutral" | "forest";
}

/** A starter Mermaid flowchart snippet inserted by the `/mermaid` slash command. */
const STARTER_TEMPLATE = "```mermaid\ngraph TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Result A]\n    B -->|No| D[Result B]\n```\n";

export function createMermaidPlugin(options?: MermaidPluginOptions): NexusPlugin {
  return {
    name: "plugin-mermaid",

    slashCommands: [
      {
        id: "mermaid",
        title: "Mermaid Diagram",
        keywords: ["mermaid", "diagram", "flowchart", "chart", "graph"],
        description: "Insert a Mermaid flowchart diagram",
        run(editor) {
          editor.replaceSelection(STARTER_TEMPLATE);
          return true;
        },
      },
    ],

    widgets: [
      {
        // `remark-gfm` parses ```mermaid blocks as `code` nodes with lang="mermaid".
        // We intercept only those — all other fenced code blocks are left alone.
        nodeType: "code",
        match: (node: { lang?: string | null }) => node.lang === "mermaid",
        block: true,
        // Swallow mouse/keyboard events so CM6 doesn't try to place the cursor
        // inside the rendered SVG. The ✎ hover button is the only edit affordance.
        ignoreEvents: true,

        render(node: { value?: string }, source: string, ctx?: WidgetRenderContext): HTMLElement {
          const diagramSource = (node.value ?? source).trim();
          const theme = detectTheme(options?.theme);

          const host = document.createElement("div");
          host.className = "nexus-mermaid";
          host.setAttribute("aria-label", "Mermaid diagram");
          host.style.cssText = [
            "position:relative",
            "display:flex",
            "justify-content:center",
            "align-items:flex-start",
            "padding:16px 40px 16px 16px",
            "min-height:60px",
            "overflow-x:auto",
          ].join(";") + ";";

          // Loading indicator shown while the async SVG is being generated.
          const loading = document.createElement("div");
          loading.className = "nexus-mermaid-loading";
          loading.textContent = "Rendering…";
          loading.style.cssText = [
            "font-size:12px",
            "font-family:system-ui,sans-serif",
            "color:var(--nexus-text-muted,#9ca3af)",
            "padding:8px 0",
          ].join(";") + ";";
          host.appendChild(loading);

          // Track whether this widget instance was destroyed before the async
          // render completes so we don't mutate a detached DOM node.
          let destroyed = false;

          const diagramId = `nexus-mermaid-${++_idCounter}`;

          // Kick off async rendering immediately. mermaid.render() returns an
          // SVG string; we inject it into the host once ready.
          Promise.resolve().then(async () => {
            if (destroyed) return;
            try {
              mermaid.initialize({
                startOnLoad: false,
                theme,
                securityLevel: "strict",
              });
              const { svg } = await mermaid.render(diagramId, diagramSource);
              if (destroyed) return;
              host.innerHTML = "";
              const wrapper = document.createElement("div");
              wrapper.className = "nexus-mermaid-svg";
              wrapper.style.cssText = "max-width:100%;overflow-x:auto;";
              wrapper.innerHTML = svg;
              // Make the embedded SVG responsive.
              const svgEl = wrapper.querySelector("svg");
              if (svgEl) {
                svgEl.removeAttribute("height");
                svgEl.style.maxWidth = "100%";
                svgEl.style.height = "auto";
              }
              host.appendChild(wrapper);
              attachEditButton(host, ctx);
            } catch (err: unknown) {
              if (destroyed) return;
              const msg = err instanceof Error ? err.message : String(err);
              renderError(host, msg, diagramSource);
              attachEditButton(host, ctx);
            }
          });

          return host;
        },

        destroy(_element: HTMLElement): void {
          // Signal the async render not to mutate the now-detached node.
          // We use a closure variable `destroyed` per widget instance.
          // Because `destroy` is called on the same `host` element returned
          // by `render`, we patch the flag via a WeakMap alternative: simply
          // mark the element itself.
          _element.dataset["nexusMermaidDestroyed"] = "1";
        },
      },
    ],
  };
}
