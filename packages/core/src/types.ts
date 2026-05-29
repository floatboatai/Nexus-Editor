     1|import type { Extension } from "@codemirror/state";
     2|import type { Blockquote, Code, Definition, Delete, Emphasis, FootnoteDefinition, FootnoteReference, Heading, Html, Image, InlineCode, Link, List, Root, Strong, Table, ThematicBreak } from "mdast";
     3|import type { Plugin } from "unified";
     4|
     5|export interface CodeHighlightToken {
     6|  /** Absolute offset in the source markdown (beginning of the highlighted span). */
     7|  from: number;
     8|  /** Absolute offset at end (exclusive). */
     9|  to: number;
    10|  /** Space-separated hljs class list, e.g. "hljs-keyword" or "hljs-string hljs-regexp". */
    11|  className: string;
    12|}
    13|
    14|export interface ParseResult {
    15|  ast: Root;
    16|  /** Pre-computed syntax-highlight spans for fenced code blocks. */
    17|  codeTokens?: CodeHighlightToken[];
    18|}
    19|
    20|export interface ParserLike {
    21|  parse(markdown: string): Root;
    22|  /**
    23|   * Optional async parser — when provided, live-preview offloads parsing +
    24|   * code-block highlighting to this (typically a Web Worker). The sync
    25|   * `parse` remains as a fallback path (used while the worker is warming up
    26|   * or for out-of-band callers like exportHTML).
    27|   */
    28|  parseAsync?(markdown: string): Promise<ParseResult>;
    29|}
    30|
    31|export type LivePreviewNode =
    32|  | Blockquote
    33|  | Code
    34|  | Definition
    35|  | Delete
    36|  | Emphasis
    37|  | FootnoteDefinition
    38|  | FootnoteReference
    39|  | Heading
    40|  | Html
    41|  | Image
    42|  | InlineCode
    43|  | Link
    44|  | List
    45|  | Strong
    46|  | Table
    47|  | ThematicBreak;
    48|
    49|export type LivePreviewNodeType = LivePreviewNode["type"];
    50|
    51|export interface LivePreviewRenderContext {
    52|  node: LivePreviewNode;
    53|  nodeType: LivePreviewNodeType;
    54|  source: string;
    55|  text: string;
    56|  /** Absolute offset of the node's start in the document. */
    57|  from: number;
    58|  /** Absolute offset of the node's end in the document. */
    59|  to: number;
    60|}
    61|
    62|export type LivePreviewRenderer = (context: LivePreviewRenderContext) => HTMLElement;
    63|
    64|export interface LivePreviewLabels {
    65|  addColumn?: string;
    66|  addRow?: string;
    67|  deleteColumn?: string;
    68|  deleteRow?: string;
    69|  insertColumnAfter?: string;
    70|  insertRowBelow?: string;
    71|}
    72|
    73|export interface LivePreviewConfig {
    74|  enabled?: boolean;
    75|  renderers?: Partial<Record<LivePreviewNodeType, LivePreviewRenderer>>;
    76|  labels?: LivePreviewLabels;
    77|}
    78|
    79|export interface EditorConfig {
    80|  container: HTMLElement;
    81|  initialValue?: string;
    82|  parser?: ParserLike;
    83|  parseDelayMs?: number;
    84|  livePreview?: boolean | LivePreviewConfig;
    85|  plugins?: NexusPlugin[];
    86|  theme?: import("./theme").NexusTheme;
    87|  locale?: Partial<import("./locale").NexusLocale>;
    88|  /** Tab size in spaces. Default: 4 */
    89|  tabSize?: number;
    90|  /** Text direction. Default: "ltr" */
    91|  direction?: "ltr" | "rtl";
    92|  /** Show indentation guide lines. Default: false */
    93|  indentGuides?: boolean;
    94|  /** Prevent user edits while preserving selection and scrolling. Default: false */
    95|  readOnly?: boolean;
    96|  /**
    97|   * Maximum number of slash-menu entries emitted on `slashMenuChange`
    98|   * after ranking. Default: 8. A limit of 0 keeps the menu state open
    99|   * but emits an empty command list (useful for "no results" UIs).
   100|   */
   101|  slashMenuLimit?: number;
   102|  onChange?: (doc: string, ast: Root) => void;
   103|  onFocus?: () => void;
   104|  onBlur?: () => void;
   105|  onAssetUpload?: (file: File) => Promise<string>;
   106|}
   107|
   108|export interface SlashMenuState {
   109|  isOpen: boolean;
   110|  from: number | null;
   111|  to: number | null;
   112|  query: string;
   113|  commands: SlashCommandDef[];
   114|  coords: { left: number; top: number; bottom: number } | null;
   115|}
   116|
   117|export interface EditorEventMap {
   118|  change: (doc: string, ast: Root) => void;
   119|  focus: () => void;
   120|  blur: () => void;
   121|  selectionChange: (selection: { anchor: number; head: number }) => void;
   122|  slashMenuChange: (state: SlashMenuState) => void;
   123|}
   124|
   125|export interface TocEntry {
   126|  level: number;
   127|  text: string;
   128|  from: number;
   129|  to: number;
   130|}
   131|
   132|export interface EditorAPI {
   133|  getDocument(): string;
   134|  getAst(): Root;
   135|  getTableOfContents(): TocEntry[];
   136|  exportHTML(): string;
   137|  setTheme(theme: import("./theme").NexusTheme): void;
   138|  getSelection(): { anchor: number; head: number };
   139|  getSlashCommands(): SlashCommandDef[];
   140|  uploadAsset(file: File): Promise<string | null>;
   141|  setSelection(anchor: number, head?: number): void;
   142|  /**
   143|   * Replace the document content.
   144|   *
   145|   * @param opts.silent  When true, skip the onChange pipeline. Use when
   146|   *   loading a file from disk — avoids treating a file-open as a user
   147|   *   edit (no redundant mdast parse / link-index rebuild).
   148|   */
   149|  setDocument(next: string, opts?: { silent?: boolean }): void;
   150|  replaceSelection(text: string): void;
   151|  undo(): boolean;
   152|  redo(): boolean;
   153|  focus(): void;
   154|  blur(): void;
   155|  runShortcut(key: string): boolean;
   156|  destroy(): void;
   157|  on<K extends keyof EditorEventMap>(event: K, handler: EditorEventMap[K]): void;
   158|  off<K extends keyof EditorEventMap>(event: K, handler: EditorEventMap[K]): void;
   159|  getCoordsAtPos(pos: number): { left: number; right: number; top: number; bottom: number } | null;
   160|  getDocumentStats(): { characters: number; words: number; lines: number };
   161|}
   162|
   163|export interface SlashCommandDef {
   164|  id: string;
   165|  title: string;
   166|  keywords?: string[];
   167|  /**
   168|   * Optional muted second line shown in the menu UI under the title.
   169|   * Hosts that don't render a UI may ignore this field.
   170|   */
   171|  description?: string;
   172|  /**
   173|   * Optional execution hook invoked by the slash menu UI after the user
   174|   * confirms this command. The trigger text (`/query`) is removed by the
   175|   * UI before `run` is called, so commands can treat the caret as a
   176|   * clean insertion point. Return value is currently advisory — the
   177|   * menu always closes on confirm.
   178|   *
   179|   * Commands without `run` remain valid metadata entries; hosts that
   180|   * keep their own id-to-action registry can dispatch via the menu UI's
   181|   * `onCommand` override instead.
   182|   */
   183|  run?: (editor: EditorAPI) => boolean | void;
   184|}
   185|
   186|/**
   187| * Context passed to a {@link WidgetDefinition}'s render function. Widgets that
   188| * want an "enter edit mode" affordance (a ✎ button overlay, etc.) can use
   189| * `from` + `setSelection` to dispatch the cursor into the source range,
   190| * which makes the host re-render the range as raw markdown.
   191| *
   192| * Existing render functions that ignore the third argument keep working.
   193| */
   194|export interface WidgetRenderContext {
   195|  /** Absolute offset of the widget's source range start. */
   196|  from: number;
   197|  /** Absolute offset of the widget's source range end (exclusive). */
   198|  to: number;
   199|  /** Move the editor's selection. Defaults `head` to `anchor` (empty selection). */
   200|  setSelection: (anchor: number, head?: number) => void;
   201|  /** Focus the editor (call after `setSelection` so keyboard input lands there). */
   202|  focus: () => void;
   203|  /**
   204|   * Acquire an interaction guard. While any guard is active, the widget's
   205|   * decoration will not be rebuilt — CM6 maps existing decorations via
   206|   * `decos.map(tr.changes)` instead. This prevents the widget DOM from
   207|   * being destroyed mid-interaction (e.g., during a drag or cell edit).
   208|   */
   209|  acquireGuard: (type: InteractionGuardType) => void;
   210|  /**
   211|   * Release an interaction guard. When all guards for a widget are released,
   212|   * the next transaction will rebuild decorations normally.
   213|   */
   214|  releaseGuard: (type: InteractionGuardType) => void;
   215|  /**
   216|   * Release all active interaction guards for this widget at once.
   217|   * Used during cleanup (e.g., when the widget is destroyed) to prevent
   218|   * leaked guards from blocking decoration rebuilds.
   219|   */
   220|  releaseAllGuards: () => void;
   221|}
   222|
   223|/**
   224| * Types of interaction that a widget can protect from decoration rebuilds.
   225| * - `focus`: User is editing content inside the widget (e.g., contentEditable cell)
   226| * - `drag`: User is dragging an element inside the widget (e.g., column grip)
   227| * - `range`: User is selecting a range of elements (e.g., multi-cell selection)
   228| */
   229|export type InteractionGuardType = 'focus' | 'drag' | 'range';
   230|
   231|/**
   232| * Declares an interaction guard for a widget. When acquired, the widget's
   233| * decoration will not be rebuilt until the guard is released.
   234| */
   235|export interface InteractionGuard {
   236|  type: InteractionGuardType;
   237|  /** Called when the guard should be acquired (e.g., on mousedown). */
   238|  acquire: (dom: HTMLElement) => void;
   239|  /** Called when the guard should be released (e.g., on mouseup/blur). */
   240|  release: (dom: HTMLElement) => void;
   241|}
   242|
   243|export interface WidgetDefinition {
   244|  nodeType: string;
   245|  match?: (node: any) => boolean;
   246|  render: (node: any, source: string, ctx?: WidgetRenderContext) => HTMLElement;
   247|  destroy?: (element: HTMLElement) => void;
   248|  /**
   249|   * Whether the widget replaces a block-level range (occupies its own line)
   250|   * or an inline range (sits inside surrounding text). Defaults to `true`
   251|   * for backwards compatibility, but inline node types like `inlineMath`
   252|   * must set this to `false` or they'll be hoisted onto their own line.
   253|   */
   254|  block?: boolean;
   255|  /**
   256|   * When `true`, the widget swallows mouse / keyboard events so CM6 doesn't
   257|   * try to resolve a cursor position inside the widget body. Use this when
   258|   * the widget renders its own interactive affordances (an edit button, a
   259|   * checkbox, etc.) and exposes its own entry into edit mode. Default
   260|   * `false` — events bubble through and CM6 places the cursor normally.
   261|   */
   262|  ignoreEvents?: boolean;
   263|  /**
   264|   * Declares which interaction types this widget needs protection for.
   265|   * When any guard is active, the widget's StateField skips decoration
   266|   * rebuilds and uses `decos.map(tr.changes)` instead.
   267|   */
   268|  interactionGuards?: InteractionGuard[];
   269|}
   270|
   271|export interface NexusPlugin {
   272|  name: string;
   273|  shortcuts?: Array<{ key: string; run: (editor: EditorAPI) => boolean }>;
   274|  slashCommands?: SlashCommandDef[];
   275|  remarkPlugins?: Array<Plugin<[], Root, Root>>;
   276|  cmExtensions?: Extension[];
   277|  widgets?: WidgetDefinition[];
   278|}
   279|