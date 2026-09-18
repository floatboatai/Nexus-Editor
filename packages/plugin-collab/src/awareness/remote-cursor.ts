/**
 * Awareness layer — remote cursor / selection rendering.
 *
 * Drift fix (architecture §六大难点 1): we store a DOCUMENT OFFSET, never a
 * pixel coordinate. Decoration positions are recomputed inside a `requestMeasure`
 * callback (so they track async widget heights from formulas / mermaid), and we
 * listen for viewport + widget-height changes to invalidate the cache. Cursor
 * positions inside deleted ranges are clamped to the nearest legal boundary
 * rather than hidden.
 */

import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Range } from "@codemirror/state";
import type { AwarenessState } from "../provider/adapter";

export interface RemoteCursorSource {
  /** Latest remote awareness states (offsets already mapped to local view). */
  (): readonly AwarenessState[];
}

function buildDecorations(view: EditorView, states: readonly AwarenessState[]): DecorationSet {
  const docLen = view.state.doc.length;
  const ranges: Range<Decoration>[] = [];
  for (const s of states) {
    if (s.clientId === "local") continue;
    const caret = Math.min(Math.max(0, s.caret), docLen);
    ranges.push(
      Decoration.widget({
        widget: new RemoteCaretWidget(s),
        side: 1,
      }).range(caret),
    );
    if (s.selection) {
      const from = Math.min(Math.max(0, Math.min(...s.selection)), docLen);
      const to = Math.min(Math.max(0, Math.max(...s.selection)), docLen);
      if (to > from) {
        ranges.push(Decoration.mark({ class: "nx-collab-remote-sel", attributes: { "data-client": s.clientId } }).range(from, to));
      }
    }
  }
  return Decoration.set(ranges, true);
}

class RemoteCaretWidget {
  constructor(private readonly state: AwarenessState) {}
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "nx-collab-remote-caret";
    el.style.borderLeft = `2px solid ${this.state.color}`;
    el.setAttribute("data-client", this.state.clientId);
    el.setAttribute("title", this.state.name);
    el.textContent = "​";
    return el;
  }
  get estimatedHeight(): number {
    return 18;
  }
}

export function createRemoteCursorExtension(getStates: RemoteCursorSource): ReturnType<typeof ViewPlugin.define> {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, getStates());
      }
      update(update: ViewUpdate): void {
        const needsRerender =
          update.docChanged ||
          update.viewportChanged ||
          update.geometryChanged ||
          update.transactions.some((t) => t.annotation(EditorView.heightAnn) != null);
        if (needsRerender) {
          // Recompute deferred to measure phase so async widget heights are settled.
          update.view.requestMeasure({
            read: () => undefined,
            write: (view) => {
              this.decorations = buildDecorations(view, getStates());
              view.updateState(view.state);
            },
          });
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}
