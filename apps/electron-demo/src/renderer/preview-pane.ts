import { createScrollSync, themeToCssVars, type EditorAPI, type ScrollSync } from "@floatboat/nexus-core";
import { settingsToTheme, type EditorSettings } from "./settings";

export interface PreviewPaneOptions {
  editor: EditorAPI;
  settings: EditorSettings;
}

export interface PreviewPane {
  element: HTMLElement;
  /** Re-render from the editor's current document. No-op while hidden (re-rendered on next show). */
  render(): void;
  setVisible(visible: boolean): void;
  applySettings(settings: EditorSettings): void;
  destroy(): void;
}

/**
 * Split-preview pane: rendered HTML beside the editor, scroll-synced both
 * ways (ROADMAP #13). Rendering goes through
 * `exportHTML({ sourceMap: true })` so every block carries the source
 * offsets `createScrollSync` maps scroll positions with.
 *
 * The markdown→HTML pipeline drops raw HTML by default (remark-rehype
 * without `allowDangerousHtml`), so assigning the result to innerHTML does
 * not execute document-supplied markup.
 */
export function createPreviewPane(options: PreviewPaneOptions): PreviewPane {
  const { editor } = options;

  const element = document.createElement("div");
  element.className = "preview-pane";
  element.hidden = true;

  const content = document.createElement("article");
  content.className = "preview-content";
  element.appendChild(content);

  const sync: ScrollSync = createScrollSync({ editor, preview: element });

  function render(): void {
    // Skip exportHTML for a pane nobody sees; setVisible(true) re-renders.
    if (element.hidden) return;
    content.innerHTML = editor.exportHTML({ sourceMap: true });
    // Block geometry changed wholesale — re-measure and re-align.
    sync.refresh();
  }

  // `change` is already debounced by the editor's parseDelayMs, so this is
  // at most one exportHTML per typing pause. Silent document loads (file
  // open) bypass the change event — the host calls render() explicitly.
  const handleChange = (): void => render();
  editor.on("change", handleChange);

  function applySettings(settings: EditorSettings): void {
    const theme = settingsToTheme(settings);
    // The editor scopes its theme vars to its own DOM, so the pane (a
    // sibling) applies the same map to its root for the preview stylesheet.
    for (const [cssVar, value] of Object.entries(themeToCssVars(theme))) {
      element.style.setProperty(cssVar, value);
    }
    element.style.setProperty(
      "--nexus-font-mono",
      theme.fontFamilyMono ?? "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    );
    element.style.fontSize = `${theme.fontSize ?? 15}px`;
    if (theme.fontFamily) element.style.fontFamily = theme.fontFamily;
    // Font changes reflow every block; cached anchor geometry is stale.
    sync.refresh();
  }
  applySettings(options.settings);

  return {
    element,
    render,
    setVisible(next: boolean) {
      if (element.hidden === !next) return;
      // Unhide before rendering: hidden elements have zero-size rects,
      // which would make anchor measurement useless.
      element.hidden = !next;
      if (next) render();
    },
    applySettings,
    destroy() {
      editor.off("change", handleChange);
      sync.destroy();
      element.remove();
    },
  };
}
