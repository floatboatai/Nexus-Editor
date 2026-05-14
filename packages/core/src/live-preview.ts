import { type EditorState, StateField, type Extension, type Range, type SelectionRange, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import type { Code, FootnoteDefinition, FootnoteReference, Heading, List, Root, Table } from "mdast";

import type { CodeHighlightToken } from "./types";
import { lezerStringToMdast, lezerTreeToMdast } from "./lezer-mdast-adapter";
import { highlightCodeBlock } from "./live-preview-highlight";

import { createLivePreviewDiagnostics } from "./live-preview-diag";
import { collectLivePreviewRanges, selectionIntersects, selectionOnSameLine } from "./live-preview-ranges";
import { renderLivePreviewNode } from "./live-preview-renderers";
import { EditableTableWidget, isTableEditing } from "./live-preview-table";
import type {
  LivePreviewConfig,
  LivePreviewLabels,
  LivePreviewNodeType,
  LivePreviewRenderer,
} from "./types";

interface NormalizedLivePreviewConfig {
  enabled: boolean;
  renderers: Partial<Record<LivePreviewNodeType, LivePreviewRenderer>>;
  labels: Required<LivePreviewLabels>;
}

const DEFAULT_LABELS: Required<LivePreviewLabels> = {
  addColumn: "Add column",
  addRow: "Add row",
  deleteColumn: "Delete column",
  deleteRow: "Delete row",
  insertColumnAfter: "Insert column after",
  insertRowBelow: "Insert row below",
};

function createEmptyAst(): Root {
  return { type: "root", children: [] };
}

function parseFromState(state: EditorState): Root {
  try {
    const tree = ensureSyntaxTree(state, state.doc.length, 50);
    if (tree) return lezerTreeToMdast(state, tree);
    return lezerStringToMdast(state.doc.toString());
  } catch {
    return createEmptyAst();
  }
}

/**
 * Walk the mdast Root and synchronously highlight every fenced code block.
 * Replaces what the worker used to ship in `codeTokens`. Runs on the main
 * thread but is bounded by the slim hljs language set + per-block LRU cache,
 * so cursor moves and unrelated edits don't re-highlight unchanged blocks.
 */
function highlightAllCodeBlocks(ast: Root, doc: string): CodeHighlightToken[] {
  const tokens: CodeHighlightToken[] = [];
  walkCodeBlocks(ast, (code) => {
    if (!code.lang || !code.value) return;
    const blockFrom = code.position?.start.offset ?? -1;
    if (blockFrom < 0) return;
    const fenceBlock = doc.slice(blockFrom);
    const firstNewline = fenceBlock.indexOf("\n");
    if (firstNewline < 0) return;
    const contentStart = blockFrom + firstNewline + 1;
    const blockTokens = highlightCodeBlock(code.lang, code.value, contentStart);
    for (const t of blockTokens) tokens.push(t);
  });
  return tokens;
}

function walkCodeBlocks(node: unknown, visit: (n: Code) => void): void {
  if (!node || typeof node !== "object") return;
  const n = node as { type?: string; children?: unknown[] };
  if (n.type === "code") visit(node as Code);
  if (Array.isArray(n.children)) {
    for (const c of n.children) walkCodeBlocks(c, visit);
  }
}

function normalizeConfig(
  config: boolean | LivePreviewConfig | undefined
): NormalizedLivePreviewConfig {
  if (!config) {
    return { enabled: false, renderers: {}, labels: DEFAULT_LABELS };
  }
  if (config === true) {
    return { enabled: true, renderers: {}, labels: DEFAULT_LABELS };
  }
  return {
    enabled: config.enabled ?? true,
    renderers: config.renderers ?? {},
    labels: { ...DEFAULT_LABELS, ...config.labels }
  };
}

function createWidget(
  source: HTMLElement | (() => HTMLElement),
  swallowEvents = false,
  heightHint?: number,
  eqKey?: string,
): WidgetType {
  // Eager path: caller already built the element. Lazy path: caller passes a
  // builder closure and we defer DOM construction to first toDOM(), so widgets
  // outside the CM6 viewport pay nothing until scrolled in.
  let element: HTMLElement | null = typeof source === "function" ? null : source;
  const builder = typeof source === "function" ? source : null;
  return new (class extends WidgetType {
    /** Stable identity used by eq() so CM6 reuses old DOM across rebuilds. */
    readonly _eqKey = eqKey;
    toDOM(): HTMLElement {
      if (element) return element;
      element = builder!();
      return element;
    }
    eq(other: WidgetType): boolean {
      // Without a key we fall back to CM6's default (object identity → false),
      // forcing a rebuild every transaction. That's the old behavior and is
      // safe; only opt-in callers that pass a stable eqKey get DOM reuse.
      if (this._eqKey === undefined) return false;
      const otherKey = (other as { _eqKey?: string })._eqKey;
      return otherKey === this._eqKey;
    }
    ignoreEvent() { return swallowEvents; }
    // For block widgets, giving CM6 a pre-measure height prevents the heightmap
    // from assigning 0 and then jumping to the real height on first measure.
    // That jump shifts every click resolution below the widget until remeasured.
    get estimatedHeight(): number { return heightHint ?? -1; }
  })();
}

class CodeCopyWidget extends WidgetType {
  constructor(private readonly code: string, private readonly lang: string) { super(); }
  eq(other: CodeCopyWidget): boolean { return other.code === this.code && other.lang === this.lang; }
  ignoreEvent(): boolean { return true; }
  toDOM(): HTMLElement {
    // CM6 measures inline widget DOM elements via offsetHeight and uses that to
    // size the line box. A <button> with position:absolute still has a measurable
    // offsetHeight (~18px), which CM6 treats as the widget's contribution to line
    // height. This makes fence lines 18px instead of the default 21px, causing
    // cumulative click-drift in long documents.
    //
    // Fix: wrap in a zero-height span. The span has line-height:0 + no flow content
    // → offsetHeight=0 → CM6 sees 0 contribution. The button overflows visually
    // via overflow:visible and is anchored by the parent line's position:relative.
    const wrapper = document.createElement("span");
    wrapper.style.cssText = "line-height:0;font-size:0;overflow:visible;display:inline;";

    const btn = document.createElement("button");
    btn.type = "button";
    const defaultLabel = this.lang || "Copy";
    btn.textContent = defaultLabel;
    btn.title = "Copy code";
    btn.setAttribute("aria-label", "Copy code");
    btn.style.cssText = [
      "position:absolute",
      "top:4px",
      "right:8px",
      "padding:1px 8px",
      "font-size:11px",
      "font-family:system-ui,sans-serif",
      "line-height:1.6",
      "background:var(--nexus-bg)",
      "border:1px solid var(--nexus-border-subtle)",
      "border-radius:3px",
      "color:var(--nexus-text-muted)",
      "cursor:pointer",
      "opacity:0.7",
      "z-index:1",
      "user-select:none",
      "transition:opacity .15s"
    ].join(";");
    btn.addEventListener("mouseenter", () => { btn.style.opacity = "1"; });
    btn.addEventListener("mouseleave", () => { btn.style.opacity = "0.7"; });
    btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(this.code);
        btn.textContent = "Copied";
        setTimeout(() => { btn.textContent = defaultLabel; }, 1200);
      } catch {
        btn.textContent = "Failed";
        setTimeout(() => { btn.textContent = defaultLabel; }, 1200);
      }
    });
    wrapper.appendChild(btn);
    return wrapper;
  }
}

