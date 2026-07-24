import { createEditor } from "@floatboat/nexus-core";
import type {
  EditorAPI,
  EditorConfig,
  LivePreviewConfig,
  NexusLocale,
  NexusPlugin,
  NexusTheme,
  ParserLike,
} from "@floatboat/nexus-core";

import { isControlledDocument, resolveInitialDocument, shouldSyncControlledDocument } from "./controlled-document";
import {
  OBSERVED_ATTRIBUTES,
  type NexusChangeDetail,
  type NexusReadyDetail,
  type NexusSelectionChangeDetail,
  type NexusSlashMenuChangeDetail,
} from "./types";

function readNumberAttribute(element: Element, name: string): number | undefined {
  const raw = element.getAttribute(name);
  if (raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const PRE_UPGRADE_PROPERTIES = [
  "value",
  "plugins",
  "parser",
  "theme",
  "locale",
  "livePreview",
  "onAssetUpload",
  "readOnly",
  "multiCursor",
] as const;

/**
 * Framework-agnostic Web Component wrapper around `@floatboat/nexus-core`.
 *
 * Only `value` (and the `value` attribute) is reactive after the element has
 * connected — every other attribute/property is read once at connect time,
 * matching `packages/react`'s mount-only `useEditor` creation effect. See
 * `openspec/changes/add-wc-wrapper/design.md` for the rationale.
 */
export class NexusEditorElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRIBUTES];
  }

  private container: HTMLDivElement | null = null;
  private _editor: EditorAPI | null = null;
  private connectedOnce = false;
  private propertiesUpgraded = false;
  private disconnectRevision = 0;
  private restoringValueAttribute = false;

  private _hasValue = false;
  private _value: string | undefined;
  private lastSyncedDoc: string | null = null;

  private _plugins: NexusPlugin[] | undefined;
  private _parser: ParserLike | undefined;
  private _theme: NexusTheme | undefined;
  private _locale: Partial<NexusLocale> | undefined;
  private _livePreview: boolean | LivePreviewConfig | undefined;
  private _onAssetUpload: ((file: File) => Promise<string | null>) | undefined;

  get editor(): EditorAPI | null {
    return this._editor;
  }

  get value(): string | undefined {
    return this._value;
  }

  set value(next: string | undefined) {
    this._hasValue = isControlledDocument(next);
    this._value = next ?? undefined;
    this.syncControlledValue();
  }

  get plugins(): NexusPlugin[] | undefined {
    return this._plugins;
  }

  set plugins(next: NexusPlugin[] | undefined) {
    this._plugins = next;
  }

  get parser(): ParserLike | undefined {
    return this._parser;
  }

  set parser(next: ParserLike | undefined) {
    this._parser = next;
  }

  get theme(): NexusTheme | undefined {
    return this._theme;
  }

  set theme(next: NexusTheme | undefined) {
    this._theme = next;
  }

  get locale(): Partial<NexusLocale> | undefined {
    return this._locale;
  }

  set locale(next: Partial<NexusLocale> | undefined) {
    this._locale = next;
  }

  get livePreview(): boolean | LivePreviewConfig | undefined {
    return this._livePreview;
  }

  set livePreview(next: boolean | LivePreviewConfig | undefined) {
    this._livePreview = next;
  }

  get onAssetUpload(): ((file: File) => Promise<string | null>) | undefined {
    return this._onAssetUpload;
  }

  set onAssetUpload(next: ((file: File) => Promise<string | null>) | undefined) {
    this._onAssetUpload = next;
  }

  get readOnly(): boolean {
    return this.hasAttribute("read-only");
  }

  set readOnly(next: boolean) {
    this.toggleAttribute("read-only", next);
  }

  get multiCursor(): boolean {
    return this.hasAttribute("multi-cursor");
  }

  set multiCursor(next: boolean) {
    this.toggleAttribute("multi-cursor", next);
  }

  private upgradePredefinedProperties(): void {
    if (this.propertiesUpgraded) return;
    this.propertiesUpgraded = true;

    const element = this as unknown as Record<string, unknown>;
    for (const name of PRE_UPGRADE_PROPERTIES) {
      if (!Object.prototype.hasOwnProperty.call(this, name)) continue;
      const value = element[name];
      delete element[name];
      element[name] = value;
    }
  }

  private syncControlledValue(restoreAttribute = false): void {
    if (!this._editor || !this._hasValue || this._value === undefined) return;
    if (!shouldSyncControlledDocument(this._value, this.lastSyncedDoc)) return;
    const nextValue = this._value;
    this._editor.setDocument(nextValue, { silent: true });
    // A table edit flush can emit synchronously from setDocument. A controlled
    // listener may write that older document back into `value` reentrantly;
    // the outer, newer assignment must remain authoritative after the replace.
    this._hasValue = true;
    this._value = nextValue;
    this.lastSyncedDoc = nextValue;
    if (restoreAttribute && this.getAttribute("value") !== nextValue) {
      this.restoringValueAttribute = true;
      try {
        this.setAttribute("value", nextValue);
      } finally {
        this.restoringValueAttribute = false;
      }
    }
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (name !== "value" || oldValue === newValue || this.restoringValueAttribute) return;
    this._hasValue = newValue !== null;
    this._value = newValue ?? undefined;
    this.syncControlledValue(true);
  }

  connectedCallback(): void {
    this.upgradePredefinedProperties();
    this.disconnectRevision += 1;
    if (this.connectedOnce) return;
    this.connectedOnce = true;

    const container = document.createElement("div");
    this.appendChild(container);
    this.container = container;

    const initialValue = resolveInitialDocument(
      this._hasValue ? this._value : undefined,
      this.getAttribute("initial-value")
    );

    const config: EditorConfig = {
      container,
      initialValue,
      parser: this._parser,
      parseDelayMs: readNumberAttribute(this, "parse-delay-ms"),
      livePreview: this._livePreview ?? this.hasAttribute("live-preview"),
      plugins: this._plugins ?? [],
      theme: this._theme,
      locale: this._locale,
      tabSize: readNumberAttribute(this, "tab-size"),
      direction: this.getAttribute("direction") === "rtl" ? "rtl" : undefined,
      indentGuides: this.hasAttribute("indent-guides"),
      readOnly: this.hasAttribute("read-only"),
      multiCursor: this.hasAttribute("multi-cursor"),
      slashMenuLimit: readNumberAttribute(this, "slash-menu-limit"),
      onChange: (doc, ast) => {
        this.lastSyncedDoc = doc;
        this.dispatchEvent(
          new CustomEvent<NexusChangeDetail>("nexus-change", {
            detail: { doc, ast },
            bubbles: true,
            composed: true,
          })
        );
      },
      onFocus: () => {
        this.dispatchEvent(new CustomEvent("nexus-focus", { detail: null, bubbles: true, composed: true }));
      },
      onBlur: () => {
        this.dispatchEvent(new CustomEvent("nexus-blur", { detail: null, bubbles: true, composed: true }));
      },
      onAssetUpload: this._onAssetUpload,
    };

    let editor: EditorAPI;
    try {
      editor = createEditor(config);
    } catch (error) {
      this.connectedOnce = false;
      container.remove();
      this.container = null;
      throw error;
    }
    this._editor = editor;
    this.lastSyncedDoc = initialValue;

    editor.on("selectionChange", (selection) => {
      this.dispatchEvent(
        new CustomEvent<NexusSelectionChangeDetail>("nexus-selectionchange", {
          detail: selection,
          bubbles: true,
          composed: true,
        })
      );
    });

    editor.on("slashMenuChange", (state) => {
      this.dispatchEvent(
        new CustomEvent<NexusSlashMenuChangeDetail>("nexus-slashmenuchange", {
          detail: state,
          bubbles: true,
          composed: true,
        })
      );
    });

    this.dispatchEvent(new CustomEvent<NexusReadyDetail>("nexus-ready", {
      detail: { editor },
      bubbles: true,
      composed: true,
    }));
  }

  disconnectedCallback(): void {
    if (!this.connectedOnce) return;
    const revision = ++this.disconnectRevision;

    queueMicrotask(() => {
      // Synchronous DOM reparenting fires disconnectedCallback followed by
      // connectedCallback. Keep the live editor in that case so uncontrolled
      // edits are not replaced by the original initial-value.
      if (this.isConnected || revision !== this.disconnectRevision) return;

      this.connectedOnce = false;
      try {
        this._editor?.destroy();
      } finally {
        this._editor = null;
        this.lastSyncedDoc = null;
        this.container?.remove();
        this.container = null;
      }
    });
  }
}
