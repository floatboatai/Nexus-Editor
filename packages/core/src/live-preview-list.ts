import { Decoration, WidgetType, type EditorView } from "@codemirror/view";
import type { Range } from "@codemirror/state";

/** Inclusive source span of one list item (mdast offsets). */
export interface ListItemSpan {
  from: number;
  to: number;
}

/** Start of the line that contains `pos` (0 if on the first line). */
export function lineStartOffset(doc: string, pos: number): number {
  if (pos <= 0) return 0;
  const idx = doc.lastIndexOf("\n", pos - 1);
  return idx === -1 ? 0 : idx + 1;
}

/**
 * Expand mdast spans so sibling boundaries include line indents and separators.
 * Nested list items often report `from` at the marker (`-`) rather than the
 * line-leading whitespace; without this, reordering strips indentation.
 */
export function normalizeSiblingSpans(
  doc: string,
  items: readonly ListItemSpan[]
): ListItemSpan[] {
  return items.map((item, i) => {
    const from = lineStartOffset(doc, item.from);
    if (i < items.length - 1) {
      const nextFrom = lineStartOffset(doc, items[i + 1].from);
      return { from, to: nextFrom };
    }
    let to = Math.max(item.to, from);
    if (to < doc.length && doc[to] === "\n") to += 1;
    return { from, to };
  });
}

const listEditingCounts = new WeakMap<EditorView, number>();

export function isListEditing(view: EditorView | null | undefined): boolean {
  return !!view && (listEditingCounts.get(view) ?? 0) > 0;
}

function acquireListEditing(view: EditorView): void {
  listEditingCounts.set(view, (listEditingCounts.get(view) ?? 0) + 1);
}

function releaseListEditing(view: EditorView): void {
  const next = Math.max(0, (listEditingCounts.get(view) ?? 0) - 1);
  if (next === 0) listEditingCounts.delete(view);
  else listEditingCounts.set(view, next);
}

const ORDERED_MARKER_RE = /^(\s*)(\d+)([.)])(\s+)/;
const LIST_MARKER_LINE_RE = /^(\s*)([-*+]|\d+[.)]) /;

/**
 * Reorder sibling list-item blocks inside `doc`.
 *
 * Each non-last item occupies `[items[i].from, items[i + 1].from)` so the
 * newline between siblings stays attached to the preceding item. The last
 * item occupies through its mdast end, plus a trailing `\n` when present
 * (mdast `end.offset` often excludes that newline). Nested items expand
 * `from` to the line start so leading indent is preserved.
 *
 * @param toIndex — index in the array **after** removing `fromIndex`
 *   (0 = become first). No-op when indices are equal or out of range.
 */
export function reorderSiblingListItems(
  doc: string,
  items: readonly ListItemSpan[],
  fromIndex: number,
  toIndex: number
): string {
  if (items.length < 2) return doc;
  if (fromIndex < 0 || fromIndex >= items.length) return doc;
  if (toIndex < 0 || toIndex >= items.length) return doc;
  if (fromIndex === toIndex) return doc;

  const normalized = normalizeSiblingSpans(doc, items);
  const regionFrom = normalized[0].from;
  const regionTo = normalized[normalized.length - 1].to;

  const slices: string[] = [];
  for (let i = 0; i < normalized.length; i++) {
    const start = normalized[i].from;
    const end = i < normalized.length - 1 ? normalized[i + 1].from : normalized[i].to;
    slices.push(doc.slice(start, end));
  }

  const reordered = [...slices];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);

  return doc.slice(0, regionFrom) + reordered.join("") + doc.slice(regionTo);
}

/**
 * Renumber top-level ordered markers in a sibling region.
 * Lines deeper than `baseIndent` (nested lists) are left untouched.
 */
export function renumberOrderedListRegion(
  region: string,
  baseIndent: string,
  startNum = 1
): string {
  const lines = region.split("\n");
  let n = startNum;
  const out = lines.map((line) => {
    if (!line.startsWith(baseIndent)) return line;
    const rest = line.slice(baseIndent.length);
    // Nested content under this item starts with more spaces/tabs than baseIndent
    // already stripped — if the remainder still has leading whitespace before a
    // marker, it's nested relative to this list level.
    if (/^\s/.test(rest)) return line;
    const m = ORDERED_MARKER_RE.exec(line);
    if (!m) return line;
    if (m[1] !== baseIndent) return line;
    const next = `${baseIndent}${n}${m[3]}${m[4]}${line.slice(m[0].length)}`;
    n += 1;
    return next;
  });
  return out.join("\n");
}

/** Detect the indent string of the first list marker line in a region. */
export function detectListBaseIndent(region: string): string {
  for (const line of region.split("\n")) {
    const m = LIST_MARKER_LINE_RE.exec(line);
    if (m) return m[1];
  }
  return "";
}

