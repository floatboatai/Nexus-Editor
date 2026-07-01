import { Annotation, EditorSelection, EditorState } from "@codemirror/state";

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
import { createLivePreviewExtension, isLivePreviewEnabled } from "./live-preview";
import { createSearchHighlightDecorationExtension } from "./search-highlight";
import { createMarkdownLanguageSupport } from "./lezer-markdown";
import { lezerStringToMdast, lezerTreeToMdast } from "./lezer-mdast-adapter";
import { markdownFoldService } from "./markdown-fold";
import { resolveLocale } from "./locale";
import { markdownAutoPair } from "./markdown-autopair";
import { markdownKeymap } from "./markdown-keymap";
import { multiCursorExtension } from "./multi-cursor";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { createThemeExtension, lightTheme, type NexusTheme } from "./theme";
import { computeSlashState } from "./slash-state";
import type {
  EditorAPI,
  EditorCommand,
  EditorConfig,
  EditorEventContext,
  EditorEventHandler,
  EditorEventMap,
  EditorSelectionRange,
  NexusPlugin,
  ParserLike,
  SetDocumentOptions,
  TocEntry,
} from "./types";
import { createWidgetExtension } from "./widget-extension";

const FLOATBOAT_MARKDOWN_DEBUG_STORAGE_KEY = "floatboat:markdown-debug";
const COMPOSITION_FLUSH_DELAY_MS = 60;

interface NexusDebugGlobal {
  __FLOATBOAT_MARKDOWN_DEBUG__?: boolean;
  localStorage?: {
    getItem(key: string): string | null;
  };
}

