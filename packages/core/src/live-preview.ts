import { type EditorState, RangeSet, RangeSetBuilder, StateEffect, StateField, type Extension, type Range, type SelectionRange, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import type { Code, FootnoteDefinition, FootnoteReference, Heading, Html, List, Root, Table } from "mdast";

import type { CodeHighlightToken } from "./types";
import { lezerStringToMdast, lezerTreeToMdast } from "./lezer-mdast-adapter";
import {
  formatCodeSource,
  highlightCodeBlock,
  highlightCodeToHtml,
} from "./live-preview-highlight";

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

const COMPOSITION_REDECORATE_DELAY_MS = 60;

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

/**
 * Horizontal inset for fenced code chrome (px).
 * Slightly less than `.cm-line` padding (20px) so the card sits inside the
 * content area with a few pixels of breathing room around the monospace text,
 * without painting flush to the editor edges.
 */
const CODE_BLOCK_INSET_PX = 12;

const CODE_TOOLBAR_BTN_STYLE =
  "appearance:none;border:1px solid var(--nexus-border-subtle,#ddd);background:var(--nexus-bg,#fff);" +
  "color:var(--nexus-text-muted,#666);font-size:11px;font-family:system-ui,sans-serif;font-weight:500;" +
  "line-height:1;padding:5px 8px;border-radius:6px;cursor:pointer;height:24px;box-sizing:border-box;";

function makeCodeToolbarButton(label: string, title: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.style.cssText = CODE_TOOLBAR_BTN_STYLE;
  b.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  b.addEventListener("mouseenter", () => {
    b.style.background = "var(--nexus-bg-muted,#f0f0f0)";
    b.style.color = "var(--nexus-text,#111)";
  });
  b.addEventListener("mouseleave", () => {
    b.style.background = "var(--nexus-bg,#fff)";
    b.style.color = "var(--nexus-text-muted,#666)";
  });
  return b;
}

function flashCodeToolbarButton(btn: HTMLButtonElement, text: string, restore: string, ms = 1200): void {
  btn.textContent = text;
  setTimeout(() => {
    btn.textContent = restore;
  }, ms);
}

async function copyCodeToClipboard(code: string, copyBtn: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(code);
    flashCodeToolbarButton(copyBtn, "Copied", "Copy");
  } catch {
    flashCodeToolbarButton(copyBtn, "Failed", "Copy");
  }
}

function applyFormattedCode(
  viewRef: { current: EditorView | null },
  lang: string,
  code: string,
  contentStartInDoc: number,
  formatBtn: HTMLButtonElement,
): void {
  const next = formatCodeSource(lang || null, code);
  if (next == null) {
    flashCodeToolbarButton(formatBtn, "—", "Format", 900);
    return;
  }
  const v = viewRef.current;
  if (!v) return;
  const from = contentStartInDoc;
  const to = from + code.length;
  if (from < 0 || to > v.state.doc.length) return;
  v.dispatch({
    changes: { from, to, insert: next },
    selection: { anchor: from },
  });
  v.focus();
}

function buildCodeBlockToolbar(
  lang: string,
  actions: HTMLElement[],
): { toolbar: HTMLElement; langLabel: HTMLElement } {
  const toolbar = document.createElement("div");
  toolbar.className = "nexus-code-block__toolbar";
  toolbar.style.cssText = [
    "display:flex",
    "align-items:center",
    "gap:8px",
    "padding:6px 10px",
    "border-bottom:1px solid var(--nexus-border, #e7e5e4)",
    "background:var(--nexus-bg, #fff)",
    "min-height:32px",
    "box-sizing:border-box",
    "user-select:none",
  ].join(";") + ";";

  const langLabel = document.createElement("span");
  langLabel.className = "nexus-code-block__lang";
  langLabel.textContent = lang || "plain";
  langLabel.style.cssText =
    "font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:lowercase;" +
    "color:var(--nexus-text-muted,#777);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;";

  const actionsEl = document.createElement("div");
  actionsEl.className = "nexus-code-block__actions";
  actionsEl.style.cssText = "display:flex;align-items:center;gap:4px;margin-left:auto;";
  for (const action of actions) actionsEl.appendChild(action);

  toolbar.append(langLabel, actionsEl);
  return { toolbar, langLabel };
}

/**
 * Preview-mode fenced code block: full block widget with its own header toolbar
 * (language · wrap · format · copy · edit). When the cursor enters the source
 * range, buildCodeBlockDecorations falls through to raw markdown editing.
 */
class CodeBlockWidget extends WidgetType {
  constructor(
    private readonly code: string,
    private readonly lang: string,
    private readonly viewRef: { current: EditorView | null },
    private readonly blockFrom: number,
    private readonly contentStartInDoc: number,
  ) {
    super();
  }

  eq(other: CodeBlockWidget): boolean {
    return other.code === this.code && other.lang === this.lang && other.blockFrom === this.blockFrom;
  }

  ignoreEvent(): boolean {
    return true;
  }