// ── Mermaid support ─────────────────────────────────────────────────────────
// Lazy-loaded so the ~500KB mermaid bundle only ships when a user actually
// renders a mermaid block. Cache keyed by exact source string so unrelated
// edits elsewhere in the doc don't re-render existing diagrams.

type MermaidAPI = {
  render(id: string, text: string): Promise<{ svg: string }>;
  parse(text: string, opts?: { suppressErrors?: boolean }): Promise<boolean | { diagramType: string }> | boolean | { diagramType: string };
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

const MERMAID_CACHE = new Map<string, { svg: string; height: number }>();
let mermaidIdCounter = 0;

class MermaidWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly viewRef: { current: EditorView | null },
    private readonly blockFrom: number,
    private readonly sourceOffsetInBlock: number
  ) { super(); }

  eq(other: MermaidWidget): boolean {
    return other.source === this.source;
  }

  ignoreEvent(): boolean { return true; }

  get estimatedHeight(): number {
    const cached = MERMAID_CACHE.get(this.source);
    return cached ? cached.height : 80;
  }

  toDOM(): HTMLElement {
    // Container: margin:0, padding for visual spacing (CLAUDE.md rule #11 / thematicBreak pattern).
    const container = document.createElement("div");
    container.className = "nexus-mermaid";
    container.style.cssText = [
      "display:block",
      "position:relative",
      "margin:0",
      "padding:12px",
      "background:var(--nexus-bg-subtle)",
      "border-radius:4px",
      "min-height:80px",
      "text-align:center",
      "overflow:hidden",
    ].join(";") + ";";

    // Edit icon — always rendered, always on top. stopPropagation so the
    // click doesn't get swallowed as a widget-surface click.
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.title = "Edit mermaid source";
    editBtn.setAttribute("aria-label", "Edit mermaid source");
    editBtn.textContent = "✎";
    editBtn.style.cssText = [
      "position:absolute",
      "top:4px",
      "right:8px",
      "padding:2px 8px",
      "font-size:12px",
      "font-family:system-ui,sans-serif",
      "line-height:1.4",
      "background:var(--nexus-bg)",
      "border:1px solid var(--nexus-border-subtle)",
      "border-radius:3px",
      "color:var(--nexus-text-muted)",
      "cursor:pointer",
      "opacity:0.7",
      "z-index:2",
      "user-select:none",
      "transition:opacity .15s",
    ].join(";") + ";";
    editBtn.addEventListener("mouseenter", () => { editBtn.style.opacity = "1"; });
    editBtn.addEventListener("mouseleave", () => { editBtn.style.opacity = "0.7"; });
    editBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    editBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const v = this.viewRef.current;
      if (!v) return;
      const target = this.blockFrom + this.sourceOffsetInBlock;
      const safeTarget = Math.min(target, v.state.doc.length);
      v.dispatch({ selection: { anchor: safeTarget } });
      v.focus();
    });

    const diagramHost = document.createElement("div");
    // max-width on host + responsive SVG (set after innerHTML) prevents the
    // diagram from overflowing and adding a third scrollbar.
    diagramHost.style.cssText = "display:block;min-height:64px;max-width:100%;overflow:hidden;";
    container.appendChild(editBtn);
    container.appendChild(diagramHost);

    const normalizeSvg = (host: HTMLElement) => {
      const svg = host.querySelector("svg") as SVGSVGElement | null;
      if (!svg) return;
      svg.removeAttribute("height");
      svg.style.maxWidth = "100%";
      svg.style.height = "auto";
      svg.style.display = "block";
      svg.style.margin = "0 auto";
    };

    const cached = MERMAID_CACHE.get(this.source);
    if (cached) {
      diagramHost.innerHTML = cached.svg;
      normalizeSvg(diagramHost);
      return container;
    }

    // Placeholder while async render resolves.
    diagramHost.textContent = "Loading diagram…";
    diagramHost.style.color = "var(--nexus-text-muted)";
    diagramHost.style.fontSize = "12px";
    diagramHost.style.padding = "24px 0";

    const id = `nexus-mmd-${++mermaidIdCounter}`;
    const sourceAtRender = this.source;

    const showError = (message: string) => {
      if (!container.isConnected) return;
      diagramHost.style.color = "var(--nexus-hl-deletion, #c33)";
      diagramHost.style.fontSize = "12px";
      diagramHost.style.padding = "8px";
      diagramHost.style.paddingRight = "40px"; // reserve room for the top-right ✎ button
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
      hint.style.cssText = "margin-top:8px;font-family:system-ui,sans-serif;color:var(--nexus-text-muted);";
      const editLink = document.createElement("a");
      editLink.href = "#";
      editLink.textContent = "Edit source";
      editLink.style.cssText = "color:var(--nexus-accent);text-decoration:underline;cursor:pointer;";
      editLink.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
      editLink.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const v = this.viewRef.current;
        if (!v) return;
        const target = this.blockFrom + this.sourceOffsetInBlock;
        const safeTarget = Math.min(target, v.state.doc.length);
        v.dispatch({ selection: { anchor: safeTarget } });
        v.focus();
      });
      hint.appendChild(document.createTextNode("→ "));
      hint.appendChild(editLink);

      diagramHost.appendChild(header);
      diagramHost.appendChild(body);
      diagramHost.appendChild(hint);
      this.viewRef.current?.requestMeasure();
    };

    // Cleanup helper: mermaid may leave orphan DOM nodes (temp render host, or
    // the "bomb" error SVG) attached to document.body when it throws. Remove
    // any element whose id starts with our prefix to keep the page clean.
    const cleanupOrphans = (usedId: string) => {
      const orphan = document.getElementById(usedId);
      if (orphan && orphan.parentElement === document.body) orphan.remove();
      const dOrphan = document.getElementById("d" + usedId);
      if (dOrphan && dOrphan.parentElement === document.body) dOrphan.remove();
    };

    loadMermaid().then(async (m) => {
      // Pre-validate via parse (without suppressErrors so we get the real
      // diagnostic message). parse() — unlike render() — does NOT inject the
      // default error-bomb SVG into document.body, so this is safe.
      try {
        await Promise.resolve(m.parse(sourceAtRender));
      } catch (err) {
        showError((err as Error)?.message ?? String(err));
        cleanupOrphans(id);
        return;
      }

      try {
        const { svg } = await m.render(id, sourceAtRender);
        cleanupOrphans(id);
        if (!container.isConnected) {
          MERMAID_CACHE.set(sourceAtRender, { svg, height: 0 });
          return;
        }
        diagramHost.style.color = "";
        diagramHost.style.fontSize = "";
        diagramHost.style.padding = "";
        diagramHost.style.whiteSpace = "";
        diagramHost.innerHTML = svg;
        normalizeSvg(diagramHost);
        const h = container.offsetHeight || 0;
        MERMAID_CACHE.set(sourceAtRender, { svg, height: h });
        this.viewRef.current?.requestMeasure();
      } catch (err) {
        cleanupOrphans(id);
        showError((err as Error)?.message ?? String(err));
      }
    });

    return container;
  }
}

