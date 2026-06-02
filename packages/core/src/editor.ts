import { Annotation, EditorState } from "@codemirror/state";

// Annotation attached to dispatches that load content programmatically (e.g.
// setDocument from file open) so updateListener can skip the user-edit path —
// no onChange emission, no AST reparse for the onChange pipeline.
const silentDocChange = Annotation.define<boolean>();
import { EditorView, keymap, dropCursor, lineNumbers, type Direction } from "@codemirror/view";
import { indentWithTab, undo as cmUndo, redo as cmRedo } from "@codemirror/commands";
import { closeBrackets } from "@codemirror/autocomplete";
import type { Root } from "mdast";
import type { Heading } from "mdast";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import { EventEmitter } from "./event-emitter";
import { createLivePreviewExtension } from "./live-preview";
import { createMarkdownLanguageSupport } from "./lezer-markdown";
import { lezerStringToMdast, lezerTreeToMdast } from "./lezer-mdast-adapter";
import { markdownFoldService } from "./markdown-fold";
import { resolveLocale } from "./locale";
import { markdownAutoPair } from "./markdown-autopair";
import { markdownKeymap } from "./markdown-keymap";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { createThemeExtension, lightTheme, type NexusTheme } from "./theme";
import { computeSlashState } from "./slash-state";
import type { EditorAPI, EditorConfig, EditorEventMap, NexusPlugin, ParserLike, TocEntry } from "./types";
import { createWidgetExtension } from "./widget-extension";

function createEmptyAst(): Root {
  return {
    type: "root",
    children: []
  };
}

function parseDocument(parser: ParserLike, markdown: string): Root {
  try {
    return parser.parse(markdown);
  } catch {
    return createEmptyAst();
  }
}

/**
 * Build an mdast Root from the live editor state when one is available, or
 * fall back to a headless Lezer parse of the doc string. Synchronous, no
 * worker, no remark/micromark — uses the same incremental Lezer tree that
 * powers live-preview decorations.
 *
 * `viewRef.current.state` is preferred because Lezer's parse is intrinsic to
 * EditorState (incremental across edits); headless parsing is reserved for
 * the initial `currentAst` value before the view is constructed.
 */
function lezerAstFromAnywhere(
  viewRef: { current: EditorView | null },
  fallbackMarkdown: string,
): Root {
  const view = viewRef.current;
  if (view) return lezerTreeToMdast(view.state);
  return lezerStringToMdast(fallbackMarkdown);
}

function markdownToHtml(markdown: string, plugins: NexusPlugin[]): string {
  const processor = unified().use(remarkParse);
  for (const plugin of plugins) {
    for (const rp of plugin.remarkPlugins ?? []) {
      processor.use(rp);
    }
  }
  processor.use(remarkRehype).use(rehypeStringify);
  return String(processor.processSync(markdown));
}

function extractToc(ast: Root): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const node of ast.children) {
    if (node.type !== "heading") continue;
    const h = node as Heading;
    const from = h.position?.start.offset;
    const to = h.position?.end.offset;
    if (typeof from !== "number" || typeof to !== "number") continue;
    // Extract text from children recursively
    let text = "";
    const walk = (n: any) => {
      if (n.value) text += n.value;
      if (n.children) for (const c of n.children) walk(c);
    };
    walk(h);
    entries.push({ level: h.depth, text, from, to });
  }
  return entries;
}

function createParser(plugins: NexusPlugin[]): ParserLike {
  // Build the unified pipeline ONCE, not per-parse call. Each
  // `unified().use(...)` chain resolves plugin graphs, initializes extensions,
  // and freezes the processor — measured at ~100ms on a packaged build even
  // for empty input. Doing it on every parse meant file-open, every keystroke
  // (pre-debounce), and every live-preview rebuild paid this cost.
  const processor = unified().use(remarkParse);
  for (const plugin of plugins) {
    for (const remarkPlugin of plugin.remarkPlugins ?? []) {
      processor.use(remarkPlugin);
    }
  }
  processor.freeze();

  return {
    parse(markdown) {
      const tree = processor.parse(markdown);
      return processor.runSync(tree) as Root;
    }
  };
}