  get estimatedHeight(): number {
    const lines = Math.max(1, this.code.split("\n").length);
    // outer vertical pad (8+8) + header ~34 + line ~20 + pre pad ~24
    return 16 + 34 + lines * 20 + 24;
  }

  toDOM(): HTMLElement {
    // Outer shell provides horizontal inset matching `.cm-line` padding.
    // CRITICAL: use padding (not margin) so CM6 heightmap measures full height.
    const shell = document.createElement("div");
    shell.className = "nexus-code-block-shell";
    shell.style.cssText = [
      "display:block",
      "margin:0",
      `padding:8px ${CODE_BLOCK_INSET_PX}px`,
      "box-sizing:border-box",
      "width:100%",
    ].join(";") + ";";

    const root = document.createElement("div");
    root.className = "nexus-code-block";
    root.setAttribute("role", "figure");
    if (this.lang) root.setAttribute("data-lang", this.lang);
    root.style.cssText = [
      "display:block",
      "margin:0",
      "padding:0",
      "border:1px solid var(--nexus-border, #e7e5e4)",
      "border-radius:10px",
      "background:var(--nexus-bg-subtle, #f5f5f5)",
      "overflow:hidden",
      "font-family:system-ui,-apple-system,sans-serif",
    ].join(";") + ";";

    const wrapBtn = makeCodeToolbarButton("Wrap", "Toggle line wrap");
    const formatBtn = makeCodeToolbarButton("Format", "Format code (JSON + tidy whitespace)");
    const copyBtn = makeCodeToolbarButton("Copy", this.lang ? `Copy ${this.lang} code` : "Copy code");
    const editBtn = makeCodeToolbarButton("Edit", "Edit source");
    const { toolbar } = buildCodeBlockToolbar(this.lang, [wrapBtn, formatBtn, copyBtn, editBtn]);

    const pre = document.createElement("pre");
    pre.className = "nexus-code-block__pre";
    pre.style.cssText = [
      "margin:0",
      "padding:12px 14px",
      "overflow:auto",
      "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
      "font-size:13px",
      "line-height:1.55",
      "color:var(--nexus-text,#111)",
      "background:transparent",
      "white-space:pre",
      "tab-size:2",
    ].join(";") + ";";

    const codeEl = document.createElement("code");
    codeEl.className = "hljs nexus-code-block__code";
    codeEl.innerHTML = highlightCodeToHtml(this.lang || null, this.code);
    pre.appendChild(codeEl);

    let wrapped = false;
    wrapBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrapped = !wrapped;
      pre.style.whiteSpace = wrapped ? "pre-wrap" : "pre";
      wrapBtn.style.borderColor = wrapped
        ? "var(--nexus-accent,#292524)"
        : "var(--nexus-border-subtle,#ddd)";
    });

    formatBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyFormattedCode(this.viewRef, this.lang, this.code, this.contentStartInDoc, formatBtn);
    });

    copyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void copyCodeToClipboard(this.code, copyBtn);
    });

    editBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const v = this.viewRef.current;
      if (!v) return;
      const target = Math.min(this.contentStartInDoc, v.state.doc.length);
      v.dispatch({ selection: { anchor: target } });
      v.focus();
    });

    root.append(toolbar, pre);
    shell.appendChild(root);
    return shell;
  }
}

/**
 * Edit-mode header that sits above the fenced source while the cursor is
 * inside the block. Provides the same copy / format actions as the preview
 * widget so the toolbar is always available.
 */
class CodeBlockEditToolbar extends WidgetType {
  constructor(
    private readonly code: string,
    private readonly lang: string,
    private readonly viewRef: { current: EditorView | null },
    private readonly contentStartInDoc: number,
    private readonly blockFrom: number,
  ) {
    super();
  }

  eq(other: CodeBlockEditToolbar): boolean {
    return (
      other.code === this.code &&
      other.lang === this.lang &&
      other.blockFrom === this.blockFrom &&
      other.contentStartInDoc === this.contentStartInDoc
    );
  }

  ignoreEvent(): boolean {
    return true;
  }

  get estimatedHeight(): number {
    // outer top pad + toolbar height (no bottom pad — source lines follow)
    return 8 + 34;
  }

  toDOM(): HTMLElement {
    const shell = document.createElement("div");
    shell.className = "nexus-code-block-shell nexus-code-block-shell--editing";
    shell.style.cssText = [
      "display:block",
      "margin:0",
      `padding:8px ${CODE_BLOCK_INSET_PX}px 0`,
      "box-sizing:border-box",
      "width:100%",
    ].join(";") + ";";

    const card = document.createElement("div");
    // Distinct from `.nexus-code-block` (preview widget) so callers can tell
    // edit-chrome from the full replace widget.
    card.className = "nexus-code-block-edit-toolbar";
    card.style.cssText = [
      "display:block",
      "margin:0",
      "border:1px solid var(--nexus-border, #e7e5e4)",
      "border-bottom:0",
      "border-radius:10px 10px 0 0",
      "background:var(--nexus-bg, #fff)",
      "overflow:hidden",
      "font-family:system-ui,-apple-system,sans-serif",
    ].join(";") + ";";

    const formatBtn = makeCodeToolbarButton("Format", "Format code (JSON + tidy whitespace)");
    const copyBtn = makeCodeToolbarButton("Copy", this.lang ? `Copy ${this.lang} code` : "Copy code");
    const { toolbar } = buildCodeBlockToolbar(this.lang, [formatBtn, copyBtn]);
    // Editing header has no code body below it in this widget — drop the
    // bottom rule so it blends into the source lines that follow.
    toolbar.style.borderBottom = "0";

    formatBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyFormattedCode(this.viewRef, this.lang, this.code, this.contentStartInDoc, formatBtn);
    });
    copyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void copyCodeToClipboard(this.code, copyBtn);
    });

    card.appendChild(toolbar);
    shell.appendChild(card);
    return shell;
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