/**
 * Full reorder + optional ordered renumber for a sibling group.
 * Returns the new document, or `null` when nothing changes.
 */
export function applyListItemReorder(
  doc: string,
  items: readonly ListItemSpan[],
  fromIndex: number,
  toIndex: number,
  options?: { ordered?: boolean; startNum?: number }
): string | null {
  if (fromIndex === toIndex) return null;
  let next = reorderSiblingListItems(doc, items, fromIndex, toIndex);
  if (next === doc) return null;

  if (options?.ordered) {
    const normalized = normalizeSiblingSpans(doc, items);
    const regionFrom = normalized[0].from;
    // Reorder is a length-preserving permutation of sibling slices.
    const regionTo = normalized[normalized.length - 1].to;
    const region = next.slice(regionFrom, regionTo);
    const indent = detectListBaseIndent(region);
    const renumbered = renumberOrderedListRegion(
      region,
      indent,
      options.startNum ?? 1
    );
    next = next.slice(0, regionFrom) + renumbered + next.slice(regionTo);
  }

  return next === doc ? null : next;
}

/** Map pointer placement to the post-removal insert index. */
export function dropIndexAfterRemoval(
  fromIndex: number,
  targetIndex: number,
  placeAfter: boolean
): number {
  let insertBefore = placeAfter ? targetIndex + 1 : targetIndex;
  if (fromIndex < insertBefore) insertBefore -= 1;
  return insertBefore;
}

const GRIP_BG = "color-mix(in srgb, var(--nexus-text-muted, #888) 55%, transparent)";
const DROP_SHADOW = "0 2px 0 0 var(--nexus-accent, #3b82f6)";

interface ActiveListDrag {
  listId: string;
  fromIndex: number;
  items: ListItemSpan[];
  ordered: boolean;
  startNum: number;
  view: EditorView;
  dropToIndex: number;
  placeAfter: boolean;
}

let activeDrag: ActiveListDrag | null = null;

function gripsForList(listId: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".nexus-list-grip")).filter(
    (el) => el.dataset.listId === listId
  );
}

function clearDropIndicators(listId: string): void {
  for (const el of gripsForList(listId)) {
    el.style.boxShadow = "";
  }
}

function onListDragMove(e: MouseEvent): void {
  if (!activeDrag) return;
  e.preventDefault();
  const { listId, fromIndex, view, items } = activeDrag;
  if (!view.dom.isConnected) {
    finishListDrag(false);
    return;
  }

  clearDropIndicators(listId);

  // Prefer full item-block geometry (coordsAtPos) so multi-line / nested
  // parents remain easy drop targets — grip-only hit boxes are too short.
  // Fall back to grip rects when coords are unavailable (e.g. jsdom).
  const normalized = normalizeSiblingSpans(view.state.doc.toString(), items);
  const grips = gripsForList(listId);
  let hitIndex = -1;
  let hitRect: { top: number; bottom: number } | null = null;
  for (let i = 0; i < normalized.length; i++) {
    if (i === fromIndex) continue;
    const start = view.coordsAtPos(normalized[i].from);
    const endPos = Math.max(normalized[i].from, normalized[i].to - 1);
    const end = view.coordsAtPos(endPos);
    if (start && end && (end.bottom > start.top + 1 || start.bottom > start.top)) {
      const top = Math.min(start.top, end.top);
      const bottom = Math.max(start.bottom, end.bottom);
      if (bottom - top < 2) {
        // Degenerate layout — try grip fallback below.
      } else if (e.clientY >= top && e.clientY <= bottom) {
        hitIndex = i;
        hitRect = { top, bottom };
        break;
      } else {
        continue;
      }
    }

    const grip = grips.find((el) => Number(el.dataset.itemIndex) === i);
    if (!grip) continue;
    const rect = grip.getBoundingClientRect();
    if (rect.height <= 0 && rect.width <= 0) continue;
    if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
      hitIndex = i;
      hitRect = { top: rect.top, bottom: rect.bottom };
      break;
    }
  }

  if (hitIndex < 0 || !hitRect) {
    activeDrag.dropToIndex = fromIndex;
    activeDrag.placeAfter = false;
    return;
  }

  const placeAfter = e.clientY > (hitRect.top + hitRect.bottom) / 2;
  activeDrag.dropToIndex = hitIndex;
  activeDrag.placeAfter = placeAfter;

  const grip = grips.find((el) => Number(el.dataset.itemIndex) === hitIndex);
  if (grip) {
    grip.style.boxShadow = placeAfter
      ? DROP_SHADOW
      : `0 -2px 0 0 var(--nexus-accent, #3b82f6)`;
  }
}