/**
 * Transform-only processor: runs the user's remark transformer plugins
 * against an already-parsed mdast Root (one produced by the Lezer adapter).
 * No remark-parse, so the cost is whatever the user plugins cost — and it's
 * a no-op when no plugins are attached.
 */
function createTransformProcessor(plugins: NexusPlugin[]): { runSync(tree: Root): Root } | null {
  let attached = 0;
  const processor = unified();
  for (const plugin of plugins) {
    for (const remarkPlugin of plugin.remarkPlugins ?? []) {
      processor.use(remarkPlugin);
      attached++;
    }
  }
  if (attached === 0) return null;
  processor.freeze();
  return { runSync: (tree) => processor.runSync(tree) as Root };
}

export function createEditor(config: EditorConfig): EditorAPI {
  const plugins = config.plugins ?? [];
  // `parser` is retained as an optional escape hatch for tests / consumers
  // that pass a custom mdast pipeline. It is NO LONGER on the editor's hot
  // path — the default code path uses lezerAstFromAnywhere which runs a
  // synchronous Lezer parse against the live EditorState. Custom parsers
  // (when provided) win, so existing test contracts that swap in mock
  // parsers stay green.
  const customParser = config.parser;
  const shortcuts = plugins.flatMap((plugin) => plugin.shortcuts ?? []);
  const slashCommands = plugins.flatMap((plugin) => plugin.slashCommands ?? []);
  const cmExtensions = plugins.flatMap((plugin) => plugin.cmExtensions ?? []);
  const widgetDefs = plugins.flatMap((plugin) => plugin.widgets ?? []);

  // The sync remark parser is only needed for the legacy WidgetDefinition
  // extension. Live preview, getAst(), table-of-contents, and normal change
  // events all use the Lezer path below, so avoid paying this startup cost in
  // the common no-widget case (including the Electron demo).
  const fallbackParser = !customParser && widgetDefs.length > 0 ? createParser(plugins) : null;
  const widgetParser: ParserLike | null = customParser ?? fallbackParser;
  // Built only when the user passes remarkPlugins AND no custom parser.
  // Custom-parser callers run their plugins inside `parser.parse`, so the
  // transform pass would double-apply.
  const hasRemarkPlugins = plugins.some((plugin) => (plugin.remarkPlugins?.length ?? 0) > 0);
  const transformProcessor = !customParser && hasRemarkPlugins ? createTransformProcessor(plugins) : null;
  const transformAst = (ast: Root): Root =>
    transformProcessor ? transformProcessor.runSync(ast) : ast;
  const locale = resolveLocale(config.locale);
  const parseDelayMs = config.parseDelayMs ?? 0;
  const emitter = new EventEmitter<EditorEventMap>();
  let destroyed = false;
  let focused = false;
  let parseTimer: ReturnType<typeof setTimeout> | undefined;
  // Initial AST: when a custom parser is provided, honour it (tests rely on
  // this — they install plugins that mutate the tree). Otherwise use the
  // Lezer string parser, which is dramatically faster than remark and
  // produces a structurally compatible mdast Root.
  let currentAst = customParser
    ? parseDocument(customParser, config.initialValue ?? "")
    : transformAst(lezerStringToMdast(config.initialValue ?? ""));
  // Forward ref so emitChange/setDocument can run lezerTreeToMdast against
  // the live EditorState once the view is constructed.
  const viewRef: { current: EditorView | null } = { current: null };
  let api!: EditorAPI;

  function setFocused(next: boolean) {
    if (destroyed || focused === next) {
      return;
    }

    focused = next;

    if (next) {
      config.onFocus?.();
      emitter.emit("focus");
      return;
    }

    config.onBlur?.();
    emitter.emit("blur");
  }

  function emitChange(markdown: string) {
    if (destroyed) {
      return;
    }

    // Custom parser path: respected for tests / consumers that pass their own
    // mdast pipeline (e.g. with bespoke remark plugins).
    if (customParser) {
      currentAst = parseDocument(customParser, markdown);
      config.onChange?.(markdown, currentAst);
      emitter.emit("change", markdown, currentAst);
      return;
    }

    // Default path: Lezer-driven, synchronous, no worker. We read the live
    // EditorState via viewRef so we get the incremental Lezer tree (cheap
    // even on large docs). Falls back to a headless parse pre-view.
    // User remark transformer plugins (if any) run via transformAst.
    currentAst = transformAst(lezerAstFromAnywhere(viewRef, markdown));
    config.onChange?.(markdown, currentAst);
    emitter.emit("change", markdown, currentAst);
  }

  function scheduleChange(markdown: string) {
    if (parseTimer) {
      clearTimeout(parseTimer);
      parseTimer = undefined;
    }

    if (parseDelayMs <= 0) {
      emitChange(markdown);
      return;
    }

    parseTimer = setTimeout(() => {
      parseTimer = undefined;
      emitChange(markdown);
    }, parseDelayMs);
  }

  const themeExt = createThemeExtension(config.theme ?? lightTheme);
  const tabSizeExt = config.tabSize && config.tabSize !== 4
    ? EditorState.tabSize.of(config.tabSize)
    : [];
  const readOnlyExt = config.readOnly
    ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
    : [];
  const directionExt = config.direction === "rtl"
    ? EditorView.contentAttributes.of({ dir: "rtl" })
    : [];
  const indentGuidesExt = config.indentGuides ? indentationMarkers() : [];

  const shortcutExtensions =
    shortcuts.length > 0
      ? [
          keymap.of(
            shortcuts.map((shortcut) => ({
              key: shortcut.key,
              run: () => shortcut.run(api)
            }))
          )
        ]
      : [];

  const view = new EditorView({
    parent: config.container,
    state: EditorState.create({
      doc: config.initialValue ?? "",
      extensions: [
        EditorView.domEventHandlers({
          focus() {
            setFocused(true);
            return false;
          },
          blur() {
            setFocused(false);
            return false;
          }
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            // Skip onChange/onParse work for transactions explicitly flagged as
            // "silent" (e.g. setDocument({ silent: true }) used when loading a
            // file from disk — that's not a user edit).
            const silent = update.transactions.some((t) => t.annotation(silentDocChange) === true);
            if (!silent) {
              scheduleChange(update.state.doc.toString());
            }
          }

          if ((update.selectionSet || update.docChanged) && !destroyed) {
            const sel = update.state.selection.main;

            if (update.selectionSet) {
              emitter.emit("selectionChange", { anchor: sel.anchor, head: sel.head });
            }

            if (slashCommands.length > 0) {
              const doc = update.state.doc.toString();
              const state = computeSlashState(doc, sel.head, slashCommands, {
                limit: config.slashMenuLimit,
              });
              let coords: { left: number; top: number; bottom: number } | null = null;

              if (state.isOpen && state.from !== null) {
                try {
                  const raw = update.view.coordsAtPos(state.from);
                  if (raw) {
                    coords = { left: raw.left, top: raw.top, bottom: raw.bottom };
                  }
                } catch { /* out of range */ }
              }

              emitter.emit("slashMenuChange", { ...state, coords });
            }
          }
        }),
        // Lezer-based markdown language support. Drives `syntaxTree(state)` and
        // gives us an incremental, viewport-aware parse tree intrinsic to the
        // editor state. Step 1 of the lezer-migration: the tree is available
        // but the existing mdast pipeline still feeds buildDecorations; later
        // steps will switch the decoration handlers over to read from this
        // tree and remove the mdast worker round-trip.
        createMarkdownLanguageSupport(),
        lineNumbers(),
        themeExt.extension,
        tabSizeExt,
        readOnlyExt,
        directionExt,
        indentGuidesExt,
        markdownKeymap(),
        markdownFoldService(),
        keymap.of([indentWithTab]),
        closeBrackets(),
        markdownAutoPair(),
        dropCursor(),
        EditorView.domEventHandlers({
          drop(event) {
            if (!config.onAssetUpload || destroyed) return false;
            const files = event.dataTransfer?.files;
            if (!files || files.length === 0) return false;

            event.preventDefault();
            for (const file of Array.from(files)) {
              config.onAssetUpload(file).then((url) => {
                if (url) {
                  const isImage = file.type.startsWith("image/");
                  const md = isImage ? `![${file.name}](${url})` : `[${file.name}](${url})`;
                  view.dispatch(view.state.replaceSelection(md));
                }
              });
            }
            return true;
          },
          paste(event) {
            if (!config.onAssetUpload || destroyed) return false;
            const files = event.clipboardData?.files;
            if (!files || files.length === 0) return false;

            event.preventDefault();
            for (const file of Array.from(files)) {
              config.onAssetUpload(file).then((url) => {
                if (url) {
                  const isImage = file.type.startsWith("image/");
                  const md = isImage ? `![${file.name}](${url})` : `[${file.name}](${url})`;
                  view.dispatch(view.state.replaceSelection(md));
                }
              });
            }
            return true;
          },
        }),
        ...createLivePreviewExtension(config.livePreview, {
          addColumn: locale.addColumn,
          addRow: locale.addRow,
          deleteColumn: locale.deleteColumn,
          deleteRow: locale.deleteRow,
          insertColumnAfter: locale.insertColumnAfter,
          insertRowBelow: locale.insertRowBelow,
        }),
        ...(widgetParser ? createWidgetExtension(widgetParser, widgetDefs) : []),
        ...shortcutExtensions,
        ...cmExtensions
      ]
    })
  });

  // Hand the view to lezerAstFromAnywhere consumers so getAst() / emitChange
  // / silent setDocument can read the live incremental Lezer tree.
  viewRef.current = view;

  api = {
    getDocument() {
      return view.state.doc.toString();
    },
    getAst() {
      return currentAst;
    },
    getTableOfContents() {
      return extractToc(currentAst);
    },
    exportHTML() {
      return markdownToHtml(view.state.doc.toString(), plugins);
    },
    setTheme(theme: NexusTheme) {
      if (destroyed) return;
      view.dispatch(themeExt.reconfigure(theme));
    },
    getSelection() {
      const sel = view.state.selection.main;
      return { anchor: sel.anchor, head: sel.head };
    },
    getSlashCommands() {
      return slashCommands;
    },
    uploadAsset(file) {
      if (destroyed || !config.onAssetUpload) {
        return Promise.resolve(null);
      }

      return config.onAssetUpload(file);
    },
    setSelection(anchor, head = anchor) {
      if (destroyed) {
        return;
      }

      view.dispatch({
        selection: { anchor, head },
        scrollIntoView: true
      });
    },
    setDocument(next, opts) {
      if (destroyed) {
        return;
      }

      const silent = opts?.silent === true;
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: next
        },
        annotations: silent ? silentDocChange.of(true) : undefined,
      });

      // In silent mode we still keep currentAst in sync so getAst() /
      // getTableOfContents() reflect the loaded file. Default path is the
      // Lezer adapter against the freshly dispatched state — synchronous and
      // negligible cost. Custom-parser callers (tests) keep their semantics.
      if (silent) {
        if (customParser) {
          currentAst = parseDocument(customParser, next);
        } else {
          currentAst = transformAst(lezerAstFromAnywhere(viewRef, next));
        }
      }
    },
    replaceSelection(text) {
      if (destroyed) return;
      view.dispatch(view.state.replaceSelection(text));
    },
    undo() {
      if (destroyed) return false;
      return cmUndo(view);
    },
    redo() {
      if (destroyed) return false;
      return cmRedo(view);
    },
    focus() {
      if (destroyed) {
        return;
      }

      view.focus();
      setFocused(true);
    },
    blur() {
      if (destroyed) {
        return;
      }

      view.contentDOM.blur();
      setFocused(false);
    },
    runShortcut(key) {
      if (destroyed) {
        return false;
      }

      const shortcut = shortcuts.find((entry) => entry.key === key);
      return shortcut ? shortcut.run(api) : false;
    },
    on(event, handler) {
      emitter.on(event, handler);
    },
    off(event, handler) {
      emitter.off(event, handler);
    },
    getCoordsAtPos(pos) {
      if (destroyed) return null;
      try {
        return view.coordsAtPos(pos);
      } catch {
        return null;
      }
    },
    getDocumentStats() {
      const doc = view.state.doc.toString();
      const characters = doc.length;
      const words = doc.trim() === "" ? 0 : doc.trim().split(/\s+/).length;
      const lines = view.state.doc.lines;
      return { characters, words, lines };
    },
    get view(): EditorView {
      return view;
    },
    destroy() {
      destroyed = true;
      focused = false;
      if (parseTimer) {
        clearTimeout(parseTimer);
        parseTimer = undefined;
      }
      emitter.clear();
      view.destroy();
    }
  };

  return api;
}
