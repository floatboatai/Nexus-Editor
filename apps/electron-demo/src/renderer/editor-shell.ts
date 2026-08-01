import {
  createEditor,
  createWikilinksPlugin,
  type EditorAPI,
  type LivePreviewRenderContext,
} from "@floatboat/nexus-core";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import { createToolbarPlugin, createToolbarUI, type ToolbarUI } from "@floatboat/nexus-plugin-toolbar";
import { createSearchPlugin } from "@floatboat/nexus-plugin-search";
import { createSlashMenuUI, type SlashMenuUI } from "@floatboat/nexus-plugin-slash";
import {
  attachWordCountPlugin,
  createWordCountPlugin,
  type WordCountPlugin
} from "@floatboat/nexus-plugin-wordcount";
import type { AppState } from "./state";
import { type EditorSettings, settingsToTheme } from "./settings";

// Parse Obsidian-style size specifier from the alt text: `alt|width` or
// `alt|widthxheight`. Returns { alt, width, height } with the size stripped
// from the label. Numbers only; non-numeric after `|` stays in the alt.
function parseImageSize(raw: string): { alt: string; width?: number; height?: number } {
  if (!raw) return { alt: "" };
  const pipe = raw.lastIndexOf("|");
  if (pipe < 0) return { alt: raw };
  const size = raw.slice(pipe + 1).trim();
  const wh = size.match(/^(\d+)(?:x(\d+))?$/);
  if (!wh) return { alt: raw };
  return {
    alt: raw.slice(0, pipe).trim(),
    width: Number(wh[1]),
    height: wh[2] ? Number(wh[2]) : undefined,
  };
}

// Rewrite relative image URLs to the custom nexus-vault:// scheme registered
// in the main process. Absolute URLs (http, https, data, etc) pass through.
function resolveImageSrc(
  url: string,
  activeFile: string | null,
  vaultRoot: string | null
): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) return url;

  // Markdown image URLs are percent-encoded (paths may contain spaces). Decode
  // to a real filesystem path before resolving, then re-encode for the URL.
  let raw = url;
  try {
    raw = decodeURI(url);
  } catch { /* malformed escape — use as-is */ }
  raw = raw.replace(/\\/g, "/");

  let absNorm: string;
  if (raw.startsWith("/")) {
    absNorm = normalizePath(raw);
  } else {
    if (!activeFile) return url;
    const normActive = activeFile.replace(/\\/g, "/");
    const lastSlash = normActive.lastIndexOf("/");
    const activeDir = lastSlash >= 0 ? normActive.slice(0, lastSlash) : "";
    absNorm = normalizePath(activeDir + "/" + raw);
  }

  if (!vaultRoot) {
    return `nexus-vault://local${encodeURI(absNorm)}`;
  }

  const normVault = vaultRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  if (absNorm !== normVault && !absNorm.startsWith(normVault + "/")) {
    return `nexus-vault://local${encodeURI(absNorm)}`;
  }
  const rel = absNorm.slice(normVault.length + 1);
  const encoded = rel.split("/").map(encodeURIComponent).join("/");
  return `nexus-vault://vault/${encoded}`;
}

/** Collapse `.` / `..` segments, preserving a leading slash. */
function normalizePath(input: string): string {
  const parts: string[] = [];
  for (const p of input.split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") parts.pop();
    else parts.push(p);
  }
  return (input.startsWith("/") ? "/" : "") + parts.join("/");
}

/**
 * Rewrite the `|width` suffix inside the image's alt at [from, to).
 * Returns the new end offset, or null when the range isn't an image.
 */
function writeImageWidth(
  editor: EditorAPI,
  from: number,
  to: number,
  width: number
): number | null {
  const doc = editor.getDocument();
  const src = doc.slice(from, to);
  const m = src.match(/^!\[([^\]]*)\](\([\s\S]*\))$/);
  if (!m) return null;

  const rawAlt = m[1];
  const pipe = rawAlt.lastIndexOf("|");
  const hasSize = pipe >= 0 && /^\d+(x\d+)?$/.test(rawAlt.slice(pipe + 1).trim());
  const pureAlt = hasSize ? rawAlt.slice(0, pipe).trim() : rawAlt;
  const nextAlt = pureAlt ? `${pureAlt}|${width}` : `|${width}`;
  const nextSrc = `![${nextAlt}]${m[2]}`;
  if (nextSrc === src) return to;

  editor.replaceRange(from, to, nextSrc, { anchor: from + nextSrc.length });
  return from + nextSrc.length;
}

