import { StateEffect, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { resolvePosition } from "./selection";

const refreshPresence = StateEffect.define<null>();
const cursorOwners = new WeakMap<Awareness, object>();
const defaultColor = "#4f46e5";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function readPosition(text: Y.Text, value: unknown): number | null {
  if (!record(value)) return null;
  try {
    return resolvePosition(text, Y.createRelativePositionFromJSON(value));
  } catch {
    return null;
  }
}

class RemoteCaret extends WidgetType {
  constructor(private readonly name: string, private readonly color: string) { super(); }

  eq(other: RemoteCaret): boolean {
    return this.name === other.name && this.color === other.color;
  }

  toDOM(view: EditorView): HTMLElement {
    const caret = view.dom.ownerDocument.createElement("span");
    caret.className = "nexus-collab-caret";
    caret.style.borderColor = this.color;
    caret.setAttribute("aria-label", this.name);
    const label = view.dom.ownerDocument.createElement("span");
    label.className = "nexus-collab-name";
    label.style.backgroundColor = this.color;
    label.textContent = this.name;
    caret.appendChild(label);
    return caret;
  }

  ignoreEvent(): boolean { return true; }
}

function decorations(text: Y.Text, awareness: Awareness): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID || !record(state.cursor)) continue;
    const anchor = readPosition(text, state.cursor.anchor);
    const head = readPosition(text, state.cursor.head);
    if (anchor === null || head === null) continue;
    const user: Record<string, unknown> = record(state.user) ? state.user : {};
    const name = typeof user.name === "string" ? user.name.slice(0, 100) : "Anonymous";
    const color = typeof user.color === "string" && /^#[\da-f]{6}$/i.test(user.color)
      ? user.color : defaultColor;
    if (anchor !== head) {
      ranges.push(Decoration.mark({
        class: "nexus-collab-selection",
        attributes: { style: `background-color: ${color}33` },
      }).range(Math.min(anchor, head), Math.max(anchor, head)));
    }
    ranges.push(Decoration.widget({ widget: new RemoteCaret(name, color), side: 1 }).range(head));
  }
  return Decoration.set(ranges, true);
}

export function createPresence(text: Y.Text, awareness: Awareness): Extension {
  const plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    private destroyed = false;
    private refreshQueued = false;

    constructor(private readonly view: EditorView) {
      this.decorations = decorations(text, awareness);
      awareness.on("change", this.onAwarenessChange);
    }

    private readonly onAwarenessChange = (): void => {
      if (this.refreshQueued || this.destroyed) return;
      this.refreshQueued = true;
      // Publishing the local cursor can happen inside a CodeMirror update.
      // Re-entering view.dispatch there would invalidate its update lifecycle.
      queueMicrotask(() => {
        this.refreshQueued = false;
        if (!this.destroyed) this.view.dispatch({ effects: refreshPresence.of(null) });
      });
    };

    update(update: ViewUpdate): void {
      if (update.docChanged || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(refreshPresence)))) {
        this.decorations = decorations(text, awareness);
      }
      if (update.selectionSet || update.docChanged || update.focusChanged) this.publishCursor();
    }

    private publishCursor(): void {
      if (!this.view.hasFocus) {
        this.clearCursor();
        return;
      }
      const selection = this.view.state.selection.main;
      const cursor = {
        anchor: Y.createRelativePositionFromTypeIndex(text, selection.anchor, selection.assoc),
        head: Y.createRelativePositionFromTypeIndex(text, selection.head, selection.assoc),
      };
      cursorOwners.set(awareness, this);
      if (JSON.stringify(awareness.getLocalState()?.cursor) !== JSON.stringify(cursor)) {
        awareness.setLocalStateField("cursor", cursor);
      }
    }

    private clearCursor(): void {
      if (cursorOwners.get(awareness) !== this) return;
      cursorOwners.delete(awareness);
      awareness.setLocalStateField("cursor", null);
    }

    destroy(): void {
      this.destroyed = true;
      awareness.off("change", this.onAwarenessChange);
      this.clearCursor();
    }
  }, { decorations: (value) => value.decorations });

  return [plugin, EditorView.baseTheme({
    ".nexus-collab-caret": {
      position: "relative",
      borderLeft: "2px solid",
      marginLeft: "-1px",
      marginRight: "-1px",
      pointerEvents: "none",
    },
    ".nexus-collab-name": {
      position: "absolute",
      bottom: "100%",
      left: "-2px",
      padding: "1px 4px",
      borderRadius: "3px 3px 3px 0",
      color: "white",
      fontSize: "11px",
      lineHeight: "16px",
      whiteSpace: "nowrap",
      opacity: "0",
      transition: "opacity .15s",
    },
    "&:hover .nexus-collab-name": { opacity: "1" },
  })];
}
