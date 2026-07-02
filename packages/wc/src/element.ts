import { createEditor } from "@floatboat/nexus-core";
import type {
  EditorAPI,
  EditorConfig,
  LivePreviewConfig,
  NexusLocale,
  NexusPlugin,
  NexusTheme,
  ParserLike
} from "@floatboat/nexus-core";
import type { Root } from "mdast";

import { readAttributeConfig } from "./attributes";
import { shouldSyncControlledDocument } from "./controlled-document";

export interface NexusReadyDetail {
  editor: EditorAPI;
}

export interface NexusChangeDetail {
  markdown: string;
  ast: Root;
}

/**
 * Config that HTML attributes cannot express (objects and functions).
 * Exposed as element properties; an explicitly set property overrides the
 * matching attribute because a property assignment is an imperative act by
 * the host while an attribute is declarative markup.
 */
interface RichConfig {
  plugins?: NexusPlugin[];
  parser?: ParserLike;
  theme?: NexusTheme;
  locale?: Partial<NexusLocale>;
  livePreview?: boolean | LivePreviewConfig;
  onAssetUpload?: (file: File) => Promise<string | null>;
}

const OBSERVED_ATTRIBUTES = [
  "value",
  "readonly",
  "direction",
  "tab-size",
  "indent-guides",
  "parse-delay-ms",
  "slash-menu-limit",
  "live-preview",
  "multi-cursor"
] as const;