function shouldRebuildHeadingForCompositionStart(view: EditorView): boolean {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  return /^\s{0,3}#{1,6}\s+\S/.test(line.text);
}

function buildHeadingDecorations(
  range: { from: number; to: number; node: Heading },
  doc: string,
  selection: readonly SelectionRange[],
  decos: Range<Decoration>[],
  compositionActive: boolean
): void {
  const firstChild = range.node.children[0];
  const textStart = firstChild?.position?.start?.offset;

  if (typeof textStart === "number" && textStart > range.from && textStart <= range.to) {
    if (compositionActive && selectionOnSameLine(range.from, range.to, doc, selection)) {
      return;
    }
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
  selection: readonly SelectionRange[],
  decos: Range<Decoration>[],
  viewRef: { current: EditorView | null }
): void {
  // Iterate ListItems via mdast structure (not regex over flat source lines).
  // Nested sub-lists are children of a ListItem, not of the outer list, so
  // walking list.children visits only this level \u2014 no double-decoration of
  // nested markers and no off-by-N ordered numbering caused by counting
  // nested-list lines as siblings.
  const list = range.node;
  const isOrdered = list.ordered === true;
  let orderNum = list.start ?? 1;

  for (const item of list.children) {
    const itemFrom = item.position?.start.offset;
    if (typeof itemFrom !== "number") continue;

    const newlineIdx = doc.indexOf("\n", itemFrom);
    const headLineEnd = newlineIdx === -1 ? doc.length : newlineIdx;
    const headLine = doc.slice(itemFrom, headLineEnd);
    const markerMatch = LIST_MARKER_RE.exec(headLine);
    if (!markerMatch) continue;

    // 预先占用本项的序号：即便下面因光标落在本行而露出原始 marker，
    // 它仍占一个序号，避免兄弟项被重新编号。
    const ordinal = orderNum;
    if (isOrdered) orderNum++;

    // Obsidian 式实时预览：光标落在本项首行时，显示原始 `- [ ] ` / `1. `
    // 源码以便直接编辑；其余项保持渲染后的圆点 / 复选框。inclusiveEnd
    // 让光标停在行尾（按 End 后）也算在行内。
    if (selectionIntersects(itemFrom, headLineEnd, selection, true)) continue;

    const indent = markerMatch[1];
    const markerStart = itemFrom + indent.length;
    const markerEnd = itemFrom + markerMatch[0].length;

    const bullet = document.createElement("span");
    let bulletKey: string;
    if (isOrdered) {
      bullet.textContent = `${ordinal}. `;
      bullet.style.color = "var(--nexus-text-muted)";
      bulletKey = `bullet:ord:${ordinal}:${markerStart}-${markerEnd}`;
    } else {
      bullet.textContent = "\u2022 ";
      bullet.style.color = "var(--nexus-text-muted)";
      bulletKey = `bullet:ul:${markerStart}-${markerEnd}`;
    }
    decos.push(
      Decoration.replace({
        widget: createWidget(bullet, false, undefined, bulletKey),
      }).range(markerStart, markerEnd)
    );

    const afterMarker = headLine.slice(markerMatch[0].length);
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
      // mousedown 先于 click：阻止 CM6 在 widget 上启动选区拖拽 / 移动光标，
      // 否则点击会被解读成"把光标放到该行"而非切换复选框。
      checkbox.addEventListener("mousedown", (e) => { e.preventDefault(); });
      checkbox.addEventListener("click", (e) => {
        e.preventDefault();
        const v = viewRef.current;
        if (!v) return;
        v.dispatch({
          changes: { from: toggleFrom, to: toggleFrom + 1, insert: isChecked ? " " : "x" }
        });
      });

      const taskKey = `task:${checkStart}-${checkEnd}:${isChecked ? "x" : " "}`;
      decos.push(
        Decoration.replace({
          // swallowEvents=true → ignoreEvent() 返回 true，CM6 不再抢占点击，
          // 复选框自身的 click 处理器得以触发完成切换。
          widget: createWidget(checkbox, true, undefined, taskKey),
        }).range(checkStart, checkEnd)
      );

      if (isChecked && checkEnd < headLineEnd) {
        decos.push(
          Decoration.mark({
            attributes: { style: "text-decoration: line-through; color: var(--nexus-text-muted)" }
          }).range(checkEnd, headLineEnd)
        );
      }
    }
  }
}

