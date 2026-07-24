import { NexusEditorElement } from "./element";

export { NexusEditorElement } from "./element";
export type {
  NexusChangeDetail,
  NexusEditorEventMap,
  NexusEditorJsOnlyProps,
  NexusReadyDetail,
  NexusSelectionChangeDetail,
  NexusSlashMenuChangeDetail,
} from "./types";

import type { NexusEditorEventMap } from "./types";

declare global {
  interface HTMLElementTagNameMap {
    "nexus-editor": NexusEditorElement;
  }

  interface HTMLElementEventMap extends NexusEditorEventMap {}
}

/**
 * Registers `NexusEditorElement` as a custom element. Safe to call more than
 * once with the same constructor and tag name.
 */
export function defineNexusEditor(tagName = "nexus-editor"): void {
  if (typeof customElements === "undefined") return;
  const existing = customElements.get(tagName);
  if (existing === NexusEditorElement) return;
  if (existing) {
    throw new Error(`Custom element "${tagName}" is already registered with a different constructor.`);
  }
  customElements.define(tagName, NexusEditorElement);
}
