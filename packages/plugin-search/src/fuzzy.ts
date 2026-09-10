export interface NavigationCandidate {
  readonly title: string;
  readonly detail?: string;
}

/** Stable subsequence ranking. Returned entries retain their original identity. */
export function rankNavigationItems<T extends NavigationCandidate>(items: readonly T[], query: string): T[] {
  const needle = query.toLowerCase().trim();
  if (!needle) return items.slice();
  return items.map((item, order) => {
    const title = item.title.toLowerCase();
    const text = `${title} ${item.detail ?? ""}`.toLowerCase();
    let cursor = 0;
    let score = title.startsWith(needle) ? 10000 : title.includes(needle) ? 5000 : 0;
    let previous = -2;
    for (const character of needle) {
      const position = text.indexOf(character, cursor);
      if (position < 0) return { item, order, score: -Infinity };
      score += previous + 1 === position ? 20 : 0;
      score += position === 0 || /[\s/_.-]/.test(text[position - 1]) ? 10 : 0;
      score -= position - cursor;
      previous = position;
      cursor = position + character.length;
    }
    return { item, order, score };
  }).filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .map((entry) => entry.item);
}
