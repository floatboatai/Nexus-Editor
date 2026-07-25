import type {
  EditorAPI,
  EditorEventMap,
  LivePreviewConfig,
  NexusLocale,
  NexusPlugin,
  NexusTheme,
  ParserLike,
  SlashMenuState,
} from "@floatboat/nexus-core";
import type { Root } from "mdast";

/**
 * Attributes read once at connect time (initial-config parity with React/Vue).
 * Documentary only — deliberately NOT in `OBSERVED_ATTRIBUTES`, so the element
 * never advertises reactivity it does not implement.
 */
export const INITIAL_ONLY_ATTRIBUTES = [
  "initial-value",
  "read-only",
  "tab-size",
  "direction",
  "indent-guides",
  "live-preview",
  "multi-cursor",
  "slash-menu-limit",
  "parse-delay-ms",
] as const;

/** Attributes observed for reactivity after connect. */
export const REACTIVE_ATTRIBUTES = ["value"] as const;

export const OBSERVED_ATTRIBUTES = [...REACTIVE_ATTRIBUTES];

export interface NexusReadyDetail {
  editor: EditorAPI;
}

export interface NexusChangeDetail {
  doc: string;
  ast: Root;
}

export type NexusSelectionChangeDetail = Parameters<EditorEventMap["selectionChange"]>[0];
export type NexusSlashMenuChangeDetail = SlashMenuState;

export interface NexusEditorEventMap {
  "nexus-ready": CustomEvent<NexusReadyDetail>;
  "nexus-change": CustomEvent<NexusChangeDetail>;
  "nexus-focus": CustomEvent<null>;
  "nexus-blur": CustomEvent<null>;
  "nexus-selectionchange": CustomEvent<NexusSelectionChangeDetail>;
  "nexus-slashmenuchange": CustomEvent<NexusSlashMenuChangeDetail>;
}

/** JS-only properties: object/function-valued, no HTML attribute equivalent. */
export interface NexusEditorJsOnlyProps {
  plugins?: NexusPlugin[];
  parser?: ParserLike;
  theme?: NexusTheme;
  locale?: Partial<NexusLocale>;
  /**
   * Full live-preview config. Setting this overrides the `live-preview`
   * boolean attribute. Use the attribute for the common on/off case and this
   * property when custom renderers/labels are needed.
   */
  livePreview?: boolean | LivePreviewConfig;
  onAssetUpload?: (file: File) => Promise<string | null>;
}