function finishListDrag(commit: boolean): void {
  const drag = activeDrag;
  activeDrag = null;
  document.removeEventListener("mousemove", onListDragMove);
  document.removeEventListener("mouseup", onListDragUp);
  document.body.style.cursor = "";
  document.body.style.userSelect = "";

  if (!drag) return;
  clearDropIndicators(drag.listId);

  const { view, fromIndex, items, ordered, startNum, dropToIndex, placeAfter } = drag;
  // Release editing lock BEFORE dispatch so the StateField rebuilds from new doc.
  releaseListEditing(view);

  if (!commit) return;
  if (dropToIndex === fromIndex && !placeAfter) return;

  const toIndex = dropIndexAfterRemoval(fromIndex, dropToIndex, placeAfter);
  if (toIndex === fromIndex) return;

  const doc = view.state.doc.toString();
  const normalized = normalizeSiblingSpans(doc, items);
  const regionFrom = normalized[0].from;
  const regionTo = normalized[normalized.length - 1].to;
  const nextDoc = applyListItemReorder(doc, items, fromIndex, toIndex, {
    ordered,
    startNum
  });
  if (nextDoc == null) return;

  // Region-local replace: prefix/suffix outside the sibling group are unchanged
  // (even when ordered renumber changes digit width inside the region).
  const suffixLen = doc.length - regionTo;
  const newRegion = nextDoc.slice(regionFrom, nextDoc.length - suffixLen);
  view.dispatch({
    changes: { from: regionFrom, to: regionTo, insert: newRegion },
    userEvent: "move.list"
  });
}

function onListDragUp(): void {
  finishListDrag(true);
}

function startListDrag(
  view: EditorView,
  listId: string,
  fromIndex: number,
  items: ListItemSpan[],
  ordered: boolean,
  startNum: number
): void {
  if (activeDrag) finishListDrag(false);
  acquireListEditing(view);
  activeDrag = {
    listId,
    fromIndex,
    items: items.map((it) => ({ ...it })),
    ordered,
    startNum,
    view,
    dropToIndex: fromIndex,
    placeAfter: false
  };
  document.addEventListener("mousemove", onListDragMove);
  document.addEventListener("mouseup", onListDragUp);
  document.body.style.cursor = "grabbing";
  document.body.style.userSelect = "none";
}

class ListItemGripWidget extends WidgetType {
  constructor(
    private readonly listId: string,
    private readonly itemIndex: number,
    private readonly items: ListItemSpan[],
    private readonly ordered: boolean,
    private readonly startNum: number,
    private readonly viewRef: { current: EditorView | null }
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    if (!(other instanceof ListItemGripWidget)) return false;
    return (
      other.listId === this.listId &&
      other.itemIndex === this.itemIndex &&
      other.ordered === this.ordered &&
      other.startNum === this.startNum &&
      other.items.length === this.items.length &&
      other.items.every(
        (it, i) => it.from === this.items[i].from && it.to === this.items[i].to
      )
    );
  }

  ignoreEvent(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const grip = document.createElement("span");
    grip.className = "nexus-list-grip";
    grip.dataset.listId = this.listId;
    grip.dataset.itemIndex = String(this.itemIndex);
    grip.setAttribute("role", "button");
    grip.setAttribute("aria-label", "Drag to reorder list item");
    grip.title = "Drag to reorder";
    grip.textContent = "⠿";
    grip.style.cssText =
      "display:inline-block;width:0.9em;margin-right:0.15em;" +
      "font-size:0.75em;line-height:1;vertical-align:middle;" +
      `color:${GRIP_BG};cursor:grab;user-select:none;` +
      "opacity:0.55;";

    grip.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const view = this.viewRef.current;
      if (!view) return;
      startListDrag(
        view,
        this.listId,
        this.itemIndex,
        this.items,
        this.ordered,
        this.startNum
      );
    });

    return grip;
  }
}

/**
 * Append grip widgets for sibling list items. Call from `buildListDecorations`
 * after computing mdast item spans for the current list level.
 */
export function addListGripDecorations(
  decos: Range<Decoration>[],
  listFrom: number,
  listTo: number,
  items: ListItemSpan[],
  ordered: boolean,
  startNum: number,
  viewRef: { current: EditorView | null },
  /** Item indices that should receive a grip (cursor not on that head line). */
  visibleIndices: readonly number[]
): void {
  if (items.length < 2) return;
  const listId = `${listFrom}:${listTo}`;
  for (const itemIndex of visibleIndices) {
    const span = items[itemIndex];
    if (!span) continue;
    decos.push(
      Decoration.widget({
        widget: new ListItemGripWidget(
          listId,
          itemIndex,
          items,
          ordered,
          startNum,
          viewRef
        ),
        side: -1
      }).range(span.from)
    );
  }
}
