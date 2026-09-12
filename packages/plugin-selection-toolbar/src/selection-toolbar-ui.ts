import { ensureSyntaxTree } from "@codemirror/language";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { EditorAPI } from "@floatboat/nexus-core";
import { createToolbarButton, pickOverlayMount, SEPARATOR_STYLES, type SelectionToolbarButton, type SelectionToolbarGroup } from "./toolbar-dom";
import { positionSelectionToolbar } from "./selection-toolbar-position";

export interface SelectionToolbarUIOptions {
  editorRoot: HTMLElement;
  /** Enable Alt+F10 to deliberately focus the visible toolbar. Defaults to false. */
  focusShortcut?: boolean;
  /** Host-configured direct actions. An empty list disables display. */
  groups: SelectionToolbarGroup[];
  /** Replaces direct execution. Hosts must dismiss before replacing the source document. */
  onAction?: (button: SelectionToolbarButton, editor: EditorAPI, signal: AbortSignal, anchor: HTMLButtonElement) => void | Promise<void>;
}

export interface SelectionToolbarUI {
  element: HTMLElement;
  ready: Promise<void>;
  dismiss(): void;
  focus(): void;
  destroy(): void;
}

const EXCLUDED_NODES = new Set(["Table", "FencedCode", "CodeBlock", "HTMLBlock", "Image", "HorizontalRule"]);
const SELECTION_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);
const SELECTION_TOOLBAR_STYLES = `
  position: fixed;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--nexus-border, #ddd);
  border-radius: 8px;
  background: var(--nexus-bg, #fff);
  color: var(--nexus-text, #24292e);
  box-shadow: 0 4px 16px #0002;
  z-index: 10000;
  user-select: none;
  box-sizing: border-box;
  overflow-x: auto;
`;

let nextOwner = 0;

