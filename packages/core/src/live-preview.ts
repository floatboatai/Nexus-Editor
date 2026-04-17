import { StateField, type Extension, type Range, type SelectionRange, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import hljs from "highlight.js";
import type { Code, FootnoteDefinition, FootnoteReference, Heading, List, Root, Table } from "mdast";

import { collectLivePreviewRanges, selectionIntersects } from "./live-preview-ranges";
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

function createWidget(element: HTMLElement, swallowEvents = false): WidgetType {
  return new (class extends WidgetType {
    toDOM() { return element; }
    ignoreEvent() { return swallowEvents; }
  })();
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

  // ── All lines use same base style — identical height in edit & view mode ──
  const BASE = "background:var(--nexus-bg-subtle);font-family:monospace;font-size:0.9em;";
  const codeValue = range.node.value;
  const lang = range.node.lang;
  const langText = lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : "";

  let lineOffset = range.from;
  for (let li = 0; li < lines.length; li++) {
    const lineStart = lineOffset;
    const lineEnd = lineOffset + lines[li].length;
    const isFirstLine = li === 0;
    const isLastLine = li === lines.length - 1;

    // Line style — only border-radius differs between first/last/middle
    const radius = isFirstLine ? "border-radius:4px 4px 0 0;" : isLastLine ? "border-radius:0 0 4px 4px;" : "";
    const relPos = isFirstLine && !cursorOnCode ? "position:relative;" : "";
    const lineAttrs: Record<string, string> = { style: BASE + radius + relPos };
    if (isFirstLine) {
      lineAttrs.role = "code";
      if (lang) lineAttrs["aria-label"] = `Code block: ${lang}`;
    }
    decos.push(Decoration.line({ attributes: lineAttrs }).range(lineStart));

    // Fence lines: muted when editing, invisible when viewing (visibility:hidden
    // keeps line height stable — no heightmap change, no scroll desync)
    if (isFenced && (isFirstLine || isLastLine) && lineEnd > lineStart) {
      decos.push(Decoration.mark({
        attributes: {
          style: cursorOnCode
            ? "color:var(--nexus-text-faint,#bbb);"
            : "visibility:hidden;"
        }
      }).range(lineStart, lineEnd));
    }

    // Language label widget — appended after first fence line text in view mode
    if (isFenced && isFirstLine && !cursorOnCode && langText) {
      decos.push(Decoration.widget({
        widget: new (class extends WidgetType {
          toDOM() {
            const tag = document.createElement("span");
            tag.textContent = langText;
            tag.title = "Click to copy code";
            tag.style.cssText = "position:absolute;right:8px;top:0;" +
              "font-size:12px;color:var(--nexus-text-muted,#888);" +
              "font-family:system-ui,-apple-system,sans-serif;cursor:pointer;user-select:none;" +
              "padding:0 4px;border-radius:3px;transition:background 0.15s,color 0.15s;" +
              "line-height:inherit;";
            tag.addEventListener("mouseenter", () => {
              tag.style.background = "var(--nexus-bg-muted,#e8e8e8)";
              tag.style.color = "var(--nexus-text,#24292e)";
            });
            tag.addEventListener("mouseleave", () => {
              tag.style.background = "transparent";
              tag.style.color = "var(--nexus-text-muted,#888)";
            });
            tag.addEventListener("click", () => {
              navigator.clipboard.writeText(codeValue).then(() => {
                const orig = tag.textContent;
                tag.textContent = "Copied!";
                setTimeout(() => { tag.textContent = orig; }, 1500);
              });
            });
            return tag;
          }
          eq() { return false; }
          ignoreEvent() { return false; }
        })(),
        side: 1
      }).range(lineEnd));
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
        style: "font-family:monospace;font-size:0.9em;background:var(--nexus-bg-muted);padding:1px 4px;border-radius:3px"
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
      const cursorOnImage = selectionIntersects(range.from, range.to, selection);
      if (cursorOnImage) {
        decos.push(Decoration.mark({ attributes: { style: "color: var(--nexus-text-faint)" } }).range(range.from, range.to));
        const preview = document.createElement("span");
        const img = document.createElement("img");
        img.src = range.node.url;
        img.alt = range.node.alt ?? "";
        img.referrerPolicy = "no-referrer";
        img.style.display = "block";
        img.style.maxWidth = "100%";
        preview.appendChild(img);
        decos.push(Decoration.widget({ widget: createWidget(preview), side: 1 }).range(range.to));
      } else {
        decos.push(
          Decoration.replace({
            widget: createWidget(renderLivePreviewNode(range.node, range.source, config.renderers))
          }).range(range.from, range.to)
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
      // Link reference definitions [id]: url — hide via line CSS (not replace, avoids viewport instability)
      const cursorOnDef = selectionIntersects(range.from, range.to, selection);
      if (cursorOnDef) {
        decos.push(Decoration.mark({ attributes: { style: "color:var(--nexus-text-faint);font-size:0.85em" } }).range(range.from, range.to));
      } else {
        const HIDE_LINE = "height:0;padding:0;margin:0;overflow:hidden;font-size:0;line-height:0;min-height:0;";
        // Hide each line of the definition via CSS collapse + text replace
        const defSource = range.source;
        const defLines = defSource.split("\n");
        let lineOffset = range.from;
        for (const defLine of defLines) {
          const lineEnd = lineOffset + defLine.length;
          decos.push(Decoration.line({ attributes: { style: HIDE_LINE } }).range(lineOffset));
          if (lineEnd > lineOffset) {
            decos.push(Decoration.replace({}).range(lineOffset, lineEnd));
          }
          lineOffset = lineEnd + 1;
        }
      }
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
      el.style.cssText = "font-size:0.85em;color:var(--nexus-text-muted);border-top:1px solid var(--nexus-border);padding-top:4px;margin-top:4px;";
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

      // Inline formatting: hide markers via Decoration.replace (cursor is on a
      // different line, so replace is safe and keeps CM6 heightmap accurate).
      const inlineStyle = getInlineMarkerStyle(range.node.type, range.source);
      if (inlineStyle && !config.renderers[range.node.type]) {
        const { openLen, closeLen, style, attrs } = inlineStyle;
        // Hide opening marker
        if (openLen > 0) {
          decos.push(Decoration.replace({}).range(range.from, range.from + openLen));
        }
        // Hide closing marker
        if (closeLen > 0) {
          decos.push(Decoration.replace({}).range(range.to - closeLen, range.to));
        }
        // Apply style to visible text
        const textFrom = range.from + openLen;
        const textTo = range.to - closeLen;
        if (textTo > textFrom) {
          decos.push(Decoration.mark({ attributes: { style, ...attrs } }).range(textFrom, textTo));
        }
      } else {
        const isBlock = BLOCK_NODE_TYPES.has(range.node.type);
        decos.push(
          Decoration.replace({
            widget: createWidget(renderLivePreviewNode(range.node, range.source, config.renderers), isBlock),
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

  return [field, viewCapture, linkHandler];
}
