import type { Extension } from "@codemirror/state";
import type { Blockquote, Code, Definition, Delete, Emphasis, FootnoteDefinition, FootnoteReference, Heading, Html, Image, InlineCode, Link, List, Root, Strong, Table, ThematicBreak } from "mdast";
import type { Plugin } from "unified";

export interface CodeHighlightToken {
  /** Absolute offset in the source markdown (beginning of the highlighted span). */
  from: number;
  /** Absolute offset at end (exclusive). */
  to: number;
  /** Space-separated hljs class list, e.g. "hljs-keyword" or "hljs-string hljs-regexp". */
  className: string;
}

export interface ParseResult {
  ast: Root;
  /** Pre-computed syntax-highlight spans for fenced code blocks. */
  codeTokens?: CodeHighlightToken[];
}

export interface ParserLike {
  parse(markdown: string): Root;
  /**
   * Optional async parser — when provided, live-preview offloads parsing +
   * code-block highlighting to this (typically a Web Worker). The sync
   * `parse` remains as a fallback path (used while the worker is warming up
   * or for out-of-band callers like exportHTML).
   */
  parseAsync?(markdown: string): Promise<ParseResult>;
}

export type LivePreviewNode =
  | Blockquote
  | Code
  | Definition
  | Delete
  | Emphasis
  | FootnoteDefinition
  | FootnoteReference
  | Heading
  | Html
  | Image
  | InlineCode
  | Link
  | List
  | Strong
  | Table
  | ThematicBreak;

export type LivePreviewNodeType = LivePreviewNode["type"];

export interface LivePreviewRenderContext {
  node: LivePreviewNode;
  nodeType: LivePreviewNodeType;
  source: string;
  text: string;
  /** Absolute offset of the node's start in the document. */
  from: number;
  /** Absolute offset of the node's end in the document. */
  to: number;
}

export type LivePreviewRenderer = (context: LivePreviewRenderContext) => HTMLElement;

export interface LivePreviewLabels {
  addColumn?: string;
  addRow?: string;
  deleteColumn?: string;
  deleteRow?: string;
  insertColumnAfter?: string;
  insertRowBelow?: string;
}

export interface LivePreviewConfig {
  enabled?: boolean;
  renderers?: Partial<Record<LivePreviewNodeType, LivePreviewRenderer>>;
  labels?: LivePreviewLabels;
}

export interface EditorConfig {
  container: HTMLElement;
  initialValue?: string;
  parser?: ParserLike;
  parseDelayMs?: number;
  livePreview?: boolean | LivePreviewConfig;
  plugins?: NexusPlugin[];
  theme?: import("./theme").NexusTheme;
  locale?: Partial<import("./locale").NexusLocale>;
  /** Tab size in spaces. Default: 4 */
  tabSize?: number;
  /** Text direction. Default: "ltr" */
  direction?: "ltr" | "rtl";
  /** Show indentation guide lines. Default: false */
  indentGuides?: boolean;
  /** Prevent user edits while preserving selection and scrolling. Default: false */
  readOnly?: boolean;
  /**
   * Enable multi-cursor / multi-selection editing. Default: false.
   *
   * When true the editor allows multiple selection ranges, renders secondary
   * cursors/selections (CodeMirror `drawSelection`), lets Alt-click add a
   * cursor, and binds `Mod-d` (select next occurrence), `Mod-Alt-ArrowUp/Down`
   * (add cursor above/below) and `Escape` (collapse to the main selection).
   * Off by default because `drawSelection` visibly replaces the native caret
   * and selection rendering for existing consumers.
   */
  multiCursor?: boolean;
  /**
   * Maximum number of slash-menu entries emitted on `slashMenuChange`
   * after ranking. Default: 8. A limit of 0 keeps the menu state open
   * but emits an empty command list (useful for "no results" UIs).
   */
  slashMenuLimit?: number;
  onChange?: (doc: string, ast: Root) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /**
   * 资源上传钩子：粘贴 / 拖拽进来的图片或文件交给宿主落盘 / 上传，返回可供 markdown
   * 引用的 URL（相对路径或远程地址）。返回 null 表示放弃，编辑器不会插入坏链接。
   */
  onAssetUpload?: (file: File) => Promise<string | null>;
}

