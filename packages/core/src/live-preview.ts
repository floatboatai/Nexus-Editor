import { StateField, type Extension, type Range, type SelectionRange, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import hljs from "highlight.js";
import type { Code, FootnoteDefinition, FootnoteReference, Heading, List, Root, Table } from "mdast";

import { createLivePreviewDiagnostics } from "./live-preview-diag";
import { collectLivePreviewRanges, selectionIntersects, selectionOnSameLine } from "./live-preview-ranges";
import { renderLivePreviewNode } from "./live-preview-renderers";
import { EditableTableWidget, isTableEditing } from "./live-preview-table";
import type {
  LivePreviewConfig,
  LivePreviewLabels,
  LivePreviewNodeType,
  LivePreviewRenderer,
  ParserLike
} from "./types";

interface NormalizedLivePreviewConfig {
  enabled: boolean;
  renderers: Partial<Record<LivePreviewNodeType, LivePreviewRenderer>>;
  labels: Required<LivePreviewLabels>;
}

const DEFAULT_LABELS: Required<LivePreviewLabels> = {
  addColumn: "Add column",
  addRow: "Add row",
};

function createEmptyAst(): Root {
  return { type: "root", children: [] };
}

function parseDocument(parser: ParserLike, markdown: string): Root {
  try {
    return parser.parse(markdown);
  } catch {
    return createEmptyAst();
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

function createWidget(element: HTMLElement, swallowEvents = false, heightHint?: number): WidgetType {
  return new (class extends WidgetType {
    toDOM() { return element; }
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

const BLOCK_NODE_TYPES = new Set(["blockquote", "thematicBreak"]);

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

// Token-to-CSS-variable map (colors come from the theme)
const HLJS_COLORS: Record<string, string> = {
  keyword: "var(--nexus-hl-keyword)", "selector-tag": "var(--nexus-hl-keyword)", "built_in": "var(--nexus-hl-keyword)", name: "var(--nexus-hl-keyword)", doctag: "var(--nexus-hl-keyword)",
  string: "var(--nexus-hl-string)", attr: "var(--nexus-hl-string)", symbol: "var(--nexus-hl-string)", bullet: "var(--nexus-hl-string)", addition: "var(--nexus-hl-string)", regexp: "var(--nexus-hl-string)", link: "var(--nexus-hl-string)",
  title: "var(--nexus-hl-title)", section: "var(--nexus-hl-title)", "title.function_": "var(--nexus-hl-title)",
  comment: "var(--nexus-hl-comment)", quote: "var(--nexus-hl-comment)", meta: "var(--nexus-hl-comment)",
  number: "var(--nexus-hl-number)", literal: "var(--nexus-hl-number)",
  type: "var(--nexus-hl-type)", params: "var(--nexus-hl-type)",
  deletion: "var(--nexus-hl-deletion)",
  variable: "var(--nexus-hl-variable)", "template-variable": "var(--nexus-hl-variable)",
};

function getTokenColor(scope: string): string | null {
  if (HLJS_COLORS[scope]) return HLJS_COLORS[scope];
  // Try prefix match (e.g., "title.function_" → "title")
  const dot = scope.indexOf(".");
  if (dot > 0) return HLJS_COLORS[scope.slice(0, dot)] ?? null;
  return null;
}

function buildCodeBlockDecorations(
  range: { from: number; to: number; node: Code; source: string },
  selection: readonly SelectionRange[],
  decos: Range<Decoration>[]
): void {
  const source = range.source;
  const lines = source.split("\n");
  const cursorOnCode = selectionIntersects(range.from, range.to, selection, true);
  const firstNewline = source.indexOf("\n");
  const isFenced = /^[ \t]*(`{3,}|~{3,})/.test(source);

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

  // Syntax highlighting — always applied
  if (range.node.value && firstNewline >= 0) {
    const lang = range.node.lang;
    let result: hljs.HighlightResult | null = null;
    try {
      if (lang && hljs.getLanguage(lang)) {
        result = hljs.highlight(range.node.value, { language: lang });
      } else if (lang) {
        result = hljs.highlightAuto(range.node.value);
      }
    } catch { /* ignore hljs errors */ }

    if (result) {
      const contentStart = range.from + firstNewline + 1;
      applyHljsTokens(result._emitter as any, contentStart, decos);
    }
  }
}

function applyHljsTokens(emitter: any, offset: number, decos: Range<Decoration>[]): void {
  if (!emitter || !emitter.rootNode) return;

  function walk(node: any, pos: number): number {
    if (typeof node === "string") {
      return pos + node.length;
    }
    if (node.children) {
      const color = node.scope ? getTokenColor(node.scope) : null;
      const start = pos;
      let cur = pos;
      for (const child of node.children) {
        cur = walk(child, cur);
      }
      if (color && cur > start) {
        decos.push(Decoration.mark({ attributes: { style: "color:" + color } }).range(offset + start, offset + cur));
      }
      return cur;
    }
    return pos;
  }

  let pos = 0;
  for (const child of emitter.rootNode.children) {
    pos = walk(child, pos);
  }
}

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

function buildDecorations(
  doc: string,
  selection: readonly SelectionRange[],
  parser: ParserLike,
  config: NormalizedLivePreviewConfig,
  viewRef: { current: EditorView | null }
): DecorationSet {
  if (!config.enabled) return Decoration.none;

  const ast = parseDocument(parser, doc);
  const ranges = collectLivePreviewRanges(ast, doc, selection);
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
    } else if (range.node.type === "code" && !config.renderers.code) {
      buildCodeBlockDecorations(range as { from: number; to: number; node: Code; source: string }, selection, decos);
    } else if (range.node.type === "image") {
      // Always render as widget — cursor toggle between inline-preview and replace-widget
      // caused vertical layout shifts that made click positions drift after selection change.
      decos.push(
        Decoration.replace({
          widget: createWidget(renderLivePreviewNode(range.node, range.source, config.renderers))
        }).range(range.from, range.to)
      );
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
      if (range.node.type === "heading" || range.node.type === "table" || range.node.type === "list") {
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
        // Block fallback for blockquote/thematicBreak: always render as widget.
        // Cursor-toggle between widget and raw caused block-height shifts
        // (widget margins differ from raw-line height), destabilizing click resolution.
        const isBlock = BLOCK_NODE_TYPES.has(range.node.type);
        // Pre-measure height estimate so CM6's heightmap doesn't start at 0 and
        // jump to the real value on first render (source of post-widget click drift).
        // thematicBreak: 8 padding-top + 1 line + 8 padding-bottom = 17px.
        // blockquote: source line count × 21px + 16px padding.
        let heightHint: number | undefined;
        if (isBlock) {
          if (range.node.type === "thematicBreak") {
            heightHint = 17;
          } else {
            const lineCount = range.source.split("\n").length;
            heightHint = lineCount * 21 + 16;
          }
        }
        decos.push(
          Decoration.replace({
            widget: createWidget(renderLivePreviewNode(range.node, range.source, config.renderers), isBlock, heightHint),
            block: isBlock
          }).range(range.from, range.to)
        );
      }
    }
  }

  return Decoration.set(decos, true);
}

export function createLivePreviewExtension(
  parser: ParserLike,
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

  const field = StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state.doc.toString(), state.selection.ranges, parser, normalized, viewRef);
    },
    update(decos: DecorationSet, tr: Transaction) {
      if (isTableEditing()) {
        return tr.docChanged ? decos.map(tr.changes) : decos;
      }
      if (tr.docChanged || tr.selection) {
        return buildDecorations(tr.state.doc.toString(), tr.state.selection.ranges, parser, normalized, viewRef);
      }
      return decos;
    },
    provide(field) {
      return EditorView.decorations.from(field);
    }
  });

  const viewCapture = EditorView.updateListener.of((update) => {
    viewRef.current = update.view;
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

  return [field, viewCapture, linkHandler, createLivePreviewDiagnostics()];
}
