import type { Extension } from "@codemirror/state";
import type { Blockquote, Code, Definition, Delete, Emphasis, FootnoteDefinition, FootnoteReference, Heading, Image, InlineCode, Link, List, Root, Strong, Table, ThematicBreak } from "mdast";
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
  onAssetUpload?: (file: File) => Promise<string>;
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
  change: (doc: string, ast: Root) => void;
  focus: () => void;
  blur: () => void;
  selectionChange: (selection: { anchor: number; head: number }) => void;
  slashMenuChange: (state: SlashMenuState) => void;
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
   */
  setDocument(next: string, opts?: { silent?: boolean }): void;
  replaceSelection(text: string): void;
  undo(): boolean;
  redo(): boolean;
  focus(): void;
  blur(): void;
  runShortcut(key: string): boolean;
  destroy(): void;
  on<K extends keyof EditorEventMap>(event: K, handler: EditorEventMap[K]): void;
  off<K extends keyof EditorEventMap>(event: K, handler: EditorEventMap[K]): void;
  getCoordsAtPos(pos: number): { left: number; right: number; top: number; bottom: number } | null;
  getDocumentStats(): { characters: number; words: number; lines: number };
}

export interface SlashCommandDef {
  id: string;
  title: string;
  keywords?: string[];
  description?: string;
  run?: (editor: EditorAPI) => boolean | void;
  priority?: number;
}

export interface WidgetDefinition {
  nodeType: string;
  match?: (node: any) => boolean;
  render: (node: any, source: string) => HTMLElement;
  destroy?: (element: HTMLElement) => void;
}

export interface NexusPlugin {
  name: string;
  shortcuts?: Array<{ key: string; run: (editor: EditorAPI) => boolean }>;
  slashCommands?: SlashCommandDef[];
  remarkPlugins?: Array<Plugin<[], Root, Root>>;
  cmExtensions?: Extension[];
  widgets?: WidgetDefinition[];
}
