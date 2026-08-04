export interface ListItemSourceRange {
  from: number;
  to: number;
  markerFrom: number;
  markerTo: number;
}

export interface ListReorderChange {
  from: number;
  to: number;
  insert: string;
}

function validItemRanges(doc: string, items: readonly ListItemSourceRange[]): boolean {
  if (items.length < 2) return false;

  return items.every((item, index) => {
    const previous = items[index - 1];
    return (
      Number.isInteger(item.from) &&
      Number.isInteger(item.to) &&
      item.from >= 0 &&
      item.to <= doc.length &&
      item.from <= item.markerFrom &&
      item.markerFrom < item.markerTo &&
      item.markerTo <= item.to &&
      (!previous || previous.to <= item.from)
    );
  });
}

/** Build one atomic replacement while retaining source spacing and indentation. */
export function createListReorderChange(
  doc: string,
  items: readonly ListItemSourceRange[],
  sourceIndex: number,
  targetIndex: number,
  ordered: boolean,
): ListReorderChange | null {
  if (
    sourceIndex === targetIndex ||
    sourceIndex < 0 ||
    targetIndex < 0 ||
    sourceIndex >= items.length ||
    targetIndex >= items.length ||
    !validItemRanges(doc, items)
  ) {
    return null;
  }

  const itemOrder = items.map((_, index) => index);
  const [movedIndex] = itemOrder.splice(sourceIndex, 1);
  itemOrder.splice(targetIndex, 0, movedIndex);

  // Separators belong to list slots, not item bodies. Keeping them in place
  // preserves compact versus loose-list spacing when an item moves.
  const separators = items.slice(0, -1).map((item, index) =>
    doc.slice(item.to, items[index + 1].from)
  );
  const slotMarkers = items.map((item) => doc.slice(item.markerFrom, item.markerTo));

  const insert = itemOrder.map((itemIndex, slotIndex) => {
    const item = items[itemIndex];
    let source = doc.slice(item.from, item.to);

    // Ordered markers describe positions. Reusing each destination slot's
    // marker keeps sequential, custom-start, and all-ones list styles intact.
    if (ordered) {
      const markerFrom = item.markerFrom - item.from;
      const markerTo = item.markerTo - item.from;
      source = source.slice(0, markerFrom) + slotMarkers[slotIndex] + source.slice(markerTo);
    }

    return source + (separators[slotIndex] ?? "");
  }).join("");

  const from = items[0].from;
  const to = items[items.length - 1].to;
  return insert === doc.slice(from, to) ? null : { from, to, insert };
}
