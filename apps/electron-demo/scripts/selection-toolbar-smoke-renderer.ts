import { EditorView } from "@codemirror/view";
import { createEditorShell } from "../src/renderer/editor-shell";
import { createState } from "../src/renderer/state";
import { defaultSettings } from "../src/renderer/settings";

const style = document.createElement("style");
style.textContent = "body{margin:0;background:#eceff3}#fixture{position:absolute;left:60px;top:60px;width:600px;height:420px;background:white;display:flex;flex-direction:column}.cm-editor{flex:1;min-height:0}.cm-scroller{overflow:auto}.nexus-toolbar-tooltip{position:fixed;background:#24292e;color:white;padding:4px 8px;border-radius:4px;z-index:10001}";
document.head.append(style);
const root = document.createElement("div");
root.id = "fixture";
document.body.append(root);
let shell: ReturnType<typeof createEditorShell>;
const wait = () => new Promise((resolve) => setTimeout(resolve, 100));

const harness = {
  async reset(livePreview: boolean, text = "hello world\n\nSecond paragraph for selection testing.", features: { toolbar?: boolean; selectionToolbar?: boolean } = {}) {
    shell?.destroy();
    root.style.width = "600px";
    root.classList.remove("wrap");
    const state = createState();
    state.content = text;
    shell = createEditorShell({
      container: root, state, settings: { ...defaultSettings(), livePreview }, onStateChange() {},
      contributionFeatures: { formatting: true, toolbar: features.toolbar ?? true, selectionToolbar: features.selectionToolbar ?? true, slashMenu: true, wordCount: true },
    });
    await shell.selectionToolbar?.ready;
    shell.editor.focus();
    await wait();
  },
  point(pos: number) {
    const rect = shell.editor.getCoordsAtPos(pos);
    if (!rect) throw new Error(`No coordinates for ${pos}`);
    return { x: Math.round(rect.left), y: Math.round((rect.top + rect.bottom) / 2) };
  },
  target(selector: string) {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing target ${selector}`);
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  },
  slashVisible() {
    return !!shell.slashMenu && getComputedStyle(shell.slashMenu.element).display !== "none";
  },
  button(id = "inline-code") {
    const rect = shell.selectionToolbar!.element.querySelector(`[data-toolbar-action="${id}"]`)!.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  },
  state() {
    const ui = shell.selectionToolbar?.element;
    const rect = ui?.getBoundingClientRect() ?? new DOMRect();
    return {
      ranges: shell.editor.getSelections().ranges, text: shell.editor.getDocument(), selection: shell.editor.getSelection(),
      visible: !!ui && !ui.hidden, globalToolbar: !!shell.toolbar, selectionToolbar: !!ui, focus: document.activeElement?.className,
      actions: Array.from(ui?.querySelectorAll("[data-toolbar-action]") ?? []).map((button) => (button as HTMLElement).dataset.toolbarAction),
      focusedAction: document.activeElement?.getAttribute("aria-label"),
      colorPicker: !!ui?.querySelector(".nexus-selection-color-picker"),
      toolbarFocus: ui?.contains(document.activeElement) ?? false,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      colors: { background: getComputedStyle(ui ?? root).backgroundColor, foreground: getComputedStyle(ui ?? root).color },
    };
  },
  replaceDocument(text: string) { shell.editor.setDocument(text); },
  collapse(pos: number) { shell.editor.setSelection(pos); shell.editor.focus(); },
  async scroll(top: number) { root.querySelector(".cm-scroller")!.scrollTop = top; await wait(); },
  async wrap() { await shell.editor.getContributionSink().registerExtension("smoke-wrap", EditorView.lineWrapping).ready; await wait(); },
  async resize(width: number) { root.style.width = `${width}px`; await wait(); },
  async theme() { shell.applySettings({ ...defaultSettings(), colorScheme: "dark" }); await wait(); },
  async fullscreen() { await root.requestFullscreen(); await wait(); return root.contains(shell.selectionToolbar!.element); },
  async exitFullscreen() { await document.exitFullscreen(); await wait(); },
  destroy() { shell.destroy(); return document.querySelectorAll(".nexus-selection-toolbar").length; },
};
Object.assign(window, { selectionSmoke: harness });
