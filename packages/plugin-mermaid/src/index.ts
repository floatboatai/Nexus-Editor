import type { NexusPlugin, WidgetRenderContext } from "@floatboat/nexus-core";
import { EditorView } from "@codemirror/view";

// ── Mermaid lazy-load + cache ─────────────────────────────────────────────
// Lazy-loaded so the ~500KB mermaid bundle only ships when a user actually
// renders a mermaid block. Cache keyed by exact source string so unrelated
// edits elsewhere in the doc don't re-render existing diagrams.

type MermaidAPI = {
  render(id: string, text: string): Promise<{ svg: string }>;
  parse(
    text: string,
    opts?: { suppressErrors?: boolean }
  ): Promise<boolean | { diagramType: string }> | boolean | { diagramType: string };
};

let mermaidPromise: Promise<MermaidAPI> | null = null;
function loadMermaid(): Promise<MermaidAPI> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const m = (mod as any).default ?? mod;
      m.initialize({ startOnLoad: false, theme: "default", securityLevel: "strict" });
      return m as MermaidAPI;
    });
  }
  return mermaidPromise;
}

const mermaidCache = new Map<string, { svg: string; height: number }>();
let mermaidIdCounter = 0;

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Remove orphan DOM nodes that mermaid might inject into document.body on
 * error (the "bomb" error SVG or temporary render host). Call after each
 * mermaid render/path to keep the page clean.
 */
function cleanupOrphans(usedId: string): void {
  const orphan = document.getElementById(usedId);
  if (orphan && orphan.parentElement === document.body) orphan.remove();
  const dOrphan = document.getElementById("d" + usedId);
  if (dOrphan && dOrphan.parentElement === document.body) dOrphan.remove();
}

/**
 * Normalize rendered SVG for responsive display: remove fixed height,
 * constrain to container width, center.
 */
function normalizeSvg(host: HTMLElement): void {
  const svg = host.querySelector("svg") as SVGSVGElement | null;
  if (!svg) return;
  svg.removeAttribute("height");
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";
  svg.style.display = "block";
  svg.style.margin = "0 auto";
}

/**
 * Find the CM6 EditorView that contains this DOM node, if the editor is
 * still mounted. Used to trigger requestMeasure after async SVG render.
 */
function findView(dom: HTMLElement): EditorView | null {
  try {
    return EditorView.findFromDOM(dom);
  } catch {
    return null;
  }
}

// ── Edit button ───────────────────────────────────────────────────────────
// Mirrors the mermaid edit-button pattern in core's live-preview so users
// have one consistent affordance across widget types.

function attachBlockEditButton(
  host: HTMLElement,
  ctx: WidgetRenderContext | undefined,
  source: string
): void {
  if (!ctx) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "✎";
  btn.title = "Edit mermaid source";
  btn.setAttribute("aria-label", "Edit mermaid source");
  btn.style.cssText = [
    "position:absolute",
    "top:4px",
    "right:8px",
    "padding:2px 8px",
    "font-size:12px",
    "font-family:system-ui,sans-serif",
    "line-height:1.4",
    "background:var(--nexus-bg,#fff)",
    "border:1px solid var(--nexus-border-subtle,rgba(15,23,42,.14))",
    "border-radius:3px",
    "color:var(--nexus-text-muted,#6b7280)",
    "cursor:pointer",
    "opacity:0.7",
    "z-index:2",
    "user-select:none",
    "transition:opacity .15s",
  ].join(";") + ";";

  host.addEventListener("mouseenter", () => {
    btn.style.opacity = "1";
  });
  host.addEventListener("mouseleave", () => {
    btn.style.opacity = "0.7";
  });
  btn.addEventListener("mouseenter", () => {
    btn.style.opacity = "1";
  });

  // Button events must escape the widget body's ignoreEvents:true swallow.
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Move cursor to the first line of mermaid source content (after the
    // opening fence line). When the cursor enters the block, the widget
    // toggles back to raw source for editing.
    const firstNewline = source.indexOf("\n");
    const target = firstNewline >= 0 ? ctx.from + firstNewline + 1 : ctx.from;
    ctx.setSelection(target);
    ctx.focus();
  });

  if (!host.style.position || host.style.position === "static") {
    host.style.position = "relative";
  }
  host.appendChild(btn);
}

// ── Error display ─────────────────────────────────────────────────────────

function showError(
  host: HTMLElement,
  diagramHost: HTMLElement,
  message: string,
  ctx: WidgetRenderContext | undefined,
  view: EditorView | null,
  source: string
): void {
  if (!host.isConnected) return;

  diagramHost.style.color = "var(--nexus-hl-deletion,#c33)";
  diagramHost.style.fontSize = "12px";
  diagramHost.style.padding = "8px";
  diagramHost.style.paddingRight = "40px";
  diagramHost.style.textAlign = "left";
  diagramHost.style.fontFamily = "monospace";
  diagramHost.style.whiteSpace = "pre-wrap";
  diagramHost.style.minHeight = "40px";
  diagramHost.textContent = "";

  const header = document.createElement("div");
  header.textContent = "Mermaid error";
  header.style.cssText = "font-weight:bold;margin-bottom:4px;";

  const body = document.createElement("div");
  body.textContent = message;
  body.style.cssText = "white-space:pre-wrap;";

  const hint = document.createElement("div");
  hint.style.cssText =
    "margin-top:8px;font-family:system-ui,sans-serif;color:var(--nexus-text-muted,#6b7280);";

  const editLink = document.createElement("a");
  editLink.href = "#";
  editLink.textContent = "Edit source";
  editLink.style.cssText =
    "color:var(--nexus-accent,#0969da);text-decoration:underline;cursor:pointer;";
  editLink.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  editLink.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (ctx) {
      const firstNewline = source.indexOf("\n");
      const target =
        firstNewline >= 0 ? ctx.from + firstNewline + 1 : ctx.from;
      ctx.setSelection(target);
      ctx.focus();
    }
  });
  hint.appendChild(document.createTextNode("→ "));
  hint.appendChild(editLink);

  diagramHost.appendChild(header);
  diagramHost.appendChild(body);
  diagramHost.appendChild(hint);
  view?.requestMeasure();
}