const BLOCK_NODE_TYPES = new Set(["thematicBreak"]);

const HEADING_FONT_SIZE: Record<number, string> = {
  1: "1.6em", 2: "1.4em", 3: "1.2em", 4: "1.1em", 5: "1.05em", 6: "1em"
};

function buildHeadingDecorations(
  range: { from: number; to: number; node: Heading },
  selection: readonly SelectionRange[],
  decos: Range<Decoration>[]
): void {
  const firstChild = range.node.children[0];
  const textStart = firstChild?.position?.start?.offset;

  if (typeof textStart === "number" && textStart > range.from && textStart <= range.to) {
    const fontSize = HEADING_FONT_SIZE[range.node.depth] ?? "1em";
    const cursorOnHeading = selectionIntersects(range.from, range.to, selection);

    if (cursorOnHeading) {
      decos.push(
        Decoration.mark({
          attributes: { style: `font-weight: bold; font-size: ${fontSize}; color: var(--nexus-text-muted)` }
        }).range(range.from, textStart)
      );
    } else {
      decos.push(Decoration.replace({}).range(range.from, textStart));
    }

    decos.push(
      Decoration.mark({
        attributes: {
          style: `font-weight: bold; font-size: ${fontSize}`,
          "data-heading-level": String(range.node.depth),
          role: "heading",
          "aria-level": String(range.node.depth)
        }
      }).range(textStart, range.to)
    );
  }
}

