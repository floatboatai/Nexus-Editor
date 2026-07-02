/**
 * <nexus-editor> Web Component
 *
 * A Custom Element wrapper around @floatboat/nexus-core that provides
 * a drop-in Markdown editor without framework dependencies.
 *
 * @example
 * ```html
 * <nexus-editor value="# Hello" live-preview></nexus-editor>
 * <script type="module">
 *   import '@floatboat/nexus-wc';
 *   const el = document.querySelector('nexus-editor');
 *   el.addEventListener('change', (e) => console.log(e.detail));
 * </script>
 * ```
 */
import { createEditor, type EditorAPI, type NexusPlugin } from "@floatboat/nexus-core";

export class NexusEditorElement extends HTMLElement {
  static get observedAttributes() {
    return ["value", "live-preview", "readonly", "theme"];
  }

  private _editor: EditorAPI | null = null;
  private _container: HTMLDivElement | null = null;
  private _plugins: NexusPlugin[] = [];
  private _initialized = false;

  /** Set plugins programmatically (must be set before connectedCallback or call reinit). */
  set plugins(value: NexusPlugin[]) {
    this._plugins = value;
    if (this._initialized) {
      this._destroy();
      this._init();
    }
  }

  get plugins(): NexusPlugin[] {
    return this._plugins;
  }

  /** Get the current document content. */
  get value(): string {
    return this._editor?.getDocument() ?? this.getAttribute("value") ?? "";
  }

  /** Set the document content. */
  set value(v: string) {
    if (this._editor) {
      this._editor.setDocument(v);
    } else {
      this.setAttribute("value", v);
    }
  }

  /** Get the EditorAPI instance (null until connected). */
  get editor(): EditorAPI | null {
    return this._editor;
  }

  connectedCallback() {
    // Create shadow DOM for style isolation
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }

    this._container = document.createElement("div");
    this._container.style.width = "100%";
    this._container.style.height = "100%";
    this.shadowRoot!.appendChild(this._container);

    this._init();
  }

  disconnectedCallback() {
    this._destroy();
  }

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null) {
    if (!this._editor) return;

    switch (name) {
      case "value":
        if (newValue !== null && newValue !== this._editor.getDocument()) {
          this._editor.setDocument(newValue, { silent: true });
        }
        break;
      case "readonly":
        // Read-only toggling would require editor recreation
        break;
    }
  }

  private _init() {
    if (!this._container) return;

    const initialValue = this.getAttribute("value") ?? "";
    const livePreview = this.hasAttribute("live-preview");
    const readOnly = this.hasAttribute("readonly");

    this._editor = createEditor({
      container: this._container,
      initialValue,
      livePreview,
      readOnly,
      plugins: this._plugins,
      onChange: (doc) => {
        this.dispatchEvent(new CustomEvent("change", { detail: doc, bubbles: true }));
      },
      onFocus: () => {
        this.dispatchEvent(new CustomEvent("focus", { bubbles: true }));
      },
      onBlur: () => {
        this.dispatchEvent(new CustomEvent("blur", { bubbles: true }));
      },
    });

    this._initialized = true;
  }

  private _destroy() {
    this._editor?.destroy();
    this._editor = null;
    this._initialized = false;
    if (this._container) {
      this._container.innerHTML = "";
    }
  }
}

// Register the custom element
if (!customElements.get("nexus-editor")) {
  customElements.define("nexus-editor", NexusEditorElement);
}

export { type EditorAPI, type NexusPlugin } from "@floatboat/nexus-core";
