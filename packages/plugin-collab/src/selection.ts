import { EditorSelection } from "@codemirror/state";
import * as Y from "yjs";

export interface RelativeSelection {
  readonly ranges: readonly { anchor: Y.RelativePosition; head: Y.RelativePosition }[];
  readonly mainIndex: number;
}

export function captureSelection(text: Y.Text, selection: EditorSelection): RelativeSelection {
  return {
    ranges: selection.ranges.map((range) => ({
      anchor: Y.createRelativePositionFromTypeIndex(text, range.anchor, range.assoc),
      head: Y.createRelativePositionFromTypeIndex(text, range.head, range.assoc),
    })),
    mainIndex: selection.mainIndex,
  };
}

export function resolvePosition(text: Y.Text, position: Y.RelativePosition): number | null {
  if (!text.doc) return null;
  const absolute = Y.createAbsolutePositionFromRelativePosition(position, text.doc);
  return absolute?.type === text ? Math.min(absolute.index, text.length) : null;
}

export function restoreSelection(text: Y.Text, selection: RelativeSelection): EditorSelection | null {
  const ranges = [];
  for (const range of selection.ranges) {
    const anchor = resolvePosition(text, range.anchor);
    const head = resolvePosition(text, range.head);
    if (anchor === null || head === null) return null;
    ranges.push(EditorSelection.range(anchor, head));
  }
  return EditorSelection.create(ranges, selection.mainIndex);
}