// ── Plugin ────────────────────────────────────────────────────────────────

/**
 * Create a Mermaid diagram plugin for Nexus-Editor.
 *
 * Renders fenced ```mermaid code blocks as SVG diagrams when the cursor is
 * outside the block. When the cursor enters the block, raw mermaid source is
 * shown for editing. A hover-revealed ✎ button provides an alternative entry
 * into edit mode.
 *
 * Mermaid.js (~500KB) is lazy-loaded only when a mermaid block is first
 * rendered. Diagram SVGs are cached by exact source string to avoid
 * re-rendering on unrelated edits elsewhere in the document.
 *
 * **Usage:**
 *
 * ```ts
 * import { createEditor } from "@floatboat/nexus-core";
 * import { createMermaidPlugin } from "@floatboat/nexus-plugin-mermaid";
 *
 * const editor = createEditor({
 *   container: document.getElementById("editor")!,
 *   initialValue: "# Hello",
 *   plugins: [createMermaidPlugin()],
 *   livePreview: true,
 * });
 * ```
 */
export function createMermaidPlugin(): NexusPlugin {
  return {
    name: "plugin-mermaid",
    widgets: [
      {
        nodeType: "code",

        /** Only match fenced code blocks with lang === "mermaid". */
        match(node: any): boolean {
          return node.lang === "mermaid";
        },

        block: true,
        // Swallow clicks on the diagram so accidental clicks don't move the
        // cursor to unexpected places. The ✎ button is the entry into edit mode.
        ignoreEvents: true,

        render(
          node: any,
          source: string,
          ctx?: WidgetRenderContext
        ): HTMLElement {
          const container = document.createElement("div");
          container.className = "nexus-mermaid";
          container.style.cssText = [
            "display:block",
            "position:relative",
            "margin:0",
            "padding:12px",
            "background:var(--nexus-bg-subtle,rgba(15,23,42,.04))",
            "border-radius:4px",
            "min-height:80px",
            "text-align:center",
            "overflow:hidden",
          ].join(";") + ";";

          attachBlockEditButton(container, ctx, source);

          const diagramHost = document.createElement("div");
          diagramHost.style.cssText =
            "display:block;min-height:64px;max-width:100%;overflow:hidden;";
          container.appendChild(diagramHost);

          // Cache hit — synchronous return.
          const cached = mermaidCache.get(source);
          if (cached) {
            diagramHost.innerHTML = cached.svg;
            normalizeSvg(diagramHost);
            return container;
          }

          // Placeholder while async render resolves.
          diagramHost.textContent = "Loading diagram…";
          diagramHost.style.color = "var(--nexus-text-muted,#6b7280)";
          diagramHost.style.fontSize = "12px";
          diagramHost.style.padding = "24px 0";

          const id = `nexus-mmd-${++mermaidIdCounter}`;
          const sourceAtRender = source;

          // Capture view ref synchronously before async work. EditorView.findFromDOM
          // can resolve the view from the container after it's attached to the DOM
          // (which happens after render() returns). But we try early anyway — it
          // may have been attached during a previous render cycle.
          const viewAtStart = findView(container);

          loadMermaid().then(async (m) => {
            // Pre-validate via parse(). Unlike render(), parse() does NOT
            // inject an error-bomb SVG into document.body on failure.
            try {
              await Promise.resolve(m.parse(sourceAtRender));
            } catch (err) {
              showError(
                container,
                diagramHost,
                (err as Error)?.message ?? String(err),
                ctx,
                findView(container) ?? viewAtStart,
                source
              );
              cleanupOrphans(id);
              return;
            }

            try {
              const { svg } = await m.render(id, sourceAtRender);
              cleanupOrphans(id);
              if (!container.isConnected) {
                mermaidCache.set(sourceAtRender, { svg, height: 0 });
                return;
              }
              diagramHost.style.color = "";
              diagramHost.style.fontSize = "";
              diagramHost.style.padding = "";
              diagramHost.style.whiteSpace = "";
              diagramHost.innerHTML = svg;
              normalizeSvg(diagramHost);
              const h = container.offsetHeight || 0;
              mermaidCache.set(sourceAtRender, { svg, height: h });
              const v = findView(container) ?? viewAtStart;
              v?.requestMeasure();
            } catch (err) {
              cleanupOrphans(id);
              showError(
                container,
                diagramHost,
                (err as Error)?.message ?? String(err),
                ctx,
                findView(container) ?? viewAtStart,
                source
              );
            }
          });

          return container;
        },

        /**
         * Clean up any orphan DOM nodes that mermaid might have injected
         * into document.body. The plugin uses id-prefix-based cleanup
         * within render already, but as a safety net we also scan for
         * common mermaid orphan patterns here.
         */
        destroy(_el: HTMLElement): void {
          // Remove any elements with our mermaid id prefix that may have
          // leaked to document.body.
          const orphans = document.querySelectorAll('[id^="nexus-mmd-"]');
          orphans.forEach((el) => {
            if (el.parentElement === document.body) el.remove();
          });
        },
      },
    ],
  };
}
