export interface FuzzyMatchSpan {
  from: number;
  to: number;
}

/** When the caret sits inside a match, treat it as the match start for "previous". */
export function effectiveCursorForPrevious(cursor: number, matches: readonly FuzzyMatchSpan[]): number {
  for (const match of matches) {
    if (match.from < cursor && cursor <= match.to) {
      return match.from;
    }
  }
  return cursor;
}

export function findFuzzyReplaceIndex(
  matches: readonly FuzzyMatchSpan[],
  selectionFrom: number,
  selectionTo: number,
  cursor: number
): number {
  const exact = matches.findIndex((match) => match.from === selectionFrom && match.to === selectionTo);
  if (exact >= 0) {
    return exact;
  }

  const inside = matches.findIndex((match) => match.from <= cursor && cursor <= match.to);
  if (inside >= 0) {
    return inside;
  }

  const atOrAfter = matches.findIndex((match) => match.from >= cursor);
  return atOrAfter >= 0 ? atOrAfter : 0;
}

export function findFuzzyNextIndex(
  matches: readonly FuzzyMatchSpan[],
  selectionFrom: number,
  selectionTo: number,
  cursor: number
): number {
  if (matches.length === 0) {
    return -1;
  }

  const currentIndex = matches.findIndex(
    (match) => match.from === selectionFrom && match.to === selectionTo
  );
  if (currentIndex >= 0) {
    return (currentIndex + 1) % matches.length;
  }

  const nextIndex = matches.findIndex((match) => match.from >= cursor);
  return nextIndex >= 0 ? nextIndex : 0;
}

export function findFuzzyPreviousIndex(
  matches: readonly FuzzyMatchSpan[],
  selectionFrom: number,
  selectionTo: number,
  cursor: number
): number {
  if (matches.length === 0) {
    return -1;
  }

  const currentIndex = matches.findIndex(
    (match) => match.from === selectionFrom && match.to === selectionTo
  );
  if (currentIndex >= 0) {
    return (currentIndex - 1 + matches.length) % matches.length;
  }

  const effectiveCursor = effectiveCursorForPrevious(cursor, matches);
  let previousIndex = -1;
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].from < effectiveCursor) {
      previousIndex = i;
    }
  }

  return previousIndex >= 0 ? previousIndex : matches.length - 1;
}