export interface SlashMenuState {
  isOpen: boolean;
  from: number | null;
  to: number | null;
  query: string;
  commands: SlashCommandDef[];
  coords: { left: number; top: number; bottom: number } | null;
}

/** One selection range in plain-object form (`anchor` may be after `head`). */
export interface SelectionRangeJSON {
  anchor: number;
  head: number;
}

/** Full selection snapshot: every range plus which one is the main range. */
export interface SelectionState {
  ranges: SelectionRangeJSON[];
  mainIndex: number;
}

export interface EditorEventMap {
  change: (doc: string, ast: Root) => void;
  focus: () => void;
  blur: () => void;
  /** `anchor` / `head` describe the main range; `ranges` carries all of them. */
  selectionChange: (selection: { anchor: number; head: number } & SelectionState) => void;
  slashMenuChange: (state: SlashMenuState) => void;
}

export interface TocEntry {
  level: number;
  text: string;
  from: number;
  to: number;
}

export interface EditorSelectionRange {
  anchor: number;
  head: number;
}

export interface SetDocumentOptions {
  /**
   * When true, skip the onChange pipeline. Use when loading a file from disk
   * to avoid treating the load as a user edit.
   */
  silent?: boolean;
  /**
   * Keep the current main selection after replacing the document. Positions
   * are clamped to the new document length.
   */
  preserveSelection?: boolean;
  /**
   * Apply an explicit selection after replacing the document. Takes precedence
   * over preserveSelection. head defaults to anchor.
   */
  selection?: {
    anchor: number;
    head?: number;
  };
}

export interface EditorAPI {
  getDocument(): string;
  getAst(): Root;
  getTableOfContents(): TocEntry[];
  exportHTML(): string;
  setTheme(theme: import("./theme").NexusTheme): void;
  getSelection(): { anchor: number; head: number };
  /** All selection ranges plus the main-range index. Single-range editors return one entry. */
  getSelections(): SelectionState;
  /** Returns the text currently selected in the editor. Returns an empty string when the selection is collapsed. */
  getSelectedText(): string;
  getSlashCommands(): SlashCommandDef[];
  uploadAsset(file: File): Promise<string | null>;
  setSelection(anchor: number, head?: number): void;
  /**
   * Replace the selection with the given ranges. `mainIndex` defaults to the
   * last range (CodeMirror's latest-added-is-main convention). Multiple
   * ranges require `multiCursor: true` — without it CodeMirror collapses the
   * selection to the main range.
   */
  setSelections(ranges: { anchor: number; head?: number }[], mainIndex?: number): void;
  /**
   * Replace the document content.
   *
   * @param opts.silent  When true, skip the onChange pipeline. Use when
   *   loading a file from disk — avoids treating a file-open as a user
   *   edit (no redundant mdast parse / link-index rebuild).
   *
   * 组合输入（IME）进行中时，整文档替换会打断输入法、丢失正在合成的文字
   * 并把视口重置到顶部。此时本次替换会延迟到 compositionend 再应用，只保留
   * 最后一次请求。
   */
  setDocument(next: string, opts?: SetDocumentOptions): void;
  replaceSelection(text: string): void;
  /**
   * Replace the substring `[from, to)` with `insert` and — optionally —
   * move the selection, all in a single CM6 transaction.
   *
   * **One transaction = one undo entry.** A single Ctrl+Z will revert both
   * the edit and the cursor/selection move together. Do NOT emulate this
   * with a separate `setDocument`/`setSelection` pair — that dispatches two
   * transactions, produces two undo entries, and leaves the document mangled
   * after the first Ctrl+Z.
   *
   * - `selection` is optional. When omitted CM6 maps the existing selection
   *   through the change using its default position mapping — callers that
   *   don't care where the cursor lands after the edit can skip this.
   * - `silent` mirrors `setDocument`: skips `onChange` / the `change` event.
   *   The AST is still resynced inline so `getAst()` stays consistent for
   *   immediate callers. Intended for non-user edits only (file-open, seeding).
   *   Plugin code should leave `silent` unset.
   * - Positions (`from`, `to`, and `selection` offsets) are in pre-edit doc
   *   coordinates — the same coordinate space as `getSelection()` returns.
   * - Bounds: callers are responsible for valid offsets. CM6 throws
   *   `RangeError` on out-of-bounds values — identical trust model to
   *   `setSelection`. No double validation is performed in this layer.
   *
   * Use this instead of `setDocument` when you are editing a range, not
   * replacing the whole document.
   */
  replaceRange(
    from: number,
    to: number,
    insert: string,
    selection?: { anchor: number; head?: number },
    opts?: { silent?: boolean }
  ): void;
  undo(): boolean;
  redo(): boolean;
  focus(): void;
  blur(): void;
  runShortcut(key: string): boolean;
  /** 返回所有插件注册的命令（含内置）。 */
  getCommands(): EditorCommand[];
  /** 按 id 执行命令；找到并执行返回 true，否则 false。 */
  runCommand(id: string): boolean;
  /**
   * 是否处于输入法组合输入（IME composition）中。宿主在回灌文档前应先查询，
   * 避免在合成过程中调用 setDocument 打断输入。
   */
  isComposing(): boolean;
  destroy(): void;
  on<K extends keyof EditorEventMap>(event: K, handler: EditorEventMap[K]): void;
  off<K extends keyof EditorEventMap>(event: K, handler: EditorEventMap[K]): void;
  getCoordsAtPos(pos: number): { left: number; right: number; top: number; bottom: number } | null;
  /**
   * 返回某个 DOM 节点当前对应的文档偏移（基于 CodeMirror 的 DOM↔文档映射）。
   * 用于会被复用、平移的 live-preview widget（如图片）在事件发生时解析自身实时位置，
   * 而不是依赖渲染时捕获、可能因上方编辑而过期的固定 from/to。无法解析时返回 null。
   */
  getPosAtDOM(node: HTMLElement): number | null;
  getDocumentStats(): { characters: number; words: number; lines: number };
}

