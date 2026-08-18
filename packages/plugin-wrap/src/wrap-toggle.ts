import { EditorView } from "@codemirror/view";
import { type EditorAPI, type EditorContributionRegistration } from "@floatboat/nexus-core";

const cmLineWrapping = EditorView.lineWrapping;

const OWNER_ID = "nexus-plugin-wrap.toggle";
const CM_LINE_WRAPPING_CLASS = "cm-lineWrapping";

export interface WrapToggle {
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  dispose(): void;
}

export function createWrapToggle(
  editor: EditorAPI,
  editorContainer: HTMLElement,
  initial: boolean,
): WrapToggle {
  const sink = editor.getContributionSink();
  let current: EditorContributionRegistration | null = null;
  let enabled = false;

  const cmContent = (): HTMLElement | null =>
    editorContainer.querySelector<HTMLElement>(".cm-content");

  const applyDomClass = (on: boolean) => {
    const el = cmContent();
    if (!el) return;
    if (on) el.classList.add(CM_LINE_WRAPPING_CLASS);
    else el.classList.remove(CM_LINE_WRAPPING_CLASS);
    const scroller = editorContainer.querySelector<HTMLElement>(".cm-scroller");
    if (scroller) {
      if (on) scroller.classList.add("cm-scrollerWrapping");
      else scroller.classList.remove("cm-scrollerWrapping");
    }
  };

  const install = () => {
    applyDomClass(true);
    if (current) return;
    current = sink.registerExtension(OWNER_ID, cmLineWrapping);
  };

  const uninstall = () => {
    applyDomClass(false);
    if (!current) return;
    const reg = current;
    current = null;
    void reg.dispose();
  };

  const setEnabled = (next: boolean) => {
    if (next === enabled) return;
    enabled = next;
    if (next) install();
    else uninstall();
  };

  const isEnabled = () => enabled;

  const dispose = () => {
    uninstall();
    enabled = false;
  };

  setEnabled(initial);

  return { setEnabled, isEnabled, dispose };
}