export class NexusEditorElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRIBUTES];
  }

  #editor: EditorAPI | null = null;
  #lastSyncedDoc: string | null = null;
  /** Document captured at destroy time so re-insertion restores the text. */
  #pendingDocument: string | null = null;
  #rich: RichConfig = {};
  #rebuildQueued = false;
  #focused = false;

  /** Escape hatch to the live core API. `null` while disconnected. */
  get editor(): EditorAPI | null {
    return this.#editor;
  }

  get value(): string {
    if (this.#editor) {
      return this.#editor.getDocument();
    }
    return this.#pendingDocument ?? this.getAttribute("value") ?? "";
  }

  set value(next: string) {
    if (this.#editor) {
      this.#syncDocument(next);
    } else {
      this.#pendingDocument = next;
    }
  }

  get plugins(): NexusPlugin[] | undefined {
    return this.#rich.plugins;
  }

  set plugins(next: NexusPlugin[] | undefined) {
    this.#setRich("plugins", next);
  }

  get parser(): ParserLike | undefined {
    return this.#rich.parser;
  }

  set parser(next: ParserLike | undefined) {
    this.#setRich("parser", next);
  }

  get theme(): NexusTheme | undefined {
    return this.#rich.theme;
  }

  set theme(next: NexusTheme | undefined) {
    this.#setRich("theme", next);
  }

  get locale(): Partial<NexusLocale> | undefined {
    return this.#rich.locale;
  }

  set locale(next: Partial<NexusLocale> | undefined) {
    this.#setRich("locale", next);
  }

  get livePreview(): boolean | LivePreviewConfig | undefined {
    return this.#rich.livePreview;
  }

  set livePreview(next: boolean | LivePreviewConfig | undefined) {
    this.#setRich("livePreview", next);
  }

  get onAssetUpload(): ((file: File) => Promise<string | null>) | undefined {
    return this.#rich.onAssetUpload;
  }

  set onAssetUpload(next: ((file: File) => Promise<string | null>) | undefined) {
    this.#setRich("onAssetUpload", next);
  }

  connectedCallback(): void {
    if (this.#editor) {
      return;
    }
    // Custom elements render inline by default, but the editor is a block
    // surface. Checking the computed style (not just the inline style) keeps
    // host stylesheet rules like `nexus-editor { display: flex }` in charge —
    // an inline default would silently outrank them.
    const display = getComputedStyle(this).display;
    if (display === "inline" || display === "") {
      this.style.display = "block";
    }
    this.#mount();
  }

  disconnectedCallback(): void {
    // Reparenting fires disconnected + connected synchronously in the same
    // task. Deferring the teardown one microtask keeps the live editor (and
    // its undo history / scroll state) across DOM moves; only a real removal
    // destroys it.
    queueMicrotask(() => {
      if (!this.isConnected) {
        this.#unmount();
      }
    });
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) {
      return;
    }
    if (name === "value") {
      // Attribute removal means "stop controlling", not "clear the document" —
      // the same contract as the React binding when `value` becomes undefined.
      if (newValue === null) {
        return;
      }
      if (this.#editor) {
        this.#syncDocument(newValue);
      } else {
        // A controlled write while destroyed must win over the document
        // captured at destroy time, or the next mount resurrects stale text.
        this.#pendingDocument = newValue;
      }
      return;
    }
    if (!this.#editor) {
      return;
    }
    this.#scheduleRebuild();
  }

  /** Controlled-document sync: silent, guarded against echoing. */
  #syncDocument(next: string): void {
    const editor = this.#editor;
    if (!editor || !shouldSyncControlledDocument(next, this.#lastSyncedDoc)) {
      return;
    }
    editor.setDocument(next, { silent: true });
    this.#lastSyncedDoc = next;
  }

  #setRich<K extends keyof RichConfig>(key: K, next: RichConfig[K]): void {
    if (this.#rich[key] === next) {
      return;
    }
    if (next === undefined) {
      delete this.#rich[key];
    } else {
      this.#rich[key] = next;
    }
    if (this.#editor) {
      this.#scheduleRebuild();
    }
  }

  /**
   * Config mutations rebuild the editor because `createEditor` options have
   * no runtime setters. Coalesced through a microtask so a host writing
   * several attributes in one task pays for a single rebuild.
   */
  #scheduleRebuild(): void {
    if (this.#rebuildQueued) {
      return;
    }
    this.#rebuildQueued = true;
    queueMicrotask(() => {
      this.#rebuildQueued = false;
      if (this.isConnected && this.#editor) {
        this.#rebuild();
      }
    });
  }

  #rebuild(): void {
    const editor = this.#editor;
    if (!editor) {
      return;
    }
    const selection = editor.getSelection();
    const wasFocused = this.#focused;
    this.#unmount();
    this.#mount();

    const next = this.#editor as EditorAPI | null;
    if (!next) {
      return;
    }
    // Same document, so the captured offsets are valid; the clamp is cheap
    // insurance against a concurrent value sync shrinking the text.
    const length = next.getDocument().length;
    next.setSelection(Math.min(selection.anchor, length), Math.min(selection.head, length));
    if (wasFocused) {
      next.focus();
    }
  }

  #mount(): void {
    const initialValue = this.#pendingDocument ?? this.getAttribute("value") ?? "";
    const config: EditorConfig = {
      container: this,
      ...readAttributeConfig(this),
      ...this.#rich,
      initialValue,
      onChange: (markdown, ast) => {
        this.#lastSyncedDoc = markdown;
        this.#emit<NexusChangeDetail>("nexus-change", { markdown, ast });
      },
      onFocus: () => {
        this.#focused = true;
        this.#emit("nexus-focus");
      },
      onBlur: () => {
        this.#focused = false;
        this.#emit("nexus-blur");
      }
    };

    this.#editor = createEditor(config);
    this.#lastSyncedDoc = initialValue;
    this.#pendingDocument = null;
    this.#emit<NexusReadyDetail>("nexus-ready", { editor: this.#editor });
  }

  #unmount(): void {
    const editor = this.#editor;
    if (!editor) {
      return;
    }
    this.#pendingDocument = editor.getDocument();
    this.#editor = null;
    this.#lastSyncedDoc = null;
    this.#focused = false;
    editor.destroy();
  }

  #emit<T>(type: string, detail?: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail: detail as T, bubbles: true, composed: true }));
  }
}

/**
 * Register the element. Importing this module never touches
 * `customElements` — registration stays an explicit host decision so the
 * package is safe to import in SSR / Node contexts.
 */
export function defineNexusEditor(tagName = "nexus-editor"): void {
  const existing = customElements.get(tagName);
  if (existing === NexusEditorElement) {
    return;
  }
  if (existing) {
    throw new Error(
      `<${tagName}> is already registered to a different constructor; pick another tag name`
    );
  }
  customElements.define(tagName, NexusEditorElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "nexus-editor": NexusEditorElement;
  }
}