const LIST_MARKER_RE = /^(\s*)([-*+]|\d+[.)]) /;
const CHECKBOX_RE = /^\[([ xX])\] /;

function buildListDecorations(
  range: { from: number; to: number; node: List },
  doc: string,
  decos: Range<Decoration>[],
  viewRef: { current: EditorView | null }
): void {
  const source = doc.slice(range.from, range.to);
  const lines = source.split("\n");
  let offset = range.from;
  const isOrdered = range.node.ordered === true;
  let orderNum = range.node.start ?? 1;

  for (const line of lines) {
    const lineEnd = offset + line.length;
    const markerMatch = LIST_MARKER_RE.exec(line);

    if (markerMatch) {
      const indent = markerMatch[1];
      const markerStart = offset + indent.length;
      const markerEnd = offset + markerMatch[0].length;

      const bullet = document.createElement("span");
      if (isOrdered) {
        bullet.textContent = `${orderNum}. `;
        bullet.style.color = "var(--nexus-text-muted)";
        orderNum++;
      } else {
        bullet.textContent = "\u2022 ";
        bullet.style.color = "var(--nexus-text-muted)";
      }
      decos.push(
        Decoration.replace({ widget: createWidget(bullet) }).range(markerStart, markerEnd)
      );

      const afterMarker = line.slice(markerMatch[0].length);
      const checkMatch = CHECKBOX_RE.exec(afterMarker);
      if (checkMatch) {
        const checkStart = markerEnd;
        const checkEnd = markerEnd + checkMatch[0].length;
        const isChecked = checkMatch[1] !== " ";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = isChecked;
        checkbox.style.marginRight = "4px";
        checkbox.style.verticalAlign = "middle";
        checkbox.style.cursor = "pointer";

        const toggleFrom = checkStart + 1;
        checkbox.addEventListener("click", (e) => {
          e.preventDefault();
          const v = viewRef.current;
          if (!v) return;
          v.dispatch({
            changes: { from: toggleFrom, to: toggleFrom + 1, insert: isChecked ? " " : "x" }
          });
        });

        decos.push(
          Decoration.replace({ widget: createWidget(checkbox) }).range(checkStart, checkEnd)
        );

        if (isChecked && checkEnd < lineEnd) {
          decos.push(
            Decoration.mark({
              attributes: { style: "text-decoration: line-through; color: var(--nexus-text-muted)" }
            }).range(checkEnd, lineEnd)
          );
        }
      }
    }

    offset = lineEnd + 1;
  }
}

const BLOCKQUOTE_MARKER_RE = /^( {0,3}>[ \t]?)/;

function buildBlockquoteDecorations(
  range: { from: number; to: number; source: string },
  selection: readonly SelectionRange[],
  decos: Range<Decoration>[]
): void {
  const source = range.source;
  const lines = source.split("\n");
  const cursorInBlockquote = selectionIntersects(range.from, range.to, selection, true);
  let offset = range.from;

  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    decos.push(
      Decoration.line({
        attributes: {
          style:
            "color:var(--nexus-text-muted);" +
            "border-left:3px solid var(--nexus-border);" +
            "padding-left:12px;",
        },
      }).range(lineStart)
    );

    const marker = BLOCKQUOTE_MARKER_RE.exec(line);
    if (!cursorInBlockquote && marker) {
      const markerEnd = lineStart + marker[0].length;
      if (markerEnd <= lineEnd) {
        decos.push(Decoration.replace({}).range(lineStart, markerEnd));
      }
    }

    offset = lineEnd + 1;
  }
}

// Token-to-CSS-variable map (colors come from the theme)
// NOTE: HLJS_COLORS / getTokenColor removed — highlight decorations now use
// hljs-* CSS classes directly (produced by the parser worker), so color
// mapping happens in stylesheets, not TS. See style.css for hljs rules.

