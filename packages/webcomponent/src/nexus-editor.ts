import { 
  createEditor, 
  lightTheme, 
  darkTheme,
  type EditorAPI, 
  type EditorConfig, 
  type NexusTheme
} from "@floatboat/nexus-core";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import { createToolbarPlugin, createToolbarUI, type ToolbarUI } from "@floatboat/nexus-plugin-toolbar";
import { createSearchPlugin } from "@floatboat/nexus-plugin-search";
import { createSlashMenuUI, type SlashMenuUI } from "@floatboat/nexus-plugin-slash";

export class NexusEditor extends HTMLElement {
  private container: HTMLDivElement | null = null;
  private editor: EditorAPI | null = null;
  private toolbar: ToolbarUI | null = null;
  private slashMenu: SlashMenuUI | null = null;
  private _theme: NexusTheme = lightTheme;
  private _value: string = "";
  private _readOnly: boolean = false;
  private _tabSize: number = 4;
  private _indentGuides: boolean = false;
  private _livePreview: boolean = true;

  static observedAttributes = [
    "value",
    "theme",
    "read-only",
    "tab-size",
    "indent-guides",
    "live-preview"
  ];

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
    this.initEditor();
  }

  disconnectedCallback() {
    this.destroyEditor();
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    switch (name) {
      case "value":
        this._value = newValue;
        this.updateValue();
        break;
      case "theme":
        this.setThemeByName(newValue);
        break;
      case "read-only":
        this._readOnly = newValue !== null;
        break;
      case "tab-size":
        this._tabSize = parseInt(newValue) || 4;
        break;
      case "indent-guides":
        this._indentGuides = newValue !== null;
        break;
      case "live-preview":
        this._livePreview = newValue !== null;
        break;
    }
  }

  get value(): string {
    return this.editor?.getDocument() || this._value;
  }

  set value(newValue: string) {
    this._value = newValue;
    this.setAttribute("value", newValue);
    this.updateValue();
  }

  get theme(): NexusTheme {
    return this._theme;
  }

  set theme(newTheme: NexusTheme) {
    this._theme = newTheme;
    this.editor?.setTheme(newTheme);
  }

  get readOnly(): boolean {
    return this._readOnly;
  }

  set readOnly(value: boolean) {
    this._readOnly = value;
    if (value) {
      this.setAttribute("read-only", "");
    } else {
      this.removeAttribute("read-only");
    }
  }

  private render() {
    if (!this.shadowRoot) return;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
        }
        .editor-wrapper {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .editor-container {
          flex: 1;
          min-height: 0;
        }
      </style>
      <div class="editor-wrapper">
        <div class="editor-container"></div>
      </div>
    `;

    this.container = this.shadowRoot.querySelector(".editor-container");
  }

  private initEditor() {
    if (!this.container) return;

    const config: EditorConfig = {
      container: this.container,
      initialValue: this._value,
      theme: this._theme,
      readOnly: this._readOnly,
      tabSize: this._tabSize,
      indentGuides: this._indentGuides,
      livePreview: this._livePreview,
      plugins: [
        createGfmPreset(),
        createHistoryPlugin(),
        createToolbarPlugin(),
        createSearchPlugin()
      ],
      onChange: (markdown) => {
        this._value = markdown;
        this.dispatchEvent(new CustomEvent("change", {
          detail: { value: markdown },
          bubbles: true,
          composed: true
        }));
      },
      onFocus: () => {
        this.dispatchEvent(new CustomEvent("focus", {
          bubbles: true,
          composed: true
        }));
      },
      onBlur: () => {
        this.dispatchEvent(new CustomEvent("blur", {
          bubbles: true,
          composed: true
        }));
      }
    };

    this.editor = createEditor(config);

    if (this.editor) {
      this.toolbar = createToolbarUI(this.editor);
      const wrapper = this.shadowRoot?.querySelector(".editor-wrapper");
      if (wrapper && this.toolbar) {
        wrapper.insertBefore(this.toolbar.element, this.container);
      }

      this.slashMenu = createSlashMenuUI(this.editor);
    }
  }

  private destroyEditor() {
    this.slashMenu?.destroy();
    this.toolbar?.destroy();
    this.editor?.destroy();
    this.editor = null;
    this.toolbar = null;
    this.slashMenu = null;
  }

  private updateValue() {
    if (this.editor && this._value !== this.editor.getDocument()) {
      this.editor.setDocument(this._value);
    }
  }

  private setThemeByName(themeName: string) {
    const themes: Record<string, NexusTheme> = {
      light: lightTheme,
      dark: darkTheme
    };
    this.theme = themes[themeName.toLowerCase()] || lightTheme;
  }

  focus(): void {
    this.editor?.focus();
  }

  blur(): void {
    this.editor?.blur();
  }

  undo(): boolean {
    return this.editor?.undo() ?? false;
  }

  redo(): boolean {
    return this.editor?.redo() ?? false;
  }

  getDocument(): string {
    return this.editor?.getDocument() ?? "";
  }

  setDocument(value: string, silent?: boolean): void {
    this.editor?.setDocument(value, { silent });
    if (!silent) {
      this._value = value;
    }
  }

  getSelection(): { anchor: number; head: number } {
    return this.editor?.getSelection() ?? { anchor: 0, head: 0 };
  }

  setSelection(anchor: number, head?: number): void {
    this.editor?.setSelection(anchor, head);
  }

  replaceSelection(text: string): void {
    this.editor?.replaceSelection(text);
  }

  exportHTML(): string {
    return this.editor?.exportHTML() ?? "";
  }

  destroy(): void {
    this.destroyEditor();
  }
}

customElements.define("nexus-editor", NexusEditor);
