/**
 * CM6 ViewPlugin that detects inline color/highlight HTML tags in the document
 * and replaces them with styled decorations — hiding the tags, showing colored text.
 *
 * Patterns handled:
 *   <span style="color:#ff9900">text</span>
 *   <mark style="background:#ffff00">text</mark>
 */

import { type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

// Matches <span style="color:...">...</span> and <mark style="background:...">...</mark>
const COLOR_RE = /<span\s+style="color:\s*([^"]+)">([\s\S]*?)<\/span>/g;
const HIGHLIGHT_RE =
  /<mark\s+style="background:\s*([^"]+)">([\s\S]*?)<\/mark>/g;

/** Zero-width widget used to replace opening/closing tags (hides them). */
class HiddenTagWidget extends WidgetType {
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.style.display = "none";
    return el;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

const hiddenWidget = Decoration.replace({ widget: new HiddenTagWidget() });

interface ColorRange {
  /** Full match start */
  from: number;
  /** Full match end */
  to: number;
  /** Inner text start */
  innerFrom: number;
  /** Inner text end */
  innerTo: number;
  /** CSS property value (color or background) */
  color: string;
  /** "color" | "background" */
  kind: "color" | "background";
}

function findColorRanges(doc: string): ColorRange[] {
  const ranges: ColorRange[] = [];

  COLOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COLOR_RE.exec(doc)) !== null) {
    const from = m.index;
    const openTag = `<span style="color:${m[1]}">`;
    const closeTag = "</span>";
    ranges.push({
      from,
      to: from + m[0].length,
      innerFrom: from + openTag.length,
      innerTo: from + m[0].length - closeTag.length,
      color: m[1].trim(),
      kind: "color",
    });
  }

  HIGHLIGHT_RE.lastIndex = 0;
  while ((m = HIGHLIGHT_RE.exec(doc)) !== null) {
    const from = m.index;
    const openTag = `<mark style="background:${m[1]}">`;
    const closeTag = "</mark>";
    ranges.push({
      from,
      to: from + m[0].length,
      innerFrom: from + openTag.length,
      innerTo: from + m[0].length - closeTag.length,
      color: m[1].trim(),
      kind: "background",
    });
  }

  // Sort by position for Decoration.set ordering requirement
  ranges.sort((a, b) => a.from - b.from);
  return ranges;
}

function buildDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc.toString();
  const ranges = findColorRanges(doc);

  if (ranges.length === 0) return Decoration.none;

  // Check if the cursor is inside any color range — if so, show raw text for that range
  const cursorPos = view.state.selection.main.head;

  const decorations: Array<{ from: number; to: number; value: Decoration }> =
    [];

  for (const r of ranges) {
    // If cursor is inside this range, skip decorations so user can edit the raw HTML
    if (cursorPos >= r.from && cursorPos <= r.to) continue;

    // Hide opening tag
    decorations.push({ from: r.from, to: r.innerFrom, value: hiddenWidget });

    // Style the inner text
    const markDeco =
      r.kind === "color"
        ? Decoration.mark({ attributes: { style: `color:${r.color}` } })
        : Decoration.mark({
            attributes: {
              style: `background:${r.color};border-radius:2px;padding:0 1px`,
            },
          });
    decorations.push({ from: r.innerFrom, to: r.innerTo, value: markDeco });

    // Hide closing tag
    decorations.push({ from: r.innerTo, to: r.to, value: hiddenWidget });
  }

  // Must be sorted by from position, then by startSide
  decorations.sort(
    (a, b) => a.from - b.from || a.value.startSide - b.value.startSide,
  );
  return Decoration.set(decorations.map((d) => d.value.range(d.from, d.to)));
}

const colorDecoPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export function colorDecorationExtension(): Extension {
  return colorDecoPlugin;
}