function buildCodeBlockDecorations(
  range: { from: number; to: number; node: Code; source: string },
  selection: readonly SelectionRange[],
  decos: Range<Decoration>[],
  viewRef: { current: EditorView | null },
  codeTokens?: readonly import("./types").CodeHighlightToken[]
): void {
  const source = range.source;
  const lines = source.split("\n");
  const cursorOnCode = selectionIntersects(range.from, range.to, selection, true);
  const firstNewline = source.indexOf("\n");
  const isFenced = /^[ \t]*(`{3,}|~{3,})/.test(source);

  // Mermaid: render as block widget when cursor is NOT in the block. When the
  // cursor enters (e.g. via edit-icon dispatch or click outside of swallowed
  // widget), fall through to normal source rendering so the user can edit.
  if (range.node.lang === "mermaid" && !cursorOnCode && firstNewline >= 0) {
    decos.push(
      Decoration.replace({
        widget: new MermaidWidget(range.node.value ?? "", viewRef, range.from, firstNewline + 1),
        block: true,
      }).range(range.from, range.to)
    );
    return;
  }

  // ── CRITICAL: line decorations must NOT change font-family/font-size ──
  // CM6's heightmap estimates offscreen lines using the default line height
  // (derived from cm-content's font). If Decoration.line sets font-family:monospace,
  // measured code lines may differ from the default, and offscreen code lines are
  // estimated at the default height → cumulative click-drift that scales linearly
  // with the number of offscreen code lines.
  //
  // Fix: background + border-radius on Decoration.line (height-neutral).
  //      font-family:monospace on Decoration.mark (affects glyph rendering only;
  //      inline box height still equals inherited line-height × font-size = default).
  // line-height:1.4em locks the line box to exactly the same height as regular text lines.
  // Without it, fence lines whose entire content is inside a monospace Decoration.mark
  // can render 2-3px shorter (font metric difference), causing cumulative click drift.
  const LINE_BG = "background:var(--nexus-bg-subtle);line-height:1.4em;";
  const MONO_MARK = "font-family:monospace;";
  const codeValue = range.node.value;
  const lang = range.node.lang;

  let lineOffset = range.from;
  for (let li = 0; li < lines.length; li++) {
    const lineStart = lineOffset;
    const lineEnd = lineOffset + lines[li].length;
    const isFirstLine = li === 0;
    const isLastLine = li === lines.length - 1;

    // Line decoration: ONLY background + border-radius (no font changes).
    // position:relative on first fence line anchors the absolute copy button.
    const radius = isFirstLine ? "border-radius:4px 4px 0 0;" : isLastLine ? "border-radius:0 0 4px 4px;" : "";
    const firstLineExtra = isFirstLine && isFenced ? "position:relative;" : "";
    const lineAttrs: Record<string, string> = { style: LINE_BG + radius + firstLineExtra };
    if (isFirstLine) {
      lineAttrs.role = "code";
      if (lang) lineAttrs["aria-label"] = `Code block: ${lang}`;
    }
    decos.push(Decoration.line({ attributes: lineAttrs }).range(lineStart));

    // Fence lines: transparent + monospace via mark; visible when cursor in block.
    if (isFenced && (isFirstLine || isLastLine) && lineEnd > lineStart) {
      decos.push(Decoration.mark({
        attributes: {
          style: MONO_MARK + (cursorOnCode
            ? "color:var(--nexus-text-faint,#bbb);"
            : "color:transparent;cursor:text;")
        }
      }).range(lineStart, lineEnd));
    }

    // Content lines (non-fence): monospace via mark.
    if (!(isFenced && (isFirstLine || isLastLine)) && lineEnd > lineStart) {
      decos.push(Decoration.mark({
        attributes: { style: MONO_MARK }
      }).range(lineStart, lineEnd));
    }

    // Copy button: always present, absolute-positioned inside first fence line.
    if (isFenced && isFirstLine && codeValue) {
      decos.push(
        Decoration.widget({
          widget: new CodeCopyWidget(codeValue, lang ?? ""),
          side: 1
        }).range(lineEnd)
      );
    }

    lineOffset = lineEnd + 1;
  }

  // Syntax highlighting — NEVER run on the main thread any more. The parser
  // worker pre-computes highlight spans and hands them in via `codeTokens`
  // (filtered to this block's range below). If no tokens are available yet
  // (worker hasn't responded for this document), the code block renders
  // unstyled and gets coloured on the next buildDecorations pass once the
  // worker response has been merged into the AST cache.
  if (codeTokens && codeTokens.length > 0 && firstNewline >= 0 && range.node.value) {
    // Tokens are sorted by `from` in the worker; still filter since one
    // code block gets decorations for only its subrange.
    const contentStart = range.from + firstNewline + 1;
    const contentEnd = range.to;
    for (const tok of codeTokens) {
      if (tok.from >= contentEnd) break;
      if (tok.to <= contentStart) continue;
      if (tok.from < range.from || tok.to > range.to) continue;
      decos.push(
        Decoration.mark({ class: tok.className }).range(tok.from, tok.to)
      );
    }
  }
}

// NOTE: applyHljsTokens removed — highlighting is now pre-computed in the
// parser worker and handed in as `codeTokens` to buildCodeBlockDecorations.

interface InlineMarkerStyle {
  openLen: number;
  closeLen: number;
  style: string;
  attrs?: Record<string, string>;
}

function getInlineMarkerStyle(nodeType: string, source: string): InlineMarkerStyle | null {
  switch (nodeType) {
    case "strong":
      return { openLen: 2, closeLen: 2, style: "font-weight:bold" };
    case "emphasis":
      return { openLen: 1, closeLen: 1, style: "font-style:italic" };
    case "delete":
      return { openLen: 2, closeLen: 2, style: "text-decoration:line-through" };
    case "inlineCode": {
      // Detect ` vs `` markers
      let ticks = 0;
      for (let i = 0; i < source.length && source[i] === "`"; i++) ticks++;
      return {
        openLen: ticks, closeLen: ticks,
        style: "font-family:monospace;background:var(--nexus-bg-muted);padding:1px 4px;border-radius:3px"
      };
    }
    case "link": {
      // [text](url) — hide [ and ](url)
      const bracketClose = source.indexOf("](");
      if (bracketClose >= 0) {
        const url = source.slice(bracketClose + 2, source.length - 1);
        return {
          openLen: 1,                            // hide [
          closeLen: source.length - bracketClose, // hide ](url)
          style: "color:var(--nexus-accent);text-decoration:underline;cursor:pointer",
          attrs: { "data-link-url": url }
        };
      }
      // Standard autolink: <URL> — hide angle brackets
      if (source.startsWith("<") && source.endsWith(">")) {
        return {
          openLen: 1, closeLen: 1,
          style: "color:var(--nexus-accent);text-decoration:underline;cursor:pointer",
          attrs: { "data-link-url": source.slice(1, -1) }
        };
      }
      // GFM autolink literal: bare URL, no markers to hide
      return {
        openLen: 0, closeLen: 0,
        style: "color:var(--nexus-accent);text-decoration:underline;cursor:pointer",
        attrs: { "data-link-url": source }
      };
    }
    default:
      return null;
  }
}