/**
 * True when the HTML block is purely an HTML comment (`<!-- … -->`), possibly
 * with surrounding whitespace. Such blocks have no rendered output, so they
 * must be shown as visible text rather than injected via innerHTML.
 */
function isHtmlComment(raw: string): boolean {
  return /^\s*<!--[\s\S]*-->\s*$/.test(raw);
}

// Tags that an embedded HTML block can safely render via innerHTML. We
// strip `<script>`, `<iframe>`, `<object>`, `<embed>`, on*=… handler
// attributes, and javascript: URLs to keep authored Markdown from
// turning into an arbitrary code execution vector when previewed.
// The list intentionally allows enough structural / styling tags for
// real authoring (`<details>`, `<summary>`, `<div style>`, etc.) — it's
// not meant as a full sanitiser, hosts that need stronger guarantees
// can plug their own via `LivePreviewConfig.htmlSanitizer`.
function defaultSanitizeHtml(rawHtml: string): string {
  let html = rawHtml;
  // Remove dangerous element bodies entirely (open tag through close tag).
  html = html.replace(/<\s*(script|iframe|object|embed|style)\b[\s\S]*?<\/\s*\1\s*>/gi, "");
  // Remove orphan dangerous self-closing tags.
  html = html.replace(/<\s*(script|iframe|object|embed|style)\b[^>]*\/?>/gi, "");
  // Strip inline event handlers: `onclick="…"` / `onload='…'` / onfoo=bareword.
  html = html.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // Strip `javascript:` URLs in href / src attributes.
  html = html.replace(/(href|src|xlink:href)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, '$1=$2#$2');
  return html;
}

function buildHtmlDecorations(
  range: { from: number; to: number; node: Html; source: string },
  selection: readonly SelectionRange[],
  decos: Range<Decoration>[],
  config: NormalizedLivePreviewConfig,
  viewRef: { current: EditorView | null }
): void {
  // Show raw source while the user is editing the block — same pattern as
  // mermaid / code blocks. `inclusiveEnd: true` so the cursor parked at the
  // closing offset (typical after pressing End) still counts as inside.
  const cursorInside = selectionIntersects(range.from, range.to, selection, true);
  if (cursorInside) return;

  // Host may override with a custom renderer (e.g. to plug a stronger
  // sanitiser like DOMPurify); fall back to the conservative default.
  const customRenderer = config.renderers.html;
  let inner: HTMLElement | null = null;
  if (customRenderer) {
    try {
      inner = customRenderer({
        node: range.node,
        nodeType: "html",
        source: range.source,
        text: range.node.value ?? range.source,
        from: range.from,
        to: range.to,
      });
    } catch {
      inner = null;
    }
  }
  if (!inner) {
    const raw = range.node.value ?? range.source;
    if (isHtmlComment(raw)) {
      // An HTML comment injected via innerHTML parses into an invisible DOM
      // comment node, so the widget renders empty and the whole block
      // disappears in live preview — only re-appearing when the text is
      // selected. Render it as visible muted text instead so authoring
      // comments (e.g. the user.md profile template) stay readable.
      inner = document.createElement("div");
      inner.className = "nexus-html-comment";
      inner.style.cssText =
        "display:block;margin:0;padding:0;line-height:normal;font-family:inherit;white-space:pre-wrap;color:var(--nexus-hl-comment);";
      inner.textContent = raw;
    } else {
      inner = document.createElement("div");
      inner.className = "nexus-html-block-content";
      inner.style.cssText = "display:block;margin:0;padding:0;line-height:normal;font-family:inherit;";
      inner.innerHTML = defaultSanitizeHtml(raw);
    }
  }

  // Click anywhere on the rendered HTML to enter edit mode — except on
  // elements whose native click behaviour the author almost certainly
  // wants to keep working (`<summary>` toggles `<details>`, `<a href>`
  // opens a link, form controls focus / activate). For everything else
  // we drop the caret at the block's source start, which triggers the
  // next StateField update to fall through `selectionIntersects` and
  // reveal the raw markup for editing.
  //
  // The widget body still uses `swallowEvents: true` so CM6 doesn't try
  // to resolve the click into a cursor position itself.
  const wrapper = document.createElement("div");
  wrapper.className = "nexus-html-block";
  wrapper.style.cssText = "position:relative;display:block;margin:0;padding:0;cursor:text;";
  wrapper.appendChild(inner);

  // Selector for elements whose native behaviour we want to preserve.
  const INTERACTIVE_SELECTOR =
    "summary, a[href], button, input, select, textarea, label, [data-html-interactive]";

  // mousedown fires before any inner element's click handler, so this
  // consistently wins races against e.g. native `<summary>` toggle —
  // hence why the early-return uses mousedown rather than click.
  wrapper.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement | null;
    if (target && target.closest(INTERACTIVE_SELECTOR)) {
      // Let the native click/toggle/link/focus happen.
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const v = viewRef.current;
    if (!v) return;
    const safeFrom = Math.min(range.from, v.state.doc.length);
    v.dispatch({ selection: { anchor: safeFrom } });
    v.focus();
  });

  // Pre-measure: rendered HTML rarely matches CM6's line-height heuristic,
  // so giving it any positive estimatedHeight prevents the post-mount
  // measurement reflow that shifts click resolution below the block.
  const heightHint = 24;
  const htmlKey = `html:${range.from}:${range.to}:${range.source}`;

  decos.push(
    Decoration.replace({
      widget: createWidget(wrapper, true, heightHint, htmlKey),
      block: true,
    }).range(range.from, range.to)
  );
}

