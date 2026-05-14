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
  if (!activeFile || !vaultRoot) return url;

  const sep = activeFile.includes("\\") && !activeFile.includes("/") ? "\\" : "/";
  const normActive = activeFile.replace(/\\/g, "/");
  const normVault = vaultRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const lastSlash = normActive.lastIndexOf("/");
  const activeDir = lastSlash >= 0 ? normActive.slice(0, lastSlash) : "";
  const joined = activeDir + "/" + url.replace(/\\/g, "/");

  const parts: string[] = [];
  for (const p of joined.split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") parts.pop();
    else parts.push(p);
  }
  const absNorm = (joined.startsWith("/") ? "/" : "") + parts.join("/");

  if (absNorm !== normVault && !absNorm.startsWith(normVault + "/")) return url;
  const rel = absNorm.slice(normVault.length + 1);
  const encoded = rel.split("/").map(encodeURIComponent).join("/");
  return `nexus-vault://vault/${encoded}`;
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

  const wikilinksPlugin = createWikilinksPlugin({
    resolve: resolveWikilink ? (name) => resolveWikilink(name) : undefined,
    onNavigate: onWikilinkNavigate,
    suggest: suggestWikilinks ? (q) => suggestWikilinks(q) : undefined,
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
    plugins: [
      createGfmPreset(),
      createHistoryPlugin(),
      createToolbarPlugin(),
      createSearchPlugin(),
      wikilinksPlugin,
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

                const doc = ed.getDocument();
                const src = doc.slice(nodeFrom, nodeTo);
                const m = src.match(/^!\[([^\]]*)\](\([\s\S]*\))$/);
                if (!m) return;
                const rawAlt = m[1];
                const pipe = rawAlt.lastIndexOf("|");
                const hasSize = pipe >= 0 && /^\d+(x\d+)?$/.test(rawAlt.slice(pipe + 1).trim());
                const pureAlt = hasSize ? rawAlt.slice(0, pipe).trim() : rawAlt;
                const nextAlt = pureAlt ? `${pureAlt}|${finalW}` : `|${finalW}`;
                const nextSrc = `![${nextAlt}]${m[2]}`;
                if (nextSrc === src) return;

                const before = doc.slice(0, nodeFrom);
                const after = doc.slice(nodeTo);
                ed.setDocument(before + nextSrc + after);
                ed.setSelection(nodeFrom + nextSrc.length);
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

              const showChrome = () => {
                wrapper.style.borderColor = "var(--nexus-accent,#7c6cf4)";
                srcBtn.style.opacity = "1";
                resizeDot.style.opacity = "1";
              };
              const hideChrome = () => {
                if (dragging) return;
                wrapper.style.borderColor = "transparent";
                srcBtn.style.opacity = "0";
                resizeDot.style.opacity = "0";
              };
              wrapper.addEventListener("mouseenter", showChrome);
              wrapper.addEventListener("mouseleave", hideChrome);

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

  const toolbar = createToolbarUI(editor);
  container.insertBefore(toolbar.element, container.firstChild);

  // The slash menu owns its own DOM root mounted on document.body so
  // it can overflow the editor's clipping context (panels, scroll
  // ancestors). Its lifecycle is tied to the shell — destroyed below.
  const slashMenu = createSlashMenuUI(editor);

  return {
    editor,
    toolbar,
    slashMenu,
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
      slashMenu.destroy();
      toolbar.destroy();
      editor.destroy();
    },
  };
}