export interface SlashCommandDef {
  id: string;
  title: string;
  keywords?: string[];
  /**
   * Optional muted second line shown in the menu UI under the title.
   * Hosts that don't render a UI may ignore this field.
   */
  description?: string;
  /**
   * Optional execution hook invoked by the slash menu UI after the user
   * confirms this command. The trigger text (`/query`) is removed by the
   * UI before `run` is called, so commands can treat the caret as a
   * clean insertion point. Return value is currently advisory — the
   * menu always closes on confirm.
   *
   * Commands without `run` remain valid metadata entries; hosts that
   * keep their own id-to-action registry can dispatch via the menu UI's
   * `onCommand` override instead.
   */
  run?: (editor: EditorAPI) => boolean | void;
}

/** Canonical display mode for a widget. */
export type WidgetDisplayMode = "block" | "inline";

/** Canonical event-ownership policy for a widget. */
export type WidgetEventPolicy = "editor" | "widget";

/** A widget's source range plus the Markdown substring it renders over. */
export interface WidgetSourceRange {
  /** Absolute offset of the widget's source range start. */
  from: number;
  /** Absolute offset of the widget's source range end (exclusive). */
  to: number;
  /** The Markdown substring for `[from, to)`. */
  source: string;
}

/**
 * Context passed to a {@link WidgetDefinition}'s render function. Source-aware
 * widgets can read {@link WidgetRenderContext.range} and call
 * {@link WidgetRenderContext.enterEditMode} to reveal the underlying Markdown
 * instead of hand-rolling `setSelection(ctx.from) + focus()`.
 *
 * Existing render functions that ignore the third argument keep working.
 */
export interface WidgetRenderContext {
  /** Absolute offset of the widget's source range start. Equals `range.from`. */
  from: number;
  /** Absolute offset of the widget's source range end (exclusive). Equals `range.to`. */
  to: number;
  /** The widget's source range as `{ from, to, source }`. */
  range: WidgetSourceRange;
  /** Move the editor's selection. Defaults `head` to `anchor` (empty selection). */
  setSelection: (anchor: number, head?: number) => void;
  /** Focus the editor (call after `setSelection` so keyboard input lands there). */
  focus: () => void;
  /**
   * Enter raw-Markdown editing for this widget: move the selection to the
   * source-range start (default) or end, focus the editor, and let the host
   * reveal the underlying Markdown (the selection intersects the source range).
   * The offset is clamped to the document bounds, so a stale captured range
   * never throws. Replaces the manual `setSelection(ctx.from) + focus()` pattern.
   */
  enterEditMode: (position?: "start" | "end") => void;
}

