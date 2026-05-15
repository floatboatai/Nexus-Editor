import { EditorView, ViewPlugin, ViewUpdate, Decoration, type DecorationSet } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";
import { isTableEditing } from "@floatboat/nexus-core";

const listLineRE = /^(\s*)([-*+]|\d+\.)\s/;

function injectStyles() {
  const id = "nexus-list-reorder-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = ".nexus-list-drag-target { background: var(--nexus-bg-muted, #e8f0fe) !important; border-top: 2px solid var(--nexus-accent, #0969da) !important; }";
  document.head.appendChild(style);
}

function getListLineInfo(view: EditorView, pos: number): { from: number; to: number; indent: number } | null {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  const m = text.match(listLineRE);
  if (!m) return null;

  let to = line.to;
  const baseIndent = m[1].length;
  const contRE = new RegExp(`^\\s{0,${baseIndent + 1}}\\S`);
  for (let l = line.number + 1; l <= view.state.doc.lines; l++) {
    const next = view.state.doc.line(l);
    const nextText = next.text;
    if (nextText === "" || contRE.test(nextText) || listLineRE.test(nextText)) break;
    to = next.to;
  }
  return { from: line.from, to, indent: baseIndent };
}

const dragStyle = Decoration.line({ attributes: { class: "nexus-list-drag-target" } });

const setDragState = StateEffect.define<{ from: number; to: number; indent: number; targetLine: number } | null>();

const dragStateField = StateField.define<{ from: number; to: number; indent: number; targetLine: number } | null>({
  create() { return null; },
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setDragState)) return e.value;
    return value;
  }
});

const dragDecoField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(_decos, tr) {
    const state = tr.state.field(dragStateField, false) ?? null;
    if (!state) return Decoration.none;
    const targetLine = tr.state.doc.line(state.targetLine);
    return Decoration.set([dragStyle.range(targetLine.from)]);
  },
  provide: (f) => EditorView.decorations.from(f),
});

function moveListLines(view: EditorView, from: number, to: number, targetLineNumber: number) {
  const doc = view.state.doc;
  const block = doc.sliceString(from, to);
  const isLastBlock = to >= doc.length;
  const targetLine = doc.line(targetLineNumber);
  const delFrom = isLastBlock ? Math.max(0, from - 1) : from;
  const delTo = isLastBlock ? to : to + 1;

  let changes;
  if (targetLine.from < from) {
    changes = [
      { from: delFrom, to: delTo },
      { from: targetLine.from, insert: block + "\n" },
    ];
  } else {
    changes = [
      { from: targetLine.from, insert: block + "\n" },
      { from: delFrom, to: delTo },
    ];
  }

  view.dispatch({ changes, userEvent: "list.reorder" });
}

class ReorderPlugin {
  private cleanupDoc: (() => void) | null = null;

  constructor(readonly view: EditorView) {}

  update(_update: ViewUpdate) {}

  destroy() {
    if (this.cleanupDoc) {
      this.cleanupDoc();
      this.cleanupDoc = null;
    }
  }

  private startDrag(info: { from: number; to: number; indent: number }, startX: number, startY: number) {
    const view = this.view;
    let moved = false;

    const onMove = (e: MouseEvent) => {
      if (!moved && Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < 5) return;
      moved = true;
      const targetPos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (targetPos === null) return;
      const targetLine = view.state.doc.lineAt(targetPos).number;
      view.dispatch({ effects: setDragState.of({ ...info, targetLine }) });
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      this.cleanupDoc = null;
      view.contentDOM.style.cursor = "";

      const dragState = view.state.field(dragStateField, false) ?? null;
      if (dragState) {
        view.dispatch({ effects: setDragState.of(null) });
        if (moved) {
          moveListLines(view, dragState.from, dragState.to, dragState.targetLine);
        }
      }
    };

    if (this.cleanupDoc) this.cleanupDoc();
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    this.cleanupDoc = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      view.contentDOM.style.cursor = "";
    };
    view.contentDOM.style.cursor = "grabbing";
  }

  handleMousedown(event: MouseEvent) {
    if (event.button !== 0) return;
    if (isTableEditing()) return;
    const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return;
    const info = getListLineInfo(this.view, pos);
    if (!info) return;
    this.startDrag(info, event.clientX, event.clientY);
  }
}

const reorderPlugin = ViewPlugin.fromClass(ReorderPlugin, {
  eventHandlers: {
    mousedown(event, view) {
      const plugin = view.plugin(reorderPlugin);
      if (plugin) plugin.handleMousedown(event as MouseEvent);
    },
  },
});

export function listReorderExtension() {
  injectStyles();
  return [dragStateField, dragDecoField, reorderPlugin];
}
