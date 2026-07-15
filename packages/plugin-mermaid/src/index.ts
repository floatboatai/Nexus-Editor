import type { NexusPlugin, WidgetRenderContext } from "@floatboat/nexus-core";
import mermaid from "mermaid";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MermaidTheme = "default" | "dark" | "forest" | "neutral";

export interface MermaidPluginOptions {
  /**
   * Mermaid theme preset.
   * Hosts can switch at runtime by passing a reactive theme value.
   * @default "default"
   */
  theme?: MermaidTheme;
  /**
   * Low-level mermaid.initialize() overrides.
   * Takes precedence over `theme` when both are provided.
   * https://mermaid.js.org/config/schema-docs/config.html
   */
  mermaidConfig?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Edit button (mirrors plugin-math's attachBlockEditButton)
// ---------------------------------------------------------------------------

function attachBlockEditButton(
  host: HTMLElement,
  ctx: WidgetRenderContext | undefined
): void {
  if (!ctx) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "✎"; // ✎
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

  // Prevent CM6 from swallowing the button click — the widget body has
  // ignoreEvents: true, so without preventDefault + stopPropagation CM6
  // would never see the click (which is what we want), but the button
  // itself must still fire.
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

// ---------------------------------------------------------------------------
// Mermaid singleton initialisation
// ---------------------------------------------------------------------------

let mermaidInitialized = false;

function ensureMermaidInit(options?: MermaidPluginOptions): void {
  if (mermaidInitialized) return;

  mermaid.initialize({
    startOnLoad: false,
    theme: options?.theme ?? "default",
    securityLevel: "strict",
    ...(options?.mermaidConfig ?? {}),
  });

  mermaidInitialized = true;
}

/**
 * Re-initialise mermaid with new options. Call this when the host toggles
 * dark/light mode so diagrams re-render with the matching theme.
 */
export function reconfigureMermaid(options: MermaidPluginOptions): void {
  mermaid.initialize({
    startOnLoad: false,
    theme: options.theme ?? "default",
    securityLevel: "strict",
    ...(options.mermaidConfig ?? {}),
  });
  mermaidInitialized = true;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Create the mermaid diagram plugin.
 *
 * @example
 * ```ts
 * import { createMermaidPlugin } from "@floatboat/nexus-plugin-mermaid";
 *
 * const mermaidPlugin = createMermaidPlugin({ theme: "default" });
 * ```
 */
export function createMermaidPlugin(
  options?: MermaidPluginOptions
): NexusPlugin {
  ensureMermaidInit(options);

  return {
    name: "plugin-mermaid",

    widgets: [
      {
        nodeType: "code",
        match: (node: any) =>
          node.lang === "mermaid" && typeof node.value === "string" && node.value.length > 0,
        block: true,
        ignoreEvents: true,

        render(node: any, _source: string, ctx?: WidgetRenderContext): HTMLElement {
          const container = document.createElement("div");
          container.className = "nexus-mermaid-display";
          container.style.position = "relative";
          container.style.padding = "12px 32px";
          container.style.overflowX = "auto";

          // Placeholder shown while mermaid renders asynchronously.
          container.innerHTML =
            `<div class="nexus-mermaid-loading" style="text-align:center;padding:16px;color:var(--nexus-text-muted,#6b7280);font-family:system-ui,sans-serif;font-size:13px;">Rendering diagram…</div>`;

          // Generate a unique id — mermaid attaches the SVG to a DOM node
          // identified by this id. A random suffix avoids collisions when
          // the same diagram appears multiple times on screen.
          const diagramId = `nexus-mermaid-${Math.random().toString(36).slice(2, 11)}`;

          mermaid
            .render(diagramId, node.value)
            .then(({ svg }) => {
              // Only update if the container is still in the document
              // (CM6 may have destroyed the widget already).
              if (!container.isConnected) return;
              container.innerHTML = svg;
              // The top-level <svg> may lack responsive sizing.
              const svgEl = container.querySelector("svg");
              if (svgEl) {
                svgEl.style.maxWidth = "100%";
                svgEl.style.height = "auto";
              }
              attachBlockEditButton(container, ctx);
            })
            .catch((err: unknown) => {
              if (!container.isConnected) return;
              const message =
                err instanceof Error ? err.message : String(err);
              container.innerHTML =
                `<div class="nexus-mermaid-error" style="text-align:center;padding:16px;color:var(--nexus-text-error,#dc2626);font-family:system-ui,sans-serif;font-size:13px;">Diagram error: ${escapeHtml(message)}</div>`;
            });

          return container;
        },

        destroy(element: HTMLElement): void {
          // Clear any pending async render result so stale content doesn't
          // flash after the widget is torn down.
          element.innerHTML = "";
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENTITY_RE = /[&<>"']/g;
const ENTITY_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(raw: string): string {
  return raw.replace(ENTITY_RE, (ch) => ENTITY_MAP[ch] ?? ch);
}