interface BuildContext {
  /** Optional pre-computed Lezer mdast snapshot (avoids re-parsing on cursor-only updates). */
  ast?: Root;
  /** Optional pre-computed code highlight tokens for the snapshot's fenced blocks. */
  codeTokens?: CodeHighlightToken[];
}

function buildDecorations(
  state: EditorState,
  selection: readonly SelectionRange[],
  config: NormalizedLivePreviewConfig,
  viewRef: { current: EditorView | null },
  ctx: BuildContext
): { decos: DecorationSet; ast: Root; codeTokens: CodeHighlightToken[] } {
  if (!config.enabled) return { decos: Decoration.none, ast: ctx.ast ?? createEmptyAst(), codeTokens: [] };

  const perfEnabled = (globalThis as { NEXUS_PERF?: boolean }).NEXUS_PERF !== false;
  const t0 = perfEnabled ? performance.now() : 0;
  const doc = state.doc.toString();
  // Lezer-driven adapter: synchronous, viewport-agnostic, intrinsic to the
  // EditorState. No worker round-trip, no async cache invalidation. Reuse
  // a pre-computed ast when the caller already walked the tree this turn
  // (cursor-only updates pass the previous build's ast through ctx).
  const ast = ctx.ast ?? parseFromState(state);
  const t1 = perfEnabled ? performance.now() : 0;
  // Highlight tokens are computed ON DEMAND but cached: identical (lang, code)
  // pairs hit the LRU in highlightCodeBlock so cursor moves don't re-tokenize.
  const codeTokens = ctx.codeTokens ?? highlightAllCodeBlocks(ast, doc);
  const t1b = perfEnabled ? performance.now() : 0;
  const ranges = collectLivePreviewRanges(ast, doc, selection);
  const t2 = perfEnabled ? performance.now() : 0;
  const astHit = !!ctx.ast;
  const decos: Range<Decoration>[] = [];
  const parentSpans: [number, number][] = [];

  for (const range of ranges) {
    if (parentSpans.some(([from, to]) => range.from >= from && range.to <= to)) continue;

    if (range.node.type === "heading" && !config.renderers.heading) {
      buildHeadingDecorations(range as { from: number; to: number; node: Heading }, selection, decos);
    } else if (range.node.type === "table" && !config.renderers.table) {
      decos.push(
        Decoration.replace({
          widget: new EditableTableWidget(
            range.node as Table, range.from, range.source, viewRef, config.labels
          ),
          block: true
        }).range(range.from, range.to)
      );
    } else if (range.node.type === "list") {
      buildListDecorations(range as { from: number; to: number; node: List }, doc, decos, viewRef);
    } else if (range.node.type === "blockquote") {
      buildBlockquoteDecorations(range as { from: number; to: number; source: string }, selection, decos);
    } else if (range.node.type === "code" && !config.renderers.code) {
      buildCodeBlockDecorations(range as { from: number; to: number; node: Code; source: string }, selection, decos, viewRef, codeTokens);
    } else if (range.node.type === "image") {
      // Cursor-aware + preview-alongside:
      //   * cursor OUT  → replace widget (source hidden).
      //   * cursor IN   → source visible (editable) AND a block-widget preview
      //                   appended right after the image's end offset.
      // The "enter edit mode" trigger in practice is the </> button click in
      // the custom renderer, which dispatches setSelection(range.from).
      // swallowEvents=true so interactive chrome inside a custom image renderer
      // isn't preempted by CM6's cursor-placement handler.
      const cursorOnImage = selectionIntersects(range.from, range.to, selection, true);
      // Stable identity keyed by content + position lets CM6 reuse the existing
      // DOM across cursor-only updates and unrelated edits — image renderers
      // are heavy (50+ DOM nodes with inline styles), so skipping the rebuild
      // is the bulk of the buildWidgets win on documents with many images.
      const imgKey = `image:${range.from}:${range.to}:${cursorOnImage ? "in" : "out"}:${range.source}`;
      const buildImg = (): HTMLElement =>
        renderLivePreviewNode(range.node, range.source, config.renderers, range.from, range.to);
      if (!cursorOnImage) {
        decos.push(
          Decoration.replace({
            widget: createWidget(buildImg, true, undefined, imgKey)
          }).range(range.from, range.to)
        );
      } else {
        // Edit mode: keep source text visible; also render the image below.
        decos.push(
          Decoration.widget({
            widget: createWidget(buildImg, true, undefined, imgKey),
            block: true,
            side: 1,
          }).range(range.to)
        );
      }
    } else if (range.node.type === "link" && !config.renderers.link) {
      const inlineStyle = getInlineMarkerStyle("link", range.source);
      if (inlineStyle) {
        const { openLen, closeLen, style, attrs } = inlineStyle;
        // Always render as widget — no cursor-on/off switching (avoids viewport instability)
        const linkText = range.source.slice(openLen, range.source.length - closeLen);
        const span = document.createElement("span");
        span.textContent = linkText;
        span.style.cssText = style + ";transition:opacity .15s;";
        span.addEventListener("mouseenter", () => { span.style.opacity = "0.7"; });
        span.addEventListener("mouseleave", () => { span.style.opacity = "1"; });
        if (attrs) {
          for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
        }
        decos.push(Decoration.replace({ widget: createWidget(span) }).range(range.from, range.to));
      }
    } else if (range.node.type === "definition") {
      // Link reference definitions [id]: url — always render with muted color.
      // Previously collapsed line height to 0 when cursor off; that HEIGHT:0↔FULL toggle
      // was the single biggest click-drift source. Heights must stay constant regardless
      // of cursor to keep CM6's measurement cache and click-position resolution stable.
      decos.push(
        Decoration.mark({ attributes: { style: "color:var(--nexus-text-faint)" } })
          .range(range.from, range.to)
      );
    } else if (range.node.type === "footnoteReference") {
      const ref = range.node as FootnoteReference;
      const sup = document.createElement("sup");
      sup.textContent = ref.identifier;
      sup.style.cssText = "color:var(--nexus-accent);cursor:pointer;font-size:0.8em;vertical-align:super;";
      decos.push(Decoration.replace({ widget: createWidget(sup) }).range(range.from, range.to));
    } else if (range.node.type === "footnoteDefinition") {
      const def = range.node as FootnoteDefinition;
      const defText = range.source.replace(/^\[\^\w+\]:\s*/, "");
      const el = document.createElement("div");
      el.style.cssText = "font-size:0.85em;color:var(--nexus-text-muted);border-top:1px solid var(--nexus-border);padding-top:8px;";
      const marker = document.createElement("sup");
      marker.textContent = def.identifier;
      marker.style.cssText = "color:var(--nexus-accent);margin-right:4px;";
      el.appendChild(marker);
      el.appendChild(document.createTextNode(defText));
      // Use line decoration + widget for stable viewport height
      decos.push(Decoration.line({
        attributes: { style: "padding:0;margin:0;min-height:0;" }
      }).range(range.from));
      decos.push(
        Decoration.replace({ widget: createWidget(el) }).range(range.from, range.to)
      );
    } else {
      if (range.node.type === "heading" || range.node.type === "table") {
        parentSpans.push([range.from, range.to]);
      }

      // Inline formatting: Decoration.replace for markers (standard CM6 approach).
      // Ranges are always emitted; we check cursor line here to decide whether to decorate.
      const inlineStyle = getInlineMarkerStyle(range.node.type, range.source);
      if (inlineStyle && !config.renderers[range.node.type]) {
        const cursorOnLine = selectionOnSameLine(range.from, range.to, doc, selection);
        if (!cursorOnLine) {
          const { openLen, closeLen, style, attrs } = inlineStyle;
          if (openLen > 0) {
            decos.push(Decoration.replace({}).range(range.from, range.from + openLen));
          }
          if (closeLen > 0) {
            decos.push(Decoration.replace({}).range(range.to - closeLen, range.to));
          }
          const textFrom = range.from + openLen;
          const textTo = range.to - closeLen;
          if (textTo > textFrom) {
            decos.push(Decoration.mark({ attributes: { style, ...attrs } }).range(textFrom, textTo));
          }
        }
      } else {
        // Block fallback for thematicBreak: always render as widget.
        // Cursor-toggle between widget and raw caused block-height shifts
        // (widget margins differ from raw-line height), destabilizing click resolution.
        const isBlock = BLOCK_NODE_TYPES.has(range.node.type);
        // Pre-measure height estimate so CM6's heightmap doesn't start at 0 and
        // jump to the real value on first render (source of post-widget click drift).
        // thematicBreak: 8 padding-top + 1 line + 8 padding-bottom = 17px.
        let heightHint: number | undefined;
        if (isBlock) {
          heightHint = 17;
        }
        const blockKey = `${range.node.type}:${range.from}:${range.to}:${range.source}`;
        decos.push(
          Decoration.replace({
            widget: createWidget(
              () => renderLivePreviewNode(range.node, range.source, config.renderers, range.from, range.to),
              isBlock,
              heightHint,
              blockKey,
            ),
            block: isBlock
          }).range(range.from, range.to)
        );
      }
    }
  }

  const set = Decoration.set(decos, true);
  if (perfEnabled) {
    const t3 = performance.now();
    const parseMs = t1 - t0;
    const rangesMs = t2 - t1;
    const buildMs = t3 - t2;
    const total = t3 - t0;
    // Only log when any stage is non-trivial, to avoid flooding the console
    // during normal cursor movement on small files.
    if (total > 5 || parseMs > 2) {
      // eslint-disable-next-line no-console
      console.log(
        "%c[perf]", "color:#0aa;font-weight:bold",
        "buildDecorations",
        `total=${total.toFixed(1)}ms`,
        {
          astHit,
          parse: +parseMs.toFixed(1),
          collectRanges: +rangesMs.toFixed(1),
          buildWidgets: +buildMs.toFixed(1),
          docLen: doc.length,
          ranges: ranges.length,
          decos: decos.length,
        },
      );
    }
  }
  return { decos: set, ast, codeTokens };
}

