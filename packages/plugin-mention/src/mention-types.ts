/**
 * @mention plugin type definitions.
 */

import type { EditorAPI } from "@floatboat/nexus-core";

export interface MentionItem {
  id: string;
  name: string;
  avatar?: string;
  description?: string;
}

export type MentionMenuDirection = "previous" | "next";

export interface MentionMenuState {
  isOpen: boolean;
  query: string;
  items: MentionItem[];
  selectedIndex: number;
  coords: { left: number; top: number; bottom: number } | null;
}

export type MentionQueryFn = (query: string) => Promise<MentionItem[]> | MentionItem[];

export interface MentionInsertFormat {
  (item: MentionItem): string;
}

export interface MentionRenderItemFn {
  (item: MentionItem, selected: boolean): HTMLElement | string;
}

export interface MentionPluginConfig {
  trigger?: string;
  query: MentionQueryFn;
  limit?: number;
  minQueryLength?: number;
  debounceMs?: number;
  flip?: boolean;
  closeOnBlur?: boolean;
  renderItem?: MentionRenderItemFn;
  insertFormat?: MentionInsertFormat;
}

export interface MentionViewState {
  open: boolean;
  triggerPos: number;
  query: string;
  items: MentionItem[];
  selectedIndex: number;
  coords: { left: number; top: number; bottom: number } | null;
  abortController: AbortController | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface MentionMdastNode {
  type: "mention";
  id: string;
  name: string;
  avatar?: string;
}

export interface MentionWidgetContext {
  node: MentionMdastNode;
  source: string;
  from: number;
  to: number;
  setSelection: (anchor: number, head?: number) => void;
  focus: () => void;
}
