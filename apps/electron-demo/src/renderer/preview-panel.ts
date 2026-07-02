import type { EditorAPI } from "@floatboat/nexus-core";

export interface PreviewPanel {
  element: HTMLElement;
  /** Show the preview panel and start syncing. */
  show(): void;
  /** Hide the preview panel and stop syncing. */
  hide(): void;
  /** Toggle visibility. Returns the new visible state. */
  toggle(): boolean;
  /** Whether the panel is currently visible. */
  isVisible(): boolean;
  /** Force an immediate refresh of the preview content. */
  refresh(): void;
  /** Clean up event listeners. */
  destroy(): void;
}

export interface PreviewPanelOptions {
  editor: EditorAPI;
  /** Called when visibility changes so host can adjust layout. */
  onToggle?: (visible: boolean) => void;
}

/**
 * Creates a split-view HTML preview panel that renders the editor's
 * markdown content as HTML in real-time.
 */
export function createPreviewPanel(options: PreviewPanelOptions): PreviewPanel {
  const { editor, onToggle } = options;

  const element = document.createElement("div");
  element.className = "preview-panel";
  element.setAttribute("role", "region");
  element.setAttribute("aria-label", "Markdown Preview");

  let visible = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const DEBOUNCE_MS = 120;

  function renderPreview(): void {
    if (!visible) return;
    try {
      const html = editor.exportHTML();
      element.innerHTML = html;
    } catch (err) {
      element.innerHTML = `<p style="color:red;">Preview error: ${String(err)}</p>`;
    }
  }

  function debouncedRender(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      renderPreview();
    }, DEBOUNCE_MS);
  }

  // Listen for editor changes
  function onDocChange(): void {
    if (visible) {
      debouncedRender();
    }
  }

  // Scroll sync: editor scroll → preview scroll
  function onEditorScroll(state: { fraction: number }): void {
    if (!visible) return;
    const maxScroll = element.scrollHeight - element.clientHeight;
    if (maxScroll > 0) {
      element.scrollTop = state.fraction * maxScroll;
    }
  }

  editor.on("change", onDocChange);
  editor.on("scrollChange", onEditorScroll);

  return {
    element,

    show() {
      if (visible) return;
      visible = true;
      element.classList.add("is-visible");
      renderPreview();
      onToggle?.(true);
    },

    hide() {
      if (!visible) return;
      visible = false;
      element.classList.remove("is-visible");
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      onToggle?.(false);
    },

    toggle() {
      if (visible) {
        this.hide();
      } else {
        this.show();
      }
      return visible;
    },

    isVisible() {
      return visible;
    },

    refresh() {
      renderPreview();
    },

    destroy() {
      editor.off("change", onDocChange);
      editor.off("scrollChange", onEditorScroll);
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    },
  };
}
