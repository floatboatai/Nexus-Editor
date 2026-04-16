import type { Extension } from "@codemirror/state";
import type { Blockquote, Delete, Heading, Image, InlineCode, Link, Root, Strong, Emphasis, ThematicBreak } from "mdast";
import type { Plugin } from "unified";

export interface ParserLike {
  parse(markdown: string): Root;
}

export type LivePreviewNode =
  | Blockquote
  | Delete
  | Emphasis
  | Heading
  | Image
  | InlineCode
  | Link
  | Strong
  | ThematicBreak;

export type LivePreviewNodeType = LivePreviewNode["type"];

export interface LivePreviewRenderContext {
  node: LivePreviewNode;
  nodeType: LivePreviewNodeType;
  source: string;
  text: string;
}

export type LivePreviewRenderer = (context: LivePreviewRenderContext) => HTMLElement;

export interface LivePreviewConfig {
  enabled?: boolean;
  renderers?: Partial<Record<LivePreviewNodeType, LivePreviewRenderer>>;
}

export interface EditorConfig {
  container: HTMLElement;
  initialValue?: string;
  parser?: ParserLike;
  parseDelayMs?: number;
  livePreview?: boolean | LivePreviewConfig;
  plugins?: NexusPlugin[];
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

export interface EditorAPI {
  getDocument(): string;
  getAst(): Root;
  getSelection(): { anchor: number; head: number };
  getSlashCommands(): SlashCommandDef[];
  uploadAsset(file: File): Promise<string | null>;
  setSelection(anchor: number, head?: number): void;
  setDocument(next: string): void;
  replaceSelection(text: string): void;
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
