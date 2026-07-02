export { createEditor } from "./editor";
export { createPluginBus, type PluginBus, type PluginBusSubscription } from "./plugin-bus";
export {
  computeLineDiff,
  createMemorySnapshotStorage,
  type DiffHunk,
  type Snapshot,
  type SnapshotMetadata,
  type SnapshotStorage,
} from "./snapshot";
export {
  createMemoryVault,
  type NoteVault,
  type VaultEntry,
  type VaultWatchEvent,
} from "./vault";
export { createWidget, createWidgetExtension } from "./widget-extension";
export { markdownAutoPair } from "./markdown-autopair";
export { markdownFold, markdownFoldService } from "./markdown-fold";
export { markdownKeymap, handleMarkdownEnter } from "./markdown-keymap";
export {
  addCursorAbove,
  addCursorBelow,
  collapseToMainSelection,
  multiCursorExtension,
  multiCursorKeymap,
  selectNextOccurrence,
} from "./multi-cursor";
export { enLocale, zhLocale, resolveLocale, type NexusLocale } from "./locale";
export {
  computeSlashState,
  filterSlashCommands,
  getSlashMatch,
  type SlashMatch,
  type SlashStateOptions,
  type SlashStateResult,
} from "./slash-state";
export { lightTheme, darkTheme, type NexusTheme } from "./theme";
export {
  scanWikiLinks,
  createWikilinksExtension,
  createWikilinksPlugin,
  type WikiLinkMatch,
  type WikilinksOptions,
  type WikiLinkNavigateOptions,
} from "./wikilinks";
export type {
  CodeHighlightToken,
  EditorAPI,
  EditorCommand,
  EditorConfig,
  EditorEventContext,
  EditorEventHandler,
  EditorEventHandlers,
  EditorEventMap,
  EditorSelectionRange,
  LivePreviewConfig,
  LivePreviewLabels,
  LivePreviewNode,
  LivePreviewNodeType,
  LivePreviewRenderContext,
  LivePreviewRenderer,
  NexusPlugin,
  ParseResult,
  ParserLike,
  ScrollState,
  SelectionRangeJSON,
  SelectionState,
  SlashCommandDef,
  SlashMenuState,
  SetDocumentOptions,
  TocEntry,
  WidgetDefinition,
  WidgetLifecycle,
  WidgetRenderContext
} from "./types";
