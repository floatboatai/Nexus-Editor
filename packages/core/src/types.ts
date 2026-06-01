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

export interface EditorEventMap {
  /** Fired (debounced) when the document content changes. */
  change: (doc: string, ast: Root) => void;
  focus: () => void;
  blur: () => void;
  selectionChange: (selection: { anchor: number; head: number }) => void;
  slashMenuChange: (state: SlashMenuState) => void;
  // ── New lifecycle / DOM events ──────────────────────────────────────
  /** Fired once after the editor is fully initialised and the view is mounted. */
  editorReady: () => void;
  /** Fired on every paste event (before the default handler). */
  paste: (event: ClipboardEvent) => void;
  /** Fired on every drop event (before the default handler). */
  drop: (event: DragEvent) => void;
  /** Fired on every keydown event (before the default handler). */
  keydown: (event: KeyboardEvent) => void;
  /** Fired after the theme is changed via `setTheme()`. */
  themeChange: (theme: import("./theme").NexusTheme) => void;
  /**
   * Fired before a `change` event is emitted. Return `false` in a
   * listener to prevent downstream consumers from receiving `change`.
   * Note: the document has already been modified at this point.
   */
  beforeChange: (ctx: { doc: string; ast: Root }) => void;
  /** Fired before `setDocument()` replaces the content. */
  beforeSetDocument: (ctx: { next: string; silent: boolean }) => void;
  /** Fired when the editor is being destroyed. */
  destroy: () => void;
  /**
   * Fired when an internal error occurs (e.g. a plugin hook throws).
   * Listeners can inspect the error for logging / telemetry.
   */
  error: (error: Error, source?: string) => void;
}

export interface TocEntry {
  level: number;
  text: string;
  from: number;
  to: number;
}

export interface EditorAPI {
  getDocument(): string;
  getAst(): Root;
  getTableOfContents(): TocEntry[];
  exportHTML(): string;
  setTheme(theme: import("./theme").NexusTheme): void;
  getSelection(): { anchor: number; head: number };
  getSlashCommands(): SlashCommandDef[];
  uploadAsset(file: File): Promise<string | null>;
  setSelection(anchor: number, head?: number): void;
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
  setDocument(next: string, opts?: { silent?: boolean }): void;
  replaceSelection(text: string): void;
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
  // ── New: dynamic plugin management ──────────────────────────────────
  /**
   * Register a plugin at runtime. Returns `false` if a plugin with the
   * same name is already registered.
   */
  addPlugin(plugin: NexusPlugin): boolean;
  /**
   * Unregister a plugin by name. Returns `false` if no plugin with that
   * name is registered. Fires `onDestroy` on the removed plugin.
   */
  removePlugin(name: string): boolean;
  /**
   * Check whether a plugin is currently registered.
   */
  hasPlugin(name: string): boolean;
  // ── End new ─────────────────────────────────────────────────────────
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

/**
 * Context passed to a {@link WidgetDefinition}'s render function. Widgets that
 * want an "enter edit mode" affordance (a ✎ button overlay, etc.) can use
 * `from` + `setSelection` to dispatch the cursor into the source range,
 * which makes the host re-render the range as raw markdown.
 *
 * Existing render functions that ignore the third argument keep working.
 */
export interface WidgetRenderContext {
  /** Absolute offset of the widget's source range start. */
  from: number;
  /** Absolute offset of the widget's source range end (exclusive). */
  to: number;
  /** Move the editor's selection. Defaults `head` to `anchor` (empty selection). */
  setSelection: (anchor: number, head?: number) => void;
  /** Focus the editor (call after `setSelection` so keyboard input lands there). */
  focus: () => void;
}

export interface WidgetDefinition {
  nodeType: string;
  match?: (node: any) => boolean;
  render: (node: any, source: string, ctx?: WidgetRenderContext) => HTMLElement;
  destroy?: (element: HTMLElement) => void;
  /**
   * Whether the widget replaces a block-level range (occupies its own line)
   * or an inline range (sits inside surrounding text). Defaults to `true`
   * for backwards compatibility, but inline node types like `inlineMath`
   * must set this to `false` or they'll be hoisted onto their own line.
   */
  block?: boolean;
  /**
   * When `true`, the widget swallows mouse / keyboard events so CM6 doesn't
   * try to resolve a cursor position inside the widget body. Use this when
   * the widget renders its own interactive affordances (an edit button, a
   * checkbox, etc.) and exposes its own entry into edit mode. Default
   * `false` — events bubble through and CM6 places the cursor normally.
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
  // ── 插件生命周期钩子（Plugin Lifecycle Hooks）───────────────────────
  /**
   * 编辑器初始化完成后触发。此时 EditorAPI 已就绪，可安全调用 getDocument() 等。
   * 异步（返回 Promise）时不会阻塞编辑器启动。
   */
  onEditorReady?: (editor: EditorAPI) => void | Promise<void>;
  /**
   * 在 change 事件对外派发前触发。返回 false 可阻止 change 事件向外发送（但不阻止文档变更本身）。
   */
  onBeforeChange?: (ctx: {
    doc: string;
    ast: Root;
  }) => boolean | void;
  /**
   * change 事件对外派发后触发。
   */
  onAfterChange?: (ctx: { doc: string; ast: Root }) => void;
  /**
   * 在 setDocument 替换文档内容前触发。返回 false 可阻止替换。
   */
  onBeforeSetDocument?: (ctx: {
    next: string;
    silent: boolean;
  }) => boolean | void;
  /** 编辑器销毁时触发。用于清理插件资源（定时器、DOM 节点、事件监听）。 */
  onDestroy?: (editor: EditorAPI) => void;
  /** 选区变化时触发。 */
  onSelectionChange?: (ctx: {
    anchor: number;
    head: number;
  }) => void;
}