export interface WidgetDefinition {
  nodeType: string;
  match?: (node: any) => boolean;
  render: (node: any, source: string, ctx?: WidgetRenderContext) => HTMLElement;
  destroy?: (element: HTMLElement) => void;
  /**
   * Canonical display mode. `"block"` replaces a whole-line range; `"inline"`
   * sits inside surrounding text. When set, it wins over the legacy `block`
   * alias; when omitted, falls back to `block !== false` (block by default).
   * `"block"` is only valid for node ranges that span whole lines — inline /
   * partial-line node types (e.g. `inlineMath`) must use `"inline"`.
   */
  display?: WidgetDisplayMode;
  /**
   * Canonical event-ownership policy. `"widget"` swallows DOM events so CM6
   * does not resolve a cursor inside the widget body (use for self-managed
   * interactive widgets); `"editor"` lets CM6 handle events normally. When
   * set, it wins over the legacy `ignoreEvents` alias; when omitted, falls
   * back to `ignoreEvents === true`.
   */
  eventPolicy?: WidgetEventPolicy;
  /**
   * Legacy-compatible alias — prefer {@link WidgetDefinition.display}. Still
   * fully supported, not removed: `block: false` ≡ `display: "inline"`;
   * omitted / `true` ≡ `display: "block"`. `display` takes precedence when
   * both are set.
   */
  block?: boolean;
  /**
   * Legacy-compatible alias — prefer {@link WidgetDefinition.eventPolicy}.
   * Still fully supported, not removed: `ignoreEvents: true` ≡
   * `eventPolicy: "widget"`; omitted / `false` ≡ `eventPolicy: "editor"`.
   * `eventPolicy` takes precedence when both are set.
   */
  ignoreEvents?: boolean;
}

/**
 * 命名命令——类似 Obsidian 的 `addCommand`。比 {@link NexusPlugin.shortcuts}
 * 更高层：带稳定 id 与可读 label，可由命令面板 / 菜单按 id 触发，并可选绑定快捷键。
 */
export interface EditorCommand {
  /** 稳定唯一标识，用于 {@link EditorAPI.runCommand}。 */
  id: string;
  /** 可读名称，供命令面板 / 菜单展示。 */
  label?: string;
  /** 执行体。返回 false 表示未消费（宿主可继续派发默认行为）。 */
  run: (editor: EditorAPI) => boolean | void;
  /** 可选 CodeMirror 快捷键绑定，如 "Mod-b"、"Ctrl-k"。 */
  hotkey?: string;
}

/**
 * 事件钩子上下文：传给 paste / drop / keydown 处理器，提供编辑器句柄与常用动作，
 * 不直接暴露 CodeMirror 内部对象，保持插件 API 稳定。
 */
export interface EditorEventContext {
  editor: EditorAPI;
  /** 在当前选区插入 markdown 文本（替换选区）。 */
  insertMarkdown: (markdown: string) => void;
  /** 走宿主配置的资源上传管线（{@link EditorConfig.onAssetUpload}）。 */
  uploadAsset: (file: File) => Promise<string | null>;
}

/**
 * 事件处理器：返回 `true` 表示已消费该事件——编辑器会阻止默认行为并停止把事件
 * 继续派发给后续处理器（含内置默认逻辑）。返回 `false`/`undefined` 表示放行。
 */
export type EditorEventHandler<E extends Event> = (event: E, ctx: EditorEventContext) => boolean | void;

/**
 * 插件可注册的 DOM 事件钩子。内置的图片粘贴 / 拖拽资源上传会作为兜底，在所有
 * 插件钩子都未消费时才执行，因此插件可覆盖默认行为。
 */
export interface EditorEventHandlers {
  paste?: EditorEventHandler<ClipboardEvent>;
  drop?: EditorEventHandler<DragEvent>;
  keydown?: EditorEventHandler<KeyboardEvent>;
}

export interface NexusPlugin {
  name: string;
  shortcuts?: Array<{ key: string; run: (editor: EditorAPI) => boolean }>;
  slashCommands?: SlashCommandDef[];
  /** 命名命令，见 {@link EditorCommand}。带 hotkey 的会自动注册快捷键。 */
  commands?: EditorCommand[];
  /** DOM 事件钩子，见 {@link EditorEventHandlers}。 */
  handlers?: EditorEventHandlers;
  remarkPlugins?: Array<Plugin<[], Root, Root>>;
  cmExtensions?: Extension[];
  widgets?: WidgetDefinition[];
}