/** One completed selection session, owned by one editor and its Document. */
export function createSelectionToolbarUI(editor: EditorAPI, options: SelectionToolbarUIOptions): SelectionToolbarUI {
  const { editorRoot } = options;
  const document = editorRoot.ownerDocument;
  const window = document.defaultView!;
  const element = document.createElement("div");
  element.className = "nexus-selection-toolbar";
  element.setAttribute("role", "toolbar");
  element.setAttribute("aria-label", "Selection formatting");
  element.style.cssText = SELECTION_TOOLBAR_STYLES;
  const cleanups: (() => void)[] = [];
  const buttons: HTMLButtonElement[] = [];
  const buttonViews: ReturnType<typeof createToolbarButton>[] = [];
  let view: EditorView | null = null;
  let disposed = false;
  let session = 0;
  let active = false;
  let gesture: "pointer" | "keyboard" | null = null;
  let completionPending = false;
  let actionPending = false;
  let actionController: AbortController | null = null;
  // Direct actions may emit intermediate updates before returning their final selection.
  let invokingAction = false;
  let frame: number | null = null;

  function hide() {
    element.hidden = true;
    element.style.display = "none";
    for (const button of buttonViews) button.hideTooltip();
  }

  function dismiss() {
    actionController?.abort();
    session++;
    active = false;
    gesture = null;
    completionPending = false;
    hide();
  }
  hide();

  function getSelectionEligibility(): "eligible" | "pending" | "excluded" {
    if (!view || disposed || !editorRoot.isConnected || !buttons.length || view.state.readOnly ||
        !view.state.facet(EditorView.editable) || view.composing || editor.isComposing()) return "excluded";
    const { ranges, main } = view.state.selection;
    if (ranges.length !== 1 || main.empty || !view.state.sliceDoc(main.from, main.to).trim()) return "excluded";
    const tree = ensureSyntaxTree(view.state, main.to, 20);
    if (!tree) return "pending";
    let excluded = false;
    tree.iterate({
      from: main.from,
      to: main.to,
      enter(node) {
        if (node.to <= main.from || node.from >= main.to) return false;
        if (EXCLUDED_NODES.has(node.name)) {
          excluded = true;
          return false;
        }
      },
    });
    if (excluded) return "excluded";
    const start = view.domAtPos(main.from);
    const end = view.domAtPos(main.to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    for (const widget of Array.from(view.contentDOM.querySelectorAll('[contenteditable="false"],button,input,textarea,select'))) {
      if (!widget.classList.contains("cm-widgetBuffer") && range.intersectsNode(widget)) return "excluded";
    }
    return "eligible";
  }

  function updateToolbar() {
    frame = null;
    if (completionPending) {
      completionPending = false;
      gesture = null;
      active = true;
    }
    if (disposed || !active || gesture) {
      hide();
      return;
    }
    const status = getSelectionEligibility();
    if (status === "pending") {
      hide();
      return;
    }
    if (status === "excluded") {
      dismiss();
      return;
    }
    if (!positionSelectionToolbar(view!, editorRoot, element)) hide();
  }

  function scheduleUpdate() {
    if (!disposed && frame === null) frame = window.requestAnimationFrame(updateToolbar);
  }

  function beginSelection(kind: "pointer" | "keyboard") {
    dismiss();
    gesture = kind;
  }

  function completeSelection(kind: "pointer" | "keyboard") {
    if (gesture !== kind) return;
    // Chromium reports native keyboard selection after keyup. Finish on the next
    // frame so the final CM selection, rather than the previous key's range, wins.
    completionPending = true;
    scheduleUpdate();
  }

  function isBodyTarget(target: EventTarget | null): boolean {
    if (!view || !(target instanceof window.Element) || !view.contentDOM.contains(target)) return false;
    return !target.closest('button,input,textarea,select,table,[contenteditable="false"],.nexus-image');
  }

  function containsFocus() {
    const focused = document.activeElement;
    return !!focused && (view?.contentDOM.contains(focused) || element.contains(focused));
  }

  async function executeAction(button: SelectionToolbarButton, anchor: HTMLButtonElement) {
    if (actionPending || !active || gesture || getSelectionEligibility() !== "eligible") return;
    const token = session;
    const keyboard = element.contains(document.activeElement);
    actionPending = true;
    const controller = new AbortController();
    actionController = controller;
    element.setAttribute("aria-busy", "true");
    try {
      invokingAction = true;
      const result = options.onAction ? options.onAction(button, editor, controller.signal, anchor) : button.action(editor, controller.signal, anchor);
      invokingAction = false;
      await result;
      if (disposed || token !== session) return;
      if (getSelectionEligibility() !== "eligible") {
        dismiss();
        return;
      }
      if (!keyboard) editor.focus();
      scheduleUpdate();
    } catch (error) {
      const cancelled = controller.signal.aborted;
      if (!disposed && token === session) dismiss();
      // Surface host command failures without creating an unhandled rejected click promise.
      if (!disposed && !cancelled) element.dispatchEvent(new window.CustomEvent("nexus-toolbar-error", { detail: error, bubbles: true }));
    } finally {
      invokingAction = false;
      actionPending = false;
      actionController = null;
      element.removeAttribute("aria-busy");
      scheduleUpdate();
    }
  }

  const groups = options.groups;
  for (const group of groups.filter((group) => group.buttons.length)) {
    if (buttons.length) {
      const separator = document.createElement("span");
      separator.setAttribute("role", "separator");
      separator.style.cssText = SEPARATOR_STYLES;
      element.appendChild(separator);
    }
    for (const definition of group.buttons) {
      const rendered = createToolbarButton(document, definition);
      listen(rendered.button, "click", () => void executeAction(definition, rendered.button));
      // Keyboard focus is entered deliberately, never by automatic display.
      listen(rendered.button, "focus", () => {
        rendered.button.style.outline = "2px solid var(--nexus-accent,#0969da)";
        rendered.button.style.outlineOffset = "-2px";
      });
      listen(rendered.button, "blur", () => { rendered.button.style.outline = ""; });
      cleanups.push(rendered.destroy);
      buttons.push(rendered.button);
      buttonViews.push(rendered);
      element.appendChild(rendered.button);
    }
  }
  pickOverlayMount(editorRoot).appendChild(element);

  function listen<K extends keyof DocumentEventMap>(
    target: EventTarget,
    event: K,
    callback: (event: DocumentEventMap[K]) => void,
    capture = false,
  ) {
    const listener = callback as EventListener;
    target.addEventListener(event, listener, capture);
    cleanups.push(() => target.removeEventListener(event, listener, capture));
  }
  listen(document, "pointerdown", (event) => {
    if (element.contains(event.target as Node)) return;
    if (event.pointerType !== "touch" && event.button === 0 && isBodyTarget(event.target)) beginSelection("pointer");
    else dismiss();
  }, true);
  listen(document, "pointerup", () => completeSelection("pointer"));
  listen(document, "pointercancel", dismiss);
  listen(window, "blur", dismiss);
  listen(document, "focusin", () => { if (!containsFocus()) dismiss(); });
  listen(editorRoot, "compositionstart", dismiss, true);
  listen(document, "keyup", (event) => {
    if (SELECTION_KEYS.has(event.key) || event.key === "Shift" || event.key.toLowerCase() === "a") completeSelection("keyboard");
  });
  listen(element, "mousedown", (event) => event.preventDefault());
  listen(element, "keydown", (event) => {
    if (element.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      if (!disposed && editorRoot.isConnected) editor.focus();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length].focus();
    }
  });
  listen(window, "scroll", scheduleUpdate, true);
  listen(window, "resize", scheduleUpdate);
  listen(document, "fullscreenchange", scheduleUpdate);
  if (window.visualViewport) {
    listen(window.visualViewport, "resize", scheduleUpdate);
    listen(window.visualViewport, "scroll", scheduleUpdate);
  }
  const observer = new window.MutationObserver(scheduleUpdate);
  // Theme variables may live on any editor ancestor, including body/html.
  for (let node: HTMLElement | null = editorRoot; node; node = node.parentElement) {
    observer.observe(node, { attributes: true, attributeFilter: ["class", "style"] });
  }
  cleanups.push(() => observer.disconnect());

  const sink = editor.getContributionSink();
  const owner = `selection-toolbar-${++nextOwner}`;
  const keyboard = sink.registerDomEvent(owner, "keydown", (event) => {
    if (!isBodyTarget(event.target) || disposed) return "pass";
    if (options.focusShortcut && event.altKey && event.key === "F10" && !element.hidden) {
      buttons[0]?.focus();
      return "consume";
    }
    if (event.key === "Escape" && !element.hidden) {
      dismiss();
      return "consume";
    }
    if ((event.shiftKey && SELECTION_KEYS.has(event.key)) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a")) {
      if (gesture !== "keyboard") beginSelection("keyboard");
    } else if (event.key !== "Shift" && event.key !== "Meta" && event.key !== "Control" && event.key !== "Alt") {
      dismiss();
    }
    return "pass";
  }, { phase: "capture", priority: 40 });
  const extension = sink.registerExtension(owner, ViewPlugin.define((initialView) => {
    view = initialView;
    return {
      update(update: ViewUpdate) {
        if (disposed) return;
        const selectionChanged = update.selectionSet && !update.startState.selection.eq(update.state.selection);
        if (actionPending && !invokingAction) {
          // Async commands mark their formatting edits; unrelated updates invalidate the session.
          const unrelatedEdit = update.docChanged && update.transactions.some((transaction) =>
            transaction.docChanged && !transaction.isUserEvent("input.format")
          );
          const unrelatedSelection = !gesture && selectionChanged && !update.docChanged;
          if (unrelatedEdit || unrelatedSelection) dismiss();
        } else if (!actionPending && (update.docChanged || (!gesture && selectionChanged))) {
          dismiss();
        }
        if (update.state.readOnly || !update.state.facet(EditorView.editable)) dismiss();
        if (update.focusChanged && !containsFocus()) dismiss();
        if (!actionPending) scheduleUpdate();
      },
      destroy() {
        view = null;
        destroy();
      },
    };
  }));
  function destroy() {
    if (disposed) return;
    disposed = true;
    dismiss();
    if (frame !== null) window.cancelAnimationFrame(frame);
    for (const cleanup of cleanups) cleanup();
    element.remove();
    void keyboard.dispose();
    void extension.dispose();
  }
  return {
    element,
    ready: Promise.all([keyboard.ready, extension.ready]).then(() => undefined),
    dismiss,
    focus() { if (!disposed && !element.hidden) buttons[0]?.focus(); },
    destroy,
  };
}