const BLOCKQUOTE_MARKER_RE = /^( {0,3}>[ \t]?)/;
const ALERT_TAG_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/;

type AlertType = "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION";

interface AlertStyle {
  borderColor: string;
  bg: string;
  textColor: string;
  icon: string;
  label: string;
}

const ALERT_STYLES: Record<AlertType, AlertStyle> = {
  NOTE: { borderColor: "#0969da", bg: "rgba(9,105,218,0.08)", textColor: "#0969da", icon: "ℹ", label: "Note" },
  TIP: { borderColor: "#1a7f37", bg: "rgba(26,127,55,0.08)", textColor: "#1a7f37", icon: "💡", label: "Tip" },
  IMPORTANT: { borderColor: "#8250df", bg: "rgba(130,80,223,0.08)", textColor: "#8250df", icon: "❗", label: "Important" },
  WARNING: { borderColor: "#9a6700", bg: "rgba(154,103,0,0.08)", textColor: "#9a6700", icon: "⚠", label: "Warning" },
  CAUTION: { borderColor: "#cf222e", bg: "rgba(207,34,46,0.08)", textColor: "#cf222e", icon: "🚫", label: "Caution" },
};

/**
 * Detect a GFM Alert (GitHub-style callout). Source convention:
 *   > [!NOTE]
 *   > body...
 * The first non-marker content on line 0 must match `[!TYPE]` exactly
 * (whitespace allowed before/after). Returns the type and the original
 * head-line length so the caller can register a parentSpan that hides
 * the inline link decoration the lezer adapter emits for `[!TYPE]`.
 */
function detectAlert(source: string): {
  type: AlertType;
  headLineEnd: number;
  tagStartInLine: number;
  tagEndInLine: number;
} | null {
  const newlineIdx = source.indexOf("\n");
  const firstLine = newlineIdx === -1 ? source : source.slice(0, newlineIdx);
  const markerMatch = BLOCKQUOTE_MARKER_RE.exec(firstLine);
  if (!markerMatch) return null;
  const after = firstLine.slice(markerMatch[0].length);
  const alertMatch = ALERT_TAG_RE.exec(after);
  if (!alertMatch) return null;
  return {
    type: alertMatch[1] as AlertType,
    headLineEnd: firstLine.length,
    tagStartInLine: markerMatch[0].length,
    tagEndInLine: markerMatch[0].length + alertMatch[0].trimEnd().length,
  };
}

/**
 * Decorate a blockquote range. Returns the detected GFM alert type when the
 * blockquote opens with `> [!NOTE]` / `[!TIP]` / etc., so the caller can
 * register a parent span over the head line (the line containing `[!TYPE]`)
 * and suppress the link decoration the inline pass emits for that bracket
 * pair. Subsequent lines stay open to inline markdown like `**bold**`.
 */
