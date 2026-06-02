/**
 * live-preview-sync.ts — Bidirectional editor ↔ preview sync scroll
 *
 * Implements precise position‑based sync (方案C):
 * 1. mdast‑to‑preview HTML renderer that tags every block with
 *    `data-pos-from` / `data-pos-to` (source offset).
 * 2. `createSyncScroll` — bidirectional scroll mirroring with
 *    anti‑feedback lock and requestAnimationFrame throttling.
 */

import { EditorView } from "@codemirror/view";
import type { Root } from "mdast";

// ── Public Types ──────────────────────────────────────────────────────

export interface SyncScrollOptions {
  /** The CodeMirror EditorView of the source editor. */
  editor: EditorView;
  /** Scrollable container that holds the rendered preview HTML. */
  previewContainer: HTMLElement;
  /**
   * Called when the preview content needs to be updated.
   * Must return an HTML string with `.preview-block` elements
   * carrying `data-pos-from` / `data-pos-to` attributes.
   */
  renderPreview(): string;
  /** Throttle interval in ms (default 50). */
  throttleMs?: number;
  /**
   * When true, do an initial sync immediately (editor → preview).
   * Default: true.
   */
  initialSync?: boolean;
}

export interface SyncScrollController {
  /** Re‑render the preview panel from the current source. */
  refreshPreview(): void;
  /** Remove all event listeners and clean up. */
  destroy(): void;
  /** Enable / disable sync (default true). */
  setEnabled(on: boolean): void;
}

// ── Default preview styles (injected once per container) ──────────────

const PREVIEW_STYLES_ID = "nexus-preview-styles";

function injectPreviewStyles(container: HTMLElement): void {
  if (container.querySelector(`#${PREVIEW_STYLES_ID}`)) return;
  const style = document.createElement("style");
  style.id = PREVIEW_STYLES_ID;
  style.textContent = [
    ".nexus-preview{padding:16px 24px;line-height:1.6;overflow-wrap:break-word;font-family:system-ui,sans-serif}",
    ".nexus-preview h1,.nexus-preview h2,.nexus-preview h3,.nexus-preview h4,.nexus-preview h5,.nexus-preview h6{margin:1em 0 .5em 0;line-height:1.3;font-weight:600}",
    ".nexus-preview h1{font-size:1.8em;border-bottom:1px solid var(--nexus-border-subtle,#e4e7eb);padding-bottom:.3em}",
    ".nexus-preview h2{font-size:1.5em;border-bottom:1px solid var(--nexus-border-subtle,#e4e7eb);padding-bottom:.25em}",
    ".nexus-preview h3{font-size:1.25em}",
    ".nexus-preview p{margin:.5em 0}",
    ".nexus-preview pre{background:var(--nexus-bg-subtle,#f6f8fa);border-radius:6px;padding:12px 16px;overflow-x:auto;font-family:monospace;font-size:.9em}",
    ".nexus-preview code{background:var(--nexus-bg-subtle,#f6f8fa);border-radius:3px;padding:2px 4px;font-family:monospace;font-size:.9em}",
    ".nexus-preview pre code{background:0;padding:0;border-radius:0}",
    ".nexus-preview blockquote{margin:.5em 0;padding:0 1em;border-left:3px solid var(--nexus-border,#d0d7de);color:var(--nexus-text-muted,#6e7681)}",
    ".nexus-preview ul,.nexus-preview ol{margin:.5em 0;padding-left:2em}",
    ".nexus-preview li{margin:.25em 0}",
    ".nexus-preview li.task-item{display:flex;align-items:baseline;gap:4px}",
    ".nexus-preview li.task-item .preview-block{display:inline;margin:0}",
    ".nexus-preview li.task-item .preview-block p{display:inline;margin:0}",
    ".nexus-preview table{border-collapse:collapse;margin:.5em 0;width:100%}",
    ".nexus-preview th,.nexus-preview td{border:1px solid var(--nexus-border-subtle,#d0d7de);padding:6px 10px;text-align:left}",
    ".nexus-preview th{background:var(--nexus-bg-subtle,#f6f8fa);font-weight:600}",
    ".nexus-preview hr{border:0;border-top:1px solid var(--nexus-border-subtle,#d0d7de);margin:1.5em 0}",
    ".nexus-preview a{color:var(--nexus-accent,#0969da);text-decoration:none}",
    ".nexus-preview a:hover{text-decoration:underline}",
    ".nexus-preview img{max-width:100%;height:auto;border-radius:4px}",
    ".nexus-preview del{color:var(--nexus-text-muted,#6e7681)}",
    ".nexus-preview .footnote-definition{margin:.5em 0;font-size:.9em;color:var(--nexus-text-muted,#6e7681)}",
    ".nexus-preview .footnote-definition .footnote-ref{font-weight:600;margin-right:.5em}",
  ].join("");
  container.appendChild(style);
}