export function createLivePreviewExtension(
  config: boolean | LivePreviewConfig | undefined,
  localeLabels?: LivePreviewLabels
): Extension[] {
  const normalized = normalizeConfig(config);
  if (!normalized.enabled) return [];
  // Locale labels override config labels
  if (localeLabels) {
    Object.assign(normalized.labels, localeLabels);
  }

  const viewRef: { current: EditorView | null } = { current: null };

  // Cache the most recent (doc, ast, codeTokens) tuple keyed by doc string.
  // Cursor-only updates pass this through as ctx so we skip the Lezer→mdast
  // walk and the hljs run when the source hasn't changed. Edits replace the
  // cache via the docChanged branch below.
  let lastBuilt: { doc: string; ast: Root; codeTokens: CodeHighlightToken[] } | null = null;

  function build(state: EditorState, selection: readonly SelectionRange[], reuseCache: boolean) {
    const docStr = state.doc.toString();
    const ctx: BuildContext = reuseCache && lastBuilt && lastBuilt.doc === docStr
      ? { ast: lastBuilt.ast, codeTokens: lastBuilt.codeTokens }
      : {};
    const out = buildDecorations(state, selection, normalized, viewRef, ctx);
    lastBuilt = { doc: docStr, ast: out.ast, codeTokens: out.codeTokens };
    return out.decos;
  }

  const field = StateField.define<DecorationSet>({
    create(state) {
      return build(state, state.selection.ranges, false);
    },
    update(decos: DecorationSet, tr: Transaction) {
      if (isTableEditing()) {
        return tr.docChanged ? decos.map(tr.changes) : decos;
      }
      if (tr.docChanged) {
        // Doc changed → invalidate the cache and rebuild from the live Lezer
        // tree. Lezer's parse is incremental (intrinsic to EditorState), so
        // this is cheap regardless of doc length.
        return build(tr.state, tr.state.selection.ranges, false);
      }
      if (tr.selection) {
        // Selection-only update → reuse the previous ast + codeTokens; only
        // the cursor-aware decoration toggles need to rerun.
        return build(tr.state, tr.state.selection.ranges, true);
      }
      return decos;
    },
    provide(field) {
      return EditorView.decorations.from(field);
    }
  });

  const viewCapture = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        viewRef.current = view;
      }

      update(): void {
        viewRef.current = this.view;
      }

      destroy(): void {
        if (viewRef.current === this.view) viewRef.current = null;
      }
    }
  );

  // Click to navigate links; arrow-key into link to edit
  const linkHandler = EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target as HTMLElement;
      const linkEl = target.closest("[data-link-url]");
      if (!linkEl) return false;
      const url = linkEl.getAttribute("data-link-url");
      if (!url) return false;

      event.preventDefault();

      // Internal anchor links: scroll to heading
      if (url.startsWith("#")) {
        const targetSlug = url.slice(1).replace(/^-+/, "");
        const doc = view.state.doc.toString();
        const headingRe = /^(#{1,6})\s+(.+)$/gm;
        let m: RegExpExecArray | null;
        while ((m = headingRe.exec(doc)) !== null) {
          const headingSlug = m[2].trim()
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s-]/gu, "")
            .trim()
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-+|-+$/g, "");
          if (headingSlug === targetSlug) {
            view.dispatch({
              selection: { anchor: m.index },
              effects: EditorView.scrollIntoView(m.index, { y: "start", yMargin: 20 })
            });
            view.focus();
            return true;
          }
        }
        return true;
      }

      // External links: open in new tab
      window.open(url, "_blank", "noopener");
      return true;
    }
  });

  return [field, viewCapture, linkHandler, createLivePreviewDiagnostics()];
}