function isNexusDebugEnabled(): boolean {
  const debugGlobal = globalThis as NexusDebugGlobal;
  if (debugGlobal.__FLOATBOAT_MARKDOWN_DEBUG__ === true) return true;

  try {
    return debugGlobal.localStorage?.getItem(FLOATBOAT_MARKDOWN_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function debugNexus(message: string, details?: Record<string, unknown>): void {
  if (!isNexusDebugEnabled()) return;
  if (details) {
    console.debug(`[NexusEditor] ${message}`, details);
    return;
  }
  console.debug(`[NexusEditor] ${message}`);
}

function createEmptyAst(): Root {
  return {
    type: "root",
    children: []
  };
}

/**
 * 从剪贴板 / 拖拽数据里收集文件。优先用 `files`；当 `files` 为空时回退到 `items`，
 * 因为截图、网页复制的图片往往以 `DataTransferItem`（kind === "file"）形式到达，
 * 而非 `files` 列表——这正是 cmd+v 粘贴图片在多数平台的真实形态。
 */
function collectFilesFromDataTransfer(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];

  const files: File[] = [];
  if (data.files && data.files.length > 0) {
    files.push(...Array.from(data.files));
  }

  if (files.length === 0 && data.items && data.items.length > 0) {
    for (const item of Array.from(data.items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }

  return files;
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

function clampPosition(pos: number, docLength: number): number {
  if (!Number.isFinite(pos)) return 0;
  return Math.max(0, Math.min(docLength, Math.trunc(pos)));
}

function resolveDocumentSelection(
  before: EditorSelectionRange,
  docLength: number,
  opts: SetDocumentOptions | undefined,
): EditorSelectionRange | undefined {
  if (opts?.selection) {
    const anchor = clampPosition(opts.selection.anchor, docLength);
    const head = clampPosition(opts.selection.head ?? opts.selection.anchor, docLength);
    return { anchor, head };
  }

  if (opts?.preserveSelection) {
    return {
      anchor: clampPosition(before.anchor, docLength),
      head: clampPosition(before.head, docLength),
    };
  }

  return undefined;
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
  debugNexus("create", {
    initialLength: (config.initialValue ?? "").length,
    pluginNames: plugins.map((plugin) => plugin.name),
    readOnly: config.readOnly === true,
    direction: config.direction ?? "ltr",
  });
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
  // 命名命令（类 Obsidian addCommand）。同 id 以先注册者为准。
  const commands = plugins.flatMap((plugin) => plugin.commands ?? []);
  const commandById = new Map<string, EditorCommand>();
  for (const command of commands) {
    if (!commandById.has(command.id)) commandById.set(command.id, command);
  }
  // 插件 DOM 事件钩子。内置资源上传作为兜底，在所有钩子都未消费时才执行。
  const pasteHandlers = plugins
    .map((plugin) => plugin.handlers?.paste)
    .filter((handler): handler is EditorEventHandler<ClipboardEvent> => Boolean(handler));
  const dropHandlers = plugins
    .map((plugin) => plugin.handlers?.drop)
    .filter((handler): handler is EditorEventHandler<DragEvent> => Boolean(handler));
  const keydownHandlers = plugins
    .map((plugin) => plugin.handlers?.keydown)
    .filter((handler): handler is EditorEventHandler<KeyboardEvent> => Boolean(handler));

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
  let compositionFlushTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingCompositionMarkdown: string | null = null;
  // 组合输入（IME）状态与被推迟的文档回灌。组合输入进行中调用 setDocument 会被
  // 推迟到 compositionend 再应用，避免整文档替换打断输入法、丢失合成中文字、视口跳顶。
  let composing = false;
  let pendingDocumentLoad: { next: string; opts?: SetDocumentOptions } | null = null;
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

  function queueCompositionChange(markdown: string) {
    pendingCompositionMarkdown = markdown;
    if (parseTimer) {
      clearTimeout(parseTimer);
      parseTimer = undefined;
    }
  }

  function flushCompositionChange(view: EditorView, reason: string) {
    if (compositionFlushTimer) {
      clearTimeout(compositionFlushTimer);
      compositionFlushTimer = undefined;
    }

    compositionFlushTimer = setTimeout(() => {
      compositionFlushTimer = undefined;
      if (destroyed || view.compositionStarted || pendingCompositionMarkdown === null) {
        return;
      }

      const markdown = view.state.doc.toString();
      pendingCompositionMarkdown = null;
      debugNexus("composition-flush", {
        reason,
        documentLength: markdown.length,
        selection: {
          anchor: view.state.selection.main.anchor,
          head: view.state.selection.main.head,
        },
      });
      scheduleChange(markdown);
    }, COMPOSITION_FLUSH_DELAY_MS);
  }

  // 整文档替换的实际执行体。setDocument（公开 API）在组合输入中会推迟调用本函数。
  function performSetDocument(next: string, opts?: SetDocumentOptions) {
    const beforeSelection = view.state.selection.main;
    const silent = opts?.silent === true;
    const selection = resolveDocumentSelection(
      { anchor: beforeSelection.anchor, head: beforeSelection.head },
      next.length,
      opts
    );
    debugNexus("setDocument", {
      silent,
      oldLength: view.state.doc.length,
      nextLength: next.length,
      beforeSelection: { anchor: beforeSelection.anchor, head: beforeSelection.head },
      selection,
    });

    const dispatchSpec = {
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: next
      },
      annotations: silent ? silentDocChange.of(true) : undefined,
      ...(selection ? { selection } : {}),
    };

    view.dispatch(dispatchSpec);

    // silent 模式下仍同步 currentAst，使 getAst() / getTableOfContents() 反映已载入文件。
    if (silent) {
      if (customParser) {
        currentAst = parseDocument(customParser, next);
      } else {
        currentAst = transformAst(lezerAstFromAnywhere(viewRef, next));
      }
    }
  }

  // compositionend 时应用被推迟的文档回灌；整文档替换后排队中的组合输入变更已失效。
  function applyPendingDocumentLoad(): boolean {
    if (!pendingDocumentLoad) return false;
    const { next, opts } = pendingDocumentLoad;
    pendingDocumentLoad = null;
    pendingCompositionMarkdown = null;
    performSetDocument(next, opts);
    return true;
  }

  function createEventContext(): EditorEventContext {
    return {
      editor: api,
      insertMarkdown: (markdown: string) => {
        if (destroyed) return;
        view.dispatch(view.state.replaceSelection(markdown));
      },
      uploadAsset: (file: File) => api.uploadAsset(file),
    };
  }

  // 依次执行插件事件钩子；任一返回 true 视为已消费，停止派发。
  function runEventHandlers<E extends Event>(handlers: EditorEventHandler<E>[], event: E): boolean {
    if (destroyed || handlers.length === 0) return false;
    const ctx = createEventContext();
    for (const handler of handlers) {
      if (handler(event, ctx) === true) return true;
    }
    return false;
  }

  // 默认资源兜底：粘贴 / 拖拽进来的图片或文件依次走宿主上传管线并插入 markdown 引用。
  function insertUploadedAssets(files: File[]): void {
    const upload = config.onAssetUpload;
    if (!upload || destroyed || files.length === 0) return;
    void (async () => {
      for (const file of files) {
        let url: string | null = null;
        try {
          url = await upload(file);
        } catch {
          url = null;
        }
        if (!url || destroyed) continue;
        const isImage = file.type.startsWith("image/");
        const label = file.name || (isImage ? "image" : "file");
        const markdown = isImage ? `![${label}](${url})` : `[${label}](${url})`;
        view.dispatch(view.state.replaceSelection(markdown));
      }
    })();
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
  const multiCursorExt = config.multiCursor ? multiCursorExtension() : [];

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

  // 带 hotkey 的命名命令注册成 CodeMirror keymap；返回非 false 视为已消费。
  const hotkeyCommands = commands.filter(
    (command): command is EditorCommand & { hotkey: string } =>
      typeof command.hotkey === "string" && command.hotkey.length > 0
  );
  const commandKeymapExtensions =
    hotkeyCommands.length > 0
      ? [
          keymap.of(
            hotkeyCommands.map((command) => ({
              key: command.hotkey,
              run: () => command.run(api) !== false
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
          },
          compositionstart(_event, view) {
            composing = true;
            debugNexus("composition-start", {
              documentLength: view.state.doc.length,
              selection: {
                anchor: view.state.selection.main.anchor,
                head: view.state.selection.main.head,
              },
            });
            return false;
          },
          compositionend(_event, view) {
            composing = false;
            debugNexus("composition-end", {
              documentLength: view.state.doc.length,
              hasPendingChange: pendingCompositionMarkdown !== null,
              hasPendingDocumentLoad: pendingDocumentLoad !== null,
            });
            // 组合输入结束：先应用被推迟的外部文档回灌（若有），否则正常 flush 本次输入。
            if (applyPendingDocumentLoad()) {
              return false;
            }
            flushCompositionChange(view, "compositionend");
            return false;
          }
        }),
        EditorView.updateListener.of((update) => {
          const silent = update.transactions.some((t) => t.annotation(silentDocChange) === true);
          const compositionTransaction = update.transactions.some((t) => t.isUserEvent("input.type.compose"));
          if (update.docChanged || update.selectionSet) {
            const sel = update.state.selection.main;
            debugNexus("update", {
              docChanged: update.docChanged,
              selectionSet: update.selectionSet,
              silent,
              composing: update.view.composing,
              compositionStarted: update.view.compositionStarted,
              compositionTransaction,
              documentLength: update.state.doc.length,
              selection: { anchor: sel.anchor, head: sel.head },
            });
          }

          if (update.docChanged) {
            // Skip onChange/onParse work for transactions explicitly flagged as
            // "silent" (e.g. setDocument({ silent: true }) used when loading a
            // file from disk — that's not a user edit).
            if (!silent) {
              const markdown = update.state.doc.toString();
              if (compositionTransaction || update.view.composing || update.view.compositionStarted) {
                debugNexus("composition-change-queued", {
                  documentLength: markdown.length,
                  compositionTransaction,
                  composing: update.view.composing,
                  compositionStarted: update.view.compositionStarted,
                });
                queueCompositionChange(markdown);
              } else {
                pendingCompositionMarkdown = null;
                scheduleChange(markdown);
              }
            }
          }

          if ((update.selectionSet || update.docChanged) && !destroyed) {
            const sel = update.state.selection.main;

            if (update.selectionSet) {
              const selection = update.state.selection;
              emitter.emit("selectionChange", {
                anchor: sel.anchor,
                head: sel.head,
                ranges: selection.ranges.map((range) => ({ anchor: range.anchor, head: range.head })),
                mainIndex: selection.mainIndex,
              });
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
        multiCursorExt,
        markdownFoldService(),
        keymap.of([indentWithTab]),
        closeBrackets(),
        markdownAutoPair(),
        dropCursor(),
        EditorView.domEventHandlers({
          paste(event) {
            // 先派发插件 paste 钩子；任一消费则阻止默认行为。
            if (runEventHandlers(pasteHandlers, event)) {
              event.preventDefault();
              return true;
            }
            // 默认兜底：剪贴板里有图片 / 文件时走资源上传；纯文本粘贴交回 CodeMirror。
            if (!config.onAssetUpload || destroyed) return false;
            const files = collectFilesFromDataTransfer(event.clipboardData);
            if (files.length === 0) return false;

            event.preventDefault();
            insertUploadedAssets(files);
            return true;
          },
          drop(event) {
            if (runEventHandlers(dropHandlers, event)) {
              event.preventDefault();
              return true;
            }
            if (!config.onAssetUpload || destroyed) return false;
            const files = collectFilesFromDataTransfer(event.dataTransfer);
            if (files.length === 0) return false;

            event.preventDefault();
            insertUploadedAssets(files);
            return true;
          },
          keydown(event) {
            if (runEventHandlers(keydownHandlers, event)) {
              event.preventDefault();
              return true;
            }
            return false;
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
        ...(isLivePreviewEnabled(config.livePreview)
          ? []
          : createSearchHighlightDecorationExtension()),
        ...(widgetParser ? createWidgetExtension(widgetParser, widgetDefs) : []),
        ...shortcutExtensions,
        ...commandKeymapExtensions,
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
    getSelections() {
      const selection = view.state.selection;
      return {
        ranges: selection.ranges.map((range) => ({ anchor: range.anchor, head: range.head })),
        mainIndex: selection.mainIndex,
      };
    },
    getSelectedText() {
      const sel = view.state.selection.main;
      const from = Math.min(sel.anchor, sel.head);
      const to = Math.max(sel.anchor, sel.head);
      return view.state.doc.sliceString(from, to);
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

      const before = view.state.selection.main;
      debugNexus("setSelection", {
        before: { anchor: before.anchor, head: before.head },
        next: { anchor, head },
        documentLength: view.state.doc.length,
      });

      view.dispatch({
        selection: { anchor, head },
        scrollIntoView: true
      });
    },
    setSelections(ranges, mainIndex) {
      if (destroyed || ranges.length === 0) {
        return;
      }

      view.dispatch({
        selection: EditorSelection.create(
          ranges.map((range) => EditorSelection.range(range.anchor, range.head ?? range.anchor)),
          mainIndex ?? ranges.length - 1
        ),
        scrollIntoView: true
      });
    },
    setDocument(next, opts) {
      if (destroyed) {
        return;
      }

      // 组合输入（IME）进行中：整文档替换会打断输入法、丢失合成中文字并把视口重置到顶部。
      // 推迟到 compositionend 再应用，只保留最后一次请求。
      if (composing || view.composing || view.compositionStarted) {
        pendingDocumentLoad = { next, opts };
        debugNexus("setDocument-deferred-composing", {
          silent: opts?.silent === true,
          nextLength: next.length,
        });
        return;
      }

      performSetDocument(next, opts);
    },
    replaceSelection(text) {
      if (destroyed) return;
      view.dispatch(view.state.replaceSelection(text));
    },
    replaceRange(from, to, insert, selection, opts) {
      if (destroyed) return;
      const silent = opts?.silent === true;
      view.dispatch({
        changes: { from, to, insert },
        selection: selection
          ? { anchor: selection.anchor, head: selection.head ?? selection.anchor }
          : undefined,
        scrollIntoView: true,
        annotations: silent ? silentDocChange.of(true) : undefined,
      });
      if (silent) {
        const next = view.state.doc.toString();
        if (customParser) {
          currentAst = parseDocument(customParser, next);
        } else {
          currentAst = transformAst(lezerAstFromAnywhere(viewRef, next));
        }
      }
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
    getCommands() {
      return commands.slice();
    },
    runCommand(id) {
      if (destroyed) {
        return false;
      }

      const command = commandById.get(id);
      if (!command) return false;
      return command.run(api) !== false;
    },
    isComposing() {
      if (destroyed) return false;
      return composing || view.composing || view.compositionStarted;
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
    getPosAtDOM(node) {
      if (destroyed) return null;
      try {
        return view.posAtDOM(node);
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
    destroy() {
      debugNexus("destroy", {
        documentLength: view.state.doc.length,
        selection: {
          anchor: view.state.selection.main.anchor,
          head: view.state.selection.main.head,
        },
      });
      destroyed = true;
      focused = false;
      if (parseTimer) {
        clearTimeout(parseTimer);
        parseTimer = undefined;
      }
      if (compositionFlushTimer) {
        clearTimeout(compositionFlushTimer);
        compositionFlushTimer = undefined;
      }
      pendingCompositionMarkdown = null;
      pendingDocumentLoad = null;
      composing = false;
      emitter.clear();
      view.destroy();
    }
  };

  return api;
}