// ── Sync Scroll ───────────────────────────────────────────────────────

export function createSyncScroll(opts: SyncScrollOptions): SyncScrollController {
  const { editor, previewContainer, renderPreview, initialSync = true } = opts;
  let enabled = true;
  let destroyed = false;
  let rafId = 0;
  let lastEditorOffset = -1;
  let lastPreviewOffset = -1;
  let lastPreviewHTML = "";

  /**
   * One-shot suppression: after we programmatically scroll one side, we set
   * the corresponding flag so the NEXT scroll event on that side is ignored.
   * This breaks the editor↔preview feedback loop.
   */
  let suppressEditorScroll = false;
  let suppressPreviewScroll = false;

  injectPreviewStyles(previewContainer);
  previewContainer.classList.add("nexus-preview");

  // ── Editor → Preview ──────────────────────────────────────────────

  function onEditorScroll(): void {
    if (!enabled || destroyed) return;
    if (suppressEditorScroll) { suppressEditorScroll = false; return; }

    const offset = topVisibleEditorOffset();
    if (offset < 0 || offset === lastEditorOffset) return;
    lastEditorOffset = offset;
    schedulePreviewSync();
  }

  function schedulePreviewSync(): void {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      if (destroyed) return;
      doSyncPreview();
    });
  }

  function doSyncPreview(): void {
    if (!enabled || destroyed) return;
    const offset = lastEditorOffset;
    if (offset < 0) return;

    const blocks = Array.from(previewContainer.querySelectorAll<HTMLElement>(".preview-block"));
    if (!blocks.length) return;

    // Binary search: find the last block with data-pos-from ≤ offset
    let lo = 0;
    let hi = blocks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const from = parseInt(blocks[mid].dataset.posFrom ?? "-1", 10);
      if (from <= offset) lo = mid + 1;
      else hi = mid;
    }
    const target = lo > 0 ? blocks[lo - 1] : null;
    if (!target) return;

    // Don't scroll if the preview is already showing this block near the top
    const cr = previewContainer.getBoundingClientRect();
    const tr = target.getBoundingClientRect();
    const currentGap = tr.top - cr.top;
    if (currentGap >= -4 && currentGap < 80) return; // already close enough

    suppressPreviewScroll = true;
    previewContainer.scrollTop = tr.top - cr.top + previewContainer.scrollTop - 16;
  }

  // ── Preview → Editor ──────────────────────────────────────────────

  function onPreviewScroll(): void {
    if (!enabled || destroyed) return;
    if (suppressPreviewScroll) { suppressPreviewScroll = false; return; }

    const offset = topVisiblePreviewOffset();
    if (offset < 0 || offset === lastPreviewOffset) return;
    lastPreviewOffset = offset;
    scheduleEditorSync();
  }

  function scheduleEditorSync(): void {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      if (destroyed) return;
      doSyncEditor();
    });
  }

  function doSyncEditor(): void {
    if (!enabled || destroyed) return;
    const offset = lastPreviewOffset;
    if (offset < 0) return;

    // Don't scroll if the editor is already showing this offset near the top
    const currentEditorTop = topVisibleEditorOffset();
    if (currentEditorTop >= 0 && Math.abs(offset - currentEditorTop) < 20) return;

    const docLen = editor.state.doc.length;
    const clamped = Math.min(Math.max(0, offset), docLen);
    const line = editor.state.doc.lineAt(clamped);

    suppressEditorScroll = true;
    editor.dispatch({
      effects: EditorView.scrollIntoView(line.from, {
        y: "start",
        yMargin: 50,
      }),
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────

  function topVisibleEditorOffset(): number {
    const rect = editor.scrollDOM.getBoundingClientRect();
    const y = rect.top + 1;
    const pos = editor.posAtCoords({ x: editor.scrollDOM.clientLeft, y });
    return pos !== null ? pos : -1;
  }

  function topVisiblePreviewOffset(): number {
    const scrollTop = previewContainer.scrollTop;
    if (scrollTop < 2) return 0;

    const blocks = Array.from(previewContainer.querySelectorAll<HTMLElement>(".preview-block"));
    let bestOffset = 0;
    for (const block of blocks) {
      const cr = previewContainer.getBoundingClientRect();
      const br = block.getBoundingClientRect();
      const blockVisualTop = br.top - cr.top;
      if (blockVisualTop >= -4) {
        bestOffset = parseInt(block.dataset.posFrom ?? "0", 10);
        break;
      }
    }
    return bestOffset;
  }

  // ── Wire up ───────────────────────────────────────────────────────

  editor.scrollDOM.addEventListener("scroll", onEditorScroll, { passive: true });
  previewContainer.addEventListener("scroll", onPreviewScroll, { passive: true });

  if (initialSync) {
    requestAnimationFrame(() => {
      if (destroyed) return;
      const pos = editor.state.selection.main.head;
      lastEditorOffset = pos;
      doSyncPreview();
    });
  }

  return {
    refreshPreview() {
      if (destroyed) return;
      const html = renderPreview();
      if (html === lastPreviewHTML) return;
      lastPreviewHTML = html;
      // Save and restore scroll position. Clamp to avoid bogus scroll events
      // when the re-rendered content is shorter than the previous content.
      const maxScroll = previewContainer.scrollHeight - previewContainer.clientHeight;
      const scrollPos = Math.min(previewContainer.scrollTop, maxScroll);
      previewContainer.innerHTML = html;
      previewContainer.classList.add("nexus-preview");
      injectPreviewStyles(previewContainer);
      previewContainer.scrollTop = Math.min(
        scrollPos,
        previewContainer.scrollHeight - previewContainer.clientHeight
      );
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      enabled = false;
      cancelAnimationFrame(rafId);
      editor.scrollDOM.removeEventListener("scroll", onEditorScroll);
      previewContainer.removeEventListener("scroll", onPreviewScroll);
    },

    setEnabled(on: boolean) {
      enabled = on;
    },
  };
}

// ── mdast → Preview HTML (with position metadata) ────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */

function renderInline(node: any): string {
  switch (node.type) {
    case "text":
      return esc(node.value);
    case "strong":
      return `<strong>${renderInlineNodes(node.children)}</strong>`;
    case "emphasis":
      return `<em>${renderInlineNodes(node.children)}</em>`;
    case "delete":
      return `<del>${renderInlineNodes(node.children)}</del>`;
    case "inlineCode":
      return `<code>${esc(node.value)}</code>`;
    case "link":
      return `<a href="${esc(node.url)}"${node.title ? ` title="${esc(node.title)}"` : ""}>${
        renderInlineNodes(node.children)
      }</a>`;
    case "image":
      return `<img src="${esc(node.url)}" alt="${esc(node.alt ?? "")}"${
        node.title ? ` title="${esc(node.title)}"` : ""
      } style="max-width:100%" />`;
    case "footnoteReference":
      return `<sup class="footnote-ref"><a href="#fn-${esc(node.identifier)}">${
        esc(node.label ?? node.identifier)
      }</a></sup>`;
    case "html":
      return node.value;
    default: {
      if (typeof node.value === "string") return esc(node.value);
      if (Array.isArray(node.children)) return renderInlineNodes(node.children);
      return "";
    }
  }
}

function renderInlineNodes(nodes: any[]): string {
  return (nodes ?? []).map(renderInline).join("");
}

function renderBlock(node: any): string {
  const pf = node.position?.start.offset ?? -1;
  const pt = node.position?.end.offset ?? -1;
  const wr = (h: string) =>
    `<div class="preview-block" data-pos-from="${pf}" data-pos-to="${pt}">${h}</div>`;

  switch (node.type) {
    case "heading": {
      const tag = `h${Math.min(6, Math.max(1, node.depth))}`;
      return wr(`<${tag}>${renderInlineNodes(node.children)}</${tag}>`);
    }
    case "paragraph":
      return wr(`<p>${renderInlineNodes(node.children)}</p>`);
    case "code":
      return wr(`<pre${node.lang ? ` data-language="${esc(node.lang)}"` : ""}><code${
        node.lang ? ` class="language-${esc(node.lang)}"` : ""
      }>${esc(node.value)}</code></pre>`);
    case "list": {
      const tag = node.ordered ? "ol" : "ul";
      const startAttr =
        node.ordered && (node.start ?? 1) !== 1 ? ` start="${node.start}"` : "";
      const items = (node.children ?? [])
        .map((li: any) => {
          const checkbox =
            li.checked !== null && li.checked !== undefined
              ? `<input type="checkbox"${li.checked ? " checked" : ""} style="margin:0 4px 0 0;vertical-align:middle" disabled />`
              : "";
          const cls = li.checked !== null && li.checked !== undefined ? ' class="task-item"' : "";
          return `<li${cls}>${checkbox}${(li.children ?? []).map(renderBlock).join("")}</li>`;
        })
        .join("");
      return wr(`<${tag}${startAttr}>${items}</${tag}>`);
    }
    case "blockquote": {
      const content = (node.children ?? []).map(renderBlock).join("");
      return wr(`<blockquote>${content}</blockquote>`);
    }
    case "thematicBreak":
      return wr("<hr />");
    case "table": {
      const rows = node.children ?? [];
      let html = "<table>";
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const cellTag = i === 0 ? "th" : "td";
        const cells = (row.children ?? [])
          .map(
            (cell: any) =>
              `<${cellTag}>${renderInlineNodes(cell.children)}</${cellTag}>`
          )
          .join("");
        html += `<tr>${cells}</tr>`;
      }
      html += "</table>";
      return wr(html);
    }
    case "html":
      return wr(node.value);
    case "definition":
      return "";
    case "footnoteDefinition":
      return wr(
        `<div class="footnote-definition">` +
          `<sup class="footnote-ref">${esc(node.identifier)}.</sup> ` +
          `${(node.children ?? []).map(renderBlock).join("")}` +
        `</div>`
      );
    default: {
      if (Array.isArray(node.children)) {
        return wr(
          `<div class="unknown-block">${node.children.map(renderBlock).join("")}</div>`
        );
      }
      if (typeof node.value === "string") return wr(`<p>${esc(node.value)}</p>`);
      return "";
    }
  }
}

/**
 * Render a full mdast `Root` into an HTML fragment suitable for a preview panel.
 *
 * Every block-level node is wrapped in a `<div class="preview-block">`
 * with `data-pos-from` / `data-pos-to` attributes that carry the node's
 * source offset range — used by `createSyncScroll` for position‑based sync.
 */
export function mdastToPreviewHtml(ast: Root): string {
  return (ast.children as any[])
    .map((child) => renderBlock(child))
    .filter(Boolean)
    .join("\n");
}