function buildBlockquoteDecorations(
  range: { from: number; to: number; source: string },
  selection: readonly SelectionRange[],
  decos: Range<Decoration>[]
): { alertHeadEnd: number } | null {
  const source = range.source;
  const lines = source.split("\n");
  const cursorInBlockquote = selectionIntersects(range.from, range.to, selection, true);
  const alert = detectAlert(source);
  const style = alert ? ALERT_STYLES[alert.type] : null;
  let offset = range.from;
  let alertHeadEnd = -1;

  const lineStyleFor = (i: number): string => {
    if (style) {
      const radiusTop = i === 0 ? "6px 6px" : "0 0";
      const radiusBottom = i === lines.length - 1 ? "6px 6px" : "0 0";
      return (
        `color:var(--nexus-text);` +
        `border-left:4px solid ${style.borderColor};` +
        `background:${style.bg};` +
        `padding:2px 12px;` +
        `border-radius:${radiusTop} ${radiusBottom};`
      );
    }
    return (
      "color:var(--nexus-text-muted);" +
      "border-left:3px solid var(--nexus-border);" +
      "padding-left:12px;"
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    const lineEnd = offset + line.length;

    decos.push(
      Decoration.line({ attributes: { style: lineStyleFor(i) } }).range(lineStart)
    );

    const markerMatch = BLOCKQUOTE_MARKER_RE.exec(line);
    if (!cursorInBlockquote && markerMatch) {
      const markerEnd = lineStart + markerMatch[0].length;
      if (markerEnd <= lineEnd) {
        decos.push(Decoration.replace({}).range(lineStart, markerEnd));
      }

      // Replace the `[!TYPE]` tag on the head line with a styled badge.
      if (alert && style && i === 0) {
        const tagStart = lineStart + alert.tagStartInLine;
        const tagEnd = lineStart + alert.tagEndInLine;
        if (tagEnd > tagStart) {
          const badge = document.createElement("span");
          badge.className = "nexus-alert-label";
          badge.style.cssText =
            `display:inline-flex;align-items:center;gap:6px;` +
            `color:${style.textColor};font-weight:600;font-size:0.95em;`;
          const iconSpan = document.createElement("span");
          iconSpan.textContent = style.icon;
          iconSpan.setAttribute("aria-hidden", "true");
          const labelSpan = document.createElement("span");
          labelSpan.textContent = style.label;
          badge.appendChild(iconSpan);
          badge.appendChild(labelSpan);
          decos.push(
            Decoration.replace({
              widget: createWidget(badge, false, undefined, `alert:${alert.type}:${tagStart}`),
            }).range(tagStart, tagEnd)
          );
          alertHeadEnd = lineEnd;
        }
      }
    }

    offset = lineEnd + 1;
  }

  return alertHeadEnd >= 0 ? { alertHeadEnd } : null;
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
  const codeValue = range.node.value ?? "";
  const lang = range.node.lang ?? "";
  const contentStart = firstNewline >= 0 ? range.from + firstNewline + 1 : range.from;

  // Mermaid: dedicated diagram widget when cursor is outside.
  if (lang === "mermaid" && !cursorOnCode && firstNewline >= 0) {
    decos.push(
      Decoration.replace({
        widget: new MermaidWidget(codeValue, viewRef, range.from, firstNewline + 1),
        block: true,
      }).range(range.from, range.to)
    );
    return;
  }

  // Preview mode: full code-block widget with header toolbar.
  if (isFenced && !cursorOnCode && firstNewline >= 0) {
    decos.push(
      Decoration.replace({
        widget: new CodeBlockWidget(codeValue, lang, viewRef, range.from, contentStart),
        block: true,
      }).range(range.from, range.to)
    );
    return;
  }

  // Edit mode (cursor inside): height-safe line decorations + toolbar above.
  // Line decorations must NOT change font-family/font-size (CM6 heightmap).
  //
  // Card fill + side borders are drawn as centered background layers inset by
  // CODE_BLOCK_INSET_PX so the chrome aligns with prose and never paints flush
  // to the content edges. Prefer background-image over margin/position —
  // those break CM6 click mapping and height measurement.
  const inset = CODE_BLOCK_INSET_PX;
  const cardWidth = `calc(100% - ${inset * 2}px)`;
  const MONO_MARK = "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;";

  // Toolbar above the fence while editing (copy / format always available).
  if (isFenced) {
    decos.push(
      Decoration.widget({
        widget: new CodeBlockEditToolbar(codeValue, lang, viewRef, contentStart, range.from),
        block: true,
        side: -1,
      }).range(range.from)
    );
  }

  let lineOffset = range.from;
  for (let li = 0; li < lines.length; li++) {
    const lineStart = lineOffset;
    const lineEnd = lineOffset + lines[li].length;
    const isFirstLine = li === 0;
    const isLastLine = li === lines.length - 1;

    // Layers: fill, left hairline, right hairline, optional bottom hairline.
    const images = [
      "linear-gradient(var(--nexus-bg-subtle),var(--nexus-bg-subtle))",
      "linear-gradient(var(--nexus-border,#e7e5e4),var(--nexus-border,#e7e5e4))",
      "linear-gradient(var(--nexus-border,#e7e5e4),var(--nexus-border,#e7e5e4))",
    ];
    const sizes = [`${cardWidth} 100%`, "1px 100%", "1px 100%"];
    const positions = [
      "center top",
      `${inset}px top`,
      `calc(100% - ${inset + 1}px) top`,
    ];
    if (isLastLine || (!isFenced && isFirstLine && isLastLine)) {
      images.push("linear-gradient(var(--nexus-border,#e7e5e4),var(--nexus-border,#e7e5e4))");
      sizes.push(`${cardWidth} 1px`);
      positions.push("center bottom");
    }
    if (!isFenced && isFirstLine) {
      images.push("linear-gradient(var(--nexus-border,#e7e5e4),var(--nexus-border,#e7e5e4))");
      sizes.push(`${cardWidth} 1px`);
      positions.push("center top");
    }

    let radius = "";
    if (isFenced) {
      // Toolbar already draws the top of the card; only round the bottom.
      if (isLastLine) radius = "border-radius:0 0 10px 10px;";
    } else if (isFirstLine && isLastLine) {
      radius = "border-radius:10px;";
    } else if (isFirstLine) {
      radius = "border-radius:10px 10px 0 0;";
    } else if (isLastLine) {
      radius = "border-radius:0 0 10px 10px;";
    }

    const lineStyle =
      "background-color:transparent;" +
      `background-image:${images.join(",")};` +
      `background-size:${sizes.join(",")};` +
      `background-position:${positions.join(",")};` +
      "background-repeat:no-repeat;" +
      "line-height:1.4em;" +
      radius;

    const lineAttrs: Record<string, string> = {
      style: lineStyle,
      class:
        "nexus-code-line nexus-code-line--editing" +
        (isFirstLine ? " nexus-code-line--first" : "") +
        (isLastLine ? " nexus-code-line--last" : ""),
    };
    if (isFirstLine) {
      lineAttrs.role = "code";
      if (lang) lineAttrs["aria-label"] = `Code block: ${lang}`;
    }
    decos.push(Decoration.line({ attributes: lineAttrs }).range(lineStart));

    if (isFenced && (isFirstLine || isLastLine) && lineEnd > lineStart) {
      decos.push(
        Decoration.mark({
          attributes: {
            style: MONO_MARK + "color:var(--nexus-text-faint,#bbb);",
          },
        }).range(lineStart, lineEnd)
      );
    }

    if (!(isFenced && (isFirstLine || isLastLine)) && lineEnd > lineStart) {
      decos.push(
        Decoration.mark({
          attributes: { style: MONO_MARK },
        }).range(lineStart, lineEnd)
      );
    }

    lineOffset = lineEnd + 1;
  }

  // Token highlights while editing source.
  if (codeTokens && codeTokens.length > 0 && firstNewline >= 0 && codeValue) {
    const contentEnd = range.to;
    for (const tok of codeTokens) {
      if (tok.from >= contentEnd) break;
      if (tok.to <= contentStart) continue;
      if (tok.from < range.from || tok.to > range.to) continue;
      decos.push(Decoration.mark({ class: tok.className }).range(tok.from, tok.to));
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
  compositionActive?: boolean;
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
      buildHeadingDecorations(
        range as { from: number; to: number; node: Heading },
        doc,
        selection,
        decos,
        ctx.compositionActive === true
      );
    } else if (range.node.type === "table" && !config.renderers.table) {
      decos.push(
        Decoration.replace({
          widget: new EditableTableWidget(
            range.node as Table, range.from, range.source, viewRef, config.labels
          ),
          block: true
        }).range(range.from, range.to)
      );
    } else if (range.node.type === "html") {
      buildHtmlDecorations(
        range as { from: number; to: number; node: Html; source: string },
        selection,
        decos,
        config,
        viewRef
      );
    } else if (range.node.type === "list") {
      buildListDecorations(range as { from: number; to: number; node: List }, doc, selection, decos, viewRef);
    } else if (range.node.type === "blockquote") {
      const alertInfo = buildBlockquoteDecorations(
        range as { from: number; to: number; source: string },
        selection,
        decos
      );
      if (alertInfo) {
        // GFM Alert: suppress the inline link decoration that lezer emits for
        // the `[!TYPE]` bracket pair on the head line — the badge widget
        // replaces the source there anyway, and a competing link decoration
        // shows up as orange-underline bleed-through.
        parentSpans.push([range.from, alertInfo.alertHeadEnd]);
      }
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
      // Exclusive end: cursor parked right after the image (typical after
      // paste/insert) shows the compact preview widget instead of expanding
      // the line with a multi-kilobyte data: URL.
      const cursorOnImage = selectionIntersects(range.from, range.to, selection, false);
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
        const cursorOnLink = selectionIntersects(range.from, range.to, selection, true);
        // When the caret reaches the link source range (for example by
        // pressing ArrowLeft from the right edge), show the raw markdown so
        // users can edit `[text](url)`. Outside the caret range we keep the
        // compact link widget for preview / click navigation.
        if (cursorOnLink) continue;
        const linkText = range.source.slice(openLen, range.source.length - closeLen);
        const span = document.createElement("span");
        span.textContent = linkText;
        span.style.cssText = style + ";transition:opacity .15s;";
        span.addEventListener("mouseenter", () => { span.style.opacity = "0.7"; });
        span.addEventListener("mouseleave", () => { span.style.opacity = "1"; });
        if (attrs) {
          for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
        }
        const linkKey = `link:${range.from}-${range.to}:${range.source}`;
        decos.push(
          Decoration.replace({
            widget: createWidget(span, false, undefined, linkKey),
          }).range(range.from, range.to)
        );
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
      const fnRefKey = `fnref:${range.from}-${range.to}:${ref.identifier}`;
      decos.push(
        Decoration.replace({
          widget: createWidget(sup, false, undefined, fnRefKey),
        }).range(range.from, range.to)
      );
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
      const fnDefKey = `fndef:${range.from}-${range.to}:${def.identifier}:${range.source}`;
      decos.push(
        Decoration.replace({
          widget: createWidget(el, false, undefined, fnDefKey),
        }).range(range.from, range.to)
      );
    } else {
      if (range.node.type === "heading" || range.node.type === "table") {
        parentSpans.push([range.from, range.to]);
      }

      // Inline formatting: Decoration.replace hides the syntactic markers when
      // the cursor isn't on the same line. The inner style (bold/italic/etc.)
      // is applied via Decoration.mark on the content range REGARDLESS of
      // cursor position — that way editing a line with **bold** still shows
      // the bold rendering, just with the `**` markers visible. Without this,
      // any line under the cursor flattens to raw markup with no styling,
      // which is what made nested markers (checked task + **bold** + ~~strike~~)
      // look broken when the user was editing the line.
      const inlineStyle = getInlineMarkerStyle(range.node.type, range.source);
      if (inlineStyle && !config.renderers[range.node.type]) {
        const { openLen, closeLen, style, attrs } = inlineStyle;
        const cursorOnLine = selectionOnSameLine(range.from, range.to, doc, selection);
        const textFrom = range.from + openLen;
        const textTo = range.to - closeLen;

        if (!cursorOnLine) {
          if (openLen > 0) {
            decos.push(Decoration.replace({}).range(range.from, range.from + openLen));
          }
          if (closeLen > 0) {
            decos.push(Decoration.replace({}).range(range.to - closeLen, range.to));
          }
        }

        if (textTo > textFrom) {
          decos.push(Decoration.mark({ attributes: { style, ...attrs } }).range(textFrom, textTo));
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
  let compositionActive = false;
  const rebuildForCompositionStart = StateEffect.define<null>();
  const rebuildAfterComposition = StateEffect.define<null>();

  function build(state: EditorState, selection: readonly SelectionRange[], reuseCache: boolean): DecorationSet {
    const docStr = state.doc.toString();
    const ctx: BuildContext = reuseCache && lastBuilt && lastBuilt.doc === docStr
      ? { ast: lastBuilt.ast, codeTokens: lastBuilt.codeTokens }
      : {};
    try {
      const out = buildDecorations(state, selection, normalized, viewRef, {
        ...ctx,
        compositionActive,
      });
      lastBuilt = { doc: docStr, ast: out.ast, codeTokens: out.codeTokens };
      return out.decos;
    } catch (err) {
      // 任何 decoration 构建异常都不得让编辑器白屏：降级为"无 live-preview 的原始
      // markdown"（仍可编辑），并缓存空 AST，避免后续 selection-only 重建反复抛同样的错。
      // 文档再次变更（docChanged，reuseCache=false）会重新尝试完整构建并自动恢复。
      // eslint-disable-next-line no-console
      console.error("[NexusEditor] live-preview build failed; rendering raw markdown for this view", err);
      lastBuilt = { doc: docStr, ast: createEmptyAst(), codeTokens: [] };
      return Decoration.none;
    }
  }

  const field = StateField.define<DecorationSet>({
    create(state) {
      return build(state, state.selection.ranges, false);
    },
    update(decos: DecorationSet, tr: Transaction) {
      if (isTableEditing(viewRef.current)) {
        return tr.docChanged ? decos.map(tr.changes) : decos;
      }
      if (tr.effects.some((effect) => effect.is(rebuildForCompositionStart))) {
        compositionActive = true;
        return build(tr.state, tr.state.selection.ranges, true);
      }
      if (tr.effects.some((effect) => effect.is(rebuildAfterComposition))) {
        compositionActive = false;
        return build(tr.state, tr.state.selection.ranges, false);
      }
      if (tr.isUserEvent("input.type.compose")) {
        compositionActive = true;
        return tr.docChanged ? decos.map(tr.changes) : decos;
      }
      if (compositionActive) {
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

  const compositionHandler = EditorView.domEventHandlers({
    compositionstart(_event, view) {
      if (!shouldRebuildHeadingForCompositionStart(view)) {
        return false;
      }
      try {
        view.dispatch({ effects: rebuildForCompositionStart.of(null) });
      } catch {
        // composition 事件到达时 view 可能已经销毁。
      }
      return false;
    },
    compositionend(_event, view) {
      setTimeout(() => {
        if (view.compositionStarted) return;
        try {
          view.dispatch({ effects: rebuildAfterComposition.of(null) });
        } catch {
          // The view may have been destroyed before the deferred composition
          // cleanup runs.
        }
      }, COMPOSITION_REDECORATE_DELAY_MS);
      return false;
    },
  });

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

  // 表格被渲染成 block replace widget（整段源码折叠成一个不可逐字进入的部件），
  // 若不告诉 CodeMirror 这是原子区间，方向键上下移动时光标会"掉进"被折叠隐藏的
  // 表格源码里而卡住。把每个表格 widget 的范围登记为 atomicRange，让光标把表格当作
  // 一个整体跳过——上方按 ↓ 直接落到表格下一行，下方按 ↑ 直接回到表格上一行。
  // 单元格编辑仍走点击 + contentEditable（widget ignoreEvent），不受影响。
  const tableAtomicRanges = EditorView.atomicRanges.of((view) => {
    const decoSet = view.state.field(field, false);
    if (!decoSet || decoSet.size === 0) return RangeSet.empty;

    const builder = new RangeSetBuilder<Decoration>();
    const iter = decoSet.iter();
    while (iter.value) {
      const spec = (iter.value as { spec?: { widget?: unknown } }).spec;
      if (iter.to > iter.from && spec?.widget instanceof EditableTableWidget) {
        builder.add(iter.from, iter.to, iter.value);
      }
      iter.next();
    }
    return builder.finish();
  });

  return [field, viewCapture, compositionHandler, linkHandler, tableAtomicRanges, createLivePreviewDiagnostics()];
}