export interface EditorShellOptions {
  container: HTMLElement;
  state: AppState;
  settings: EditorSettings;
  onStateChange: () => void;
  /** Called when the user clicks a wiki link. */
  onWikilinkNavigate?(target: string, opts: { unresolved: boolean }): void;
  /** Resolves a wiki-link name to an absolute target path; null = unresolved. */
  resolveWikilink?(name: string): string | null;
  /** Returns autocomplete candidates for the query after `[[`. */
  suggestWikilinks?(query: string): string[];
}

export interface EditorShell {
  editor: EditorAPI;
  toolbar: ToolbarUI;
  /** The floating slash-command menu mounted on document.body. */
  slashMenu: SlashMenuUI;
  /** Markdown-aware word-count plugin (handle + status bar). */
  wordcount: WordCountPlugin;
  applySettings(settings: EditorSettings): void;
  loadDocument(content: string): void;
  destroy(): void;
}

export function createEditorShell(options: EditorShellOptions): EditorShell {
  const {
    container,
    state,
    settings,
    onStateChange,
    onWikilinkNavigate,
    resolveWikilink,
    suggestWikilinks,
  } = options;

  // Forward ref so the image renderer (built BEFORE createEditor returns)
  // can dispatch selection changes through the editor API after it exists.
  const editorRef: { current: EditorAPI | null } = { current: null };

  // Image selection lives outside the document, so CM6 won't rebuild the widget
  // when it changes — the click handler toggles the live DOM directly. The
  // offset is still tracked here so a rebuild triggered by something else (e.g.
  // writing back `|width`) can restore the selected look. `from` is stable
  // across our own rewrites because they only ever change the alt's length.
  let selectedImageFrom: number | null = null;
  let deselectSelectedImage: (() => void) | null = null;
  const selectImage = (from: number, deselect: () => void) => {
    if (deselectSelectedImage && deselectSelectedImage !== deselect) deselectSelectedImage();
    selectedImageFrom = from;
    deselectSelectedImage = deselect;
  };
  const clearImageSelection = () => {
    deselectSelectedImage?.();
    selectedImageFrom = null;
    deselectSelectedImage = null;
  };

  const wikilinksPlugin = createWikilinksPlugin({
    resolve: resolveWikilink ? (name) => resolveWikilink(name) : undefined,
    onNavigate: onWikilinkNavigate,
    suggest: suggestWikilinks ? (q) => suggestWikilinks(q) : undefined,
  });

  // The wordcount plugin reads `editor.getAst()` on each (debounced)
  // change — no double parsing — and mounts an ARIA-live status bar in
  // the editor container's footer. Bound to the editor instance via
  // `attachWordCountPlugin` once `createEditor` returns.
  const wordcount = createWordCountPlugin({
    statusBar: { container, classPrefix: "nexus-wordcount" },
  });

  // No more parser worker. Live-preview drives off `syntaxTree(state)` from
  // @codemirror/lang-markdown (incremental, intrinsic to EditorState), and
  // editor.ts builds mdast for `getAst()` / `change` events synchronously
  // via the Lezer→mdast adapter — no off-thread parse, no remark/micromark
  // hot path.

  const editor = createEditor({
    container,
    initialValue: state.content,
    // Debounce the onChange pipeline — each keystroke would otherwise trigger
    // a full mdast walk AND linkIndex.updateFile (which rebuilds all reverse
    // edges across the vault). 150ms is imperceptible for typing UX but
    // batches bursts of keystrokes into one parse.
    parseDelayMs: 150,
    // Multi-cursor editing: Alt-click adds a cursor, Mod-d selects the next
    // occurrence, Mod-Alt-ArrowUp/Down stacks cursors (ROADMAP #6).
    multiCursor: true,
    plugins: [
      createGfmPreset(),
      createHistoryPlugin(),
      createToolbarPlugin(),
      createSearchPlugin(),
      wikilinksPlugin,
      wordcount,
    ],
    livePreview: settings.livePreview
      ? {
          enabled: true,
          renderers: {
            image: (ctx: LivePreviewRenderContext) => {
              const node = ctx.node as {
                type: "image";
                url: string;
                alt?: string;
                title?: string;
              };
              const nodeFrom = ctx.from;
              const nodeTo = ctx.to;
              const { alt, width, height } = parseImageSize(node.alt ?? "");

              const wrapper = document.createElement("span");
              wrapper.className = "nexus-image";
              wrapper.style.cssText =
                "display:inline-block;position:relative;vertical-align:top;max-width:100%;" +
                "border:1px solid transparent;border-radius:6px;padding:2px;transition:border-color .15s;";
              wrapper.setAttribute("data-live-preview-image", node.url);

              const img = document.createElement("img");
              img.src = resolveImageSrc(node.url, state.activeFile, state.vaultPath);
              img.alt = alt;
              if (node.title) img.title = node.title;
              img.referrerPolicy = "no-referrer";
              img.style.display = "block";
              img.style.maxWidth = "100%";
              img.style.height = "auto";
              img.style.borderRadius = "4px";
              if (typeof width === "number") img.style.width = width + "px";
              if (typeof height === "number") img.style.height = height + "px";

              // Top-right action: jump cursor to image source.
              const srcBtn = document.createElement("button");
              srcBtn.type = "button";
              srcBtn.title = "View source";
              srcBtn.setAttribute("aria-label", "View image markdown source");
              srcBtn.textContent = "</>";
              srcBtn.style.cssText = [
                "position:absolute",
                "top:6px",
                "right:6px",
                "padding:2px 6px",
                "font-size:11px",
                "font-family:ui-monospace,monospace",
                "line-height:1.4",
                "background:rgba(255,255,255,0.95)",
                "border:1px solid var(--nexus-border-subtle,#ddd)",
                "border-radius:4px",
                "color:var(--nexus-text,#333)",
                "cursor:pointer",
                "opacity:0",
                "z-index:2",
                "user-select:none",
                "transition:opacity .15s",
                "box-shadow:0 1px 2px rgba(0,0,0,0.08)",
              ].join(";") + ";";
              srcBtn.addEventListener("mousedown", (e) => { e.stopPropagation(); }, true);
              srcBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const ed = editorRef.current;
                if (!ed) return;
                ed.setSelection(nodeFrom);
                ed.focus();
              });
              // NOTE: clicks on the image body intentionally do NOT enter edit
              // mode. Only the top-right </> button toggles source.

              // Bottom-right resize handle — drag to resize; on mouseup writes
              // back `|width` into the image's alt in markdown.
              const resizeDot = document.createElement("span");
              resizeDot.title = "Drag to resize";
              resizeDot.style.cssText = [
                "position:absolute",
                "bottom:2px",
                "right:2px",
                "width:10px",
                "height:10px",
                "border-radius:50%",
                "background:var(--nexus-accent,#7c6cf4)",
                "opacity:0",
                "z-index:2",
                "cursor:nwse-resize",
                "transition:opacity .15s",
              ].join(";") + ";";

              let dragging = false;
              let startX = 0;
              let startW = 0;
              const onMove = (e: MouseEvent) => {
                if (!dragging) return;
                const newW = Math.max(40, Math.round(startW + (e.clientX - startX)));
                img.style.width = newW + "px";
                img.style.height = "auto";
              };
              const onUp = (e: MouseEvent) => {
                if (!dragging) return;
                dragging = false;
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                const finalW = Math.max(40, Math.round(startW + (e.clientX - startX)));
                const ed = editorRef.current;
                if (!ed) return;
                writeImageWidth(ed, nodeFrom, nodeTo, finalW);
              };
              resizeDot.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                dragging = true;
                startX = e.clientX;
                startW = img.getBoundingClientRect().width;
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              });

              let selected = false;
              const showChrome = () => {
                wrapper.style.borderColor = "var(--nexus-accent,#7c6cf4)";
                srcBtn.style.opacity = "1";
                resizeDot.style.opacity = "1";
              };
              const hideChrome = () => {
                if (dragging || selected) return;
                wrapper.style.borderColor = "transparent";
                srcBtn.style.opacity = "0";
                resizeDot.style.opacity = "0";
              };
              wrapper.addEventListener("mouseenter", showChrome);
              wrapper.addEventListener("mouseleave", hideChrome);

              // Bottom-left action bar, revealed by clicking the image. Scale
              // presets are a fraction of the image's intrinsic width; the
              // trash button drops the image from the document.
              const actionBar = document.createElement("span");
              actionBar.style.cssText = [
                "position:absolute",
                "bottom:6px",
                "left:6px",
                "display:none",
                "align-items:center",
                "gap:2px",
                "padding:2px",
                "background:rgba(255,255,255,0.97)",
                "border:1px solid var(--nexus-border-subtle,#ddd)",
                "border-radius:6px",
                "z-index:3",
                "user-select:none",
                "box-shadow:0 1px 4px rgba(0,0,0,0.12)",
              ].join(";") + ";";
              // CM6 resolves a click into a cursor position unless the press is
              // stopped before it reaches the editor's own handler.
              actionBar.addEventListener("mousedown", (e) => { e.stopPropagation(); }, true);

              const barButton = (label: string, title: string): HTMLButtonElement => {
                const b = document.createElement("button");
                b.type = "button";
                b.textContent = label;
                b.title = title;
                b.setAttribute("aria-label", title);
                b.style.cssText = [
                  "padding:2px 6px",
                  "font-size:11px",
                  "font-family:system-ui,-apple-system,sans-serif",
                  "line-height:1.5",
                  "background:transparent",
                  "border:none",
                  "border-radius:4px",
                  "color:var(--nexus-text,#333)",
                  "cursor:pointer",
                ].join(";") + ";";
                b.addEventListener("mouseenter", () => {
                  b.style.background = "var(--nexus-bg-muted,#f0f0f0)";
                });
                b.addEventListener("mouseleave", () => {
                  b.style.background = "transparent";
                });
                actionBar.appendChild(b);
                return b;
              };

              for (const pct of [30, 50, 100]) {
                const btn = barButton(`${pct}%`, `Scale to ${pct}% of original width`);
                btn.addEventListener("click", (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const ed = editorRef.current;
                  if (!ed) return;
                  // naturalWidth is 0 until the bitmap decodes; fall back to the
                  // laid-out width so an early click still does something sane.
                  const base = img.naturalWidth || Math.round(img.getBoundingClientRect().width);
                  if (!base) return;
                  writeImageWidth(ed, nodeFrom, nodeTo, Math.max(40, Math.round(base * pct / 100)));
                });
              }

              const barSep = document.createElement("span");
              barSep.style.cssText =
                "width:1px;height:14px;margin:0 2px;background:var(--nexus-border-subtle,#ddd);";
              actionBar.appendChild(barSep);

              const delBtn = barButton("🗑", "Delete image");
              delBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const ed = editorRef.current;
                if (!ed) return;
                clearImageSelection();
                // Swallow the newline the insert flow appends, so removing an
                // image doesn't leave a blank line behind.
                const doc = ed.getDocument();
                const end = doc[nodeTo] === "\n" ? nodeTo + 1 : nodeTo;
                ed.replaceRange(nodeFrom, end, "", { anchor: nodeFrom });
                ed.focus();
              });

              // Self-cleaning global listeners: the widget has no destroy hook,
              // so every dismissal path drops them once the wrapper is detached.
              let onDocMouseDown: ((e: MouseEvent) => void) | null = null;
              let onDocKeyDown: ((e: KeyboardEvent) => void) | null = null;
              const unbindDismiss = () => {
                if (onDocMouseDown) document.removeEventListener("mousedown", onDocMouseDown, true);
                if (onDocKeyDown) document.removeEventListener("keydown", onDocKeyDown, true);
                onDocMouseDown = null;
                onDocKeyDown = null;
              };
              const bindDismiss = () => {
                if (onDocMouseDown) return;
                onDocMouseDown = (ev: MouseEvent) => {
                  if (!wrapper.isConnected) { unbindDismiss(); return; }
                  if (wrapper.contains(ev.target as Node)) return;
                  clearImageSelection();
                };
                onDocKeyDown = (ev: KeyboardEvent) => {
                  if (!wrapper.isConnected) { unbindDismiss(); return; }
                  if (ev.key === "Escape") clearImageSelection();
                };
                document.addEventListener("mousedown", onDocMouseDown, true);
                document.addEventListener("keydown", onDocKeyDown, true);
              };
              const deselect = () => {
                unbindDismiss();
                selected = false;
                actionBar.style.display = "none";
                hideChrome();
              };
              const select = () => {
                selectImage(nodeFrom, deselect);
                selected = true;
                actionBar.style.display = "inline-flex";
                showChrome();
                bindDismiss();
              };

              img.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!selected) select();
              });

              // A `|width` rewrite rebuilds this DOM; re-assert the selected
              // look so the bar survives consecutive scale clicks.
              if (selectedImageFrom === nodeFrom) select();

              // Obsidian-style: no visible caption. alt goes on the img (native
              // browser tooltip + a11y). Raw markdown source `![alt|size](url)`
              // is what reveals on cursor-on-image or </> click.
              if (alt) img.title = alt;

              img.addEventListener("error", () => {
                const err = document.createElement("span");
                err.textContent = `⚠ image not found: ${node.url}`;
                err.style.cssText =
                  "display:block;padding:8px 12px;font-size:12px;color:var(--nexus-hl-deletion,#c33);" +
                  "font-family:monospace;background:var(--nexus-bg-subtle);border-radius:4px;";
                img.replaceWith(err);
              });

              wrapper.appendChild(img);
              wrapper.appendChild(srcBtn);
              wrapper.appendChild(resizeDot);
              wrapper.appendChild(actionBar);
              return wrapper;
            },
          },
        }
      : false,
    theme: settingsToTheme(settings),
    tabSize: settings.tabSize,
    direction: settings.direction,
    indentGuides: settings.indentGuides,
    onChange(doc) {
      state.content = doc;
      state.dirty = true;
      // Keep the link index in sync with the buffer so the backlinks panel
      // reacts immediately when the user types `[[...]]`.
      if (state.linkIndex && state.activeFile) {
        state.linkIndex.updateFile(state.activeFile, doc);
      }
      onStateChange();
    },
  });

  editorRef.current = editor;

  const toolbar = createToolbarUI(editor, {
    onInsertImage: (ed) => {
      const activeFilePath = state.activeFile ?? "";
      window.nexusDemo.pickImage(activeFilePath).then((result) => {
        if (!result) return;
        const doc = ed.getDocument();
        const { anchor, head } = ed.getSelection();
        const from = Math.min(anchor, head);
        const to = Math.max(anchor, head);
        const selected = doc.slice(from, to);
        const alt = selected || result.fileName.replace(/\.[^.]+$/, "");
        // Trailing newline moves the caret out of the image's source range.
        // Live preview only collapses `![](...)` into an image widget when the
        // selection does NOT intersect it (inclusive of its end offset), so a
        // caret parked right after `)` would keep the raw markdown visible.
        const md = `![${alt}](${result.relPath})\n`;
        ed.replaceRange(from, to, md, { anchor: from + md.length });
        ed.focus();
      });
    },
  });
  container.insertBefore(toolbar.element, container.firstChild);

  // The slash menu owns its own DOM root mounted on document.body so
  // it can overflow the editor's clipping context (panels, scroll
  // ancestors). Its lifecycle is tied to the shell — destroyed below.
  const slashMenu = createSlashMenuUI(editor);

  // Bind the wordcount plugin now that the editor is fully constructed.
  // The plugin's status-bar widget mounts on its first emission (next
  // microtask), so it's already wired by the time the user sees the
  // first paint.
  attachWordCountPlugin(wordcount, editor);

  return {
    editor,
    toolbar,
    slashMenu,
    wordcount,
    applySettings(next: EditorSettings) {
      editor.setTheme(settingsToTheme(next));
    },
    loadDocument(content: string) {
      // Load from disk is NOT a user edit — use silent mode to skip the
      // onChange pipeline (avoids redundant parse + link-index rebuild on
      // every file open). Caller owns state.content / dirty below and the
      // link index is re-seeded as part of vault open.
      const t0 = performance.now();
      editor.setDocument(content, { silent: true });
      const t1 = performance.now();
      state.content = content;
      state.dirty = false;
      onStateChange();
      // Surfaced here because editor.setDocument triggers the whole CM6
      // decoration rebuild chain (live-preview buildDecorations), so this
      // number is the practical "time to render the opened file".
      // eslint-disable-next-line no-console
      console.log("%c[perf]", "color:#0aa;font-weight:bold", "editor.setDocument",
        `${(t1 - t0).toFixed(1)}ms`, { bytes: content.length });
    },
    destroy() {
      wordcount.destroy();
      slashMenu.destroy();
      toolbar.destroy();
      editor.destroy();
    },
  };
}
