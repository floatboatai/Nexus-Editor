export interface FuzzySearchOptions {
  caseSensitive?: boolean;
}

export interface FuzzyMatchResult {
  score: number;
  positions: number[];
}

const MAX_BACKTRACK_QUERY_LENGTH = 32;
const MAX_BACKTRACK_TARGET_LENGTH = 256;
const MAX_BRANCHES_PER_CHAR = 24;
const MAX_BACKTRACK_PATHS = 4096;

const WORD_BOUNDARY_PATTERN = /[\s\-_./\\()[\]{}:;,.!?]/;

function normalizeForFuzzy(value: string, options: FuzzySearchOptions): string {
  return options.caseSensitive ? value : value.toLowerCase();
}

function isAsciiLowercase(value: string): boolean {
  return value >= "a" && value <= "z";
}

function isAsciiUppercase(value: string): boolean {
  return value >= "A" && value <= "Z";
}

function isCamelBoundary(previous: string, current: string): boolean {
  return isAsciiLowercase(previous) && isAsciiUppercase(current);
}

function isWordBoundary(value: string, index: number): boolean {
  if (index <= 0) return true;

  const previous = value[index - 1];
  const current = value[index];
  return WORD_BOUNDARY_PATTERN.test(previous) || isCamelBoundary(previous, current);
}

function scoreFuzzyPath(target: string, positions: number[]): number {
  if (positions.length === 0) {
    return 0;
  }

  let consecutiveCount = 0;
  let boundaryCount = 0;

  for (let i = 0; i < positions.length; i += 1) {
    const position = positions[i];
    if (i > 0 && position === positions[i - 1] + 1) {
      consecutiveCount += 1;
    }
    if (isWordBoundary(target, position)) {
      boundaryCount += 1;
    }
  }

  const first = positions[0];
  const last = positions[positions.length - 1];
  const span = last - first;

  return positions.length * 10 + consecutiveCount * 15 + boundaryCount * 8 - first * 0.5 - span * 0.1;
}

function greedyFuzzyPath(query: string, target: string): number[] | null {
  const positions: number[] = [];
  let start = 0;

  for (const char of query) {
    const index = target.indexOf(char, start);
    if (index === -1) return null;

    positions.push(index);
    start = index + char.length;
  }

  return positions;
}

function collectBacktrackingPaths(
  query: string,
  target: string,
  queryIndex: number,
  startIndex: number,
  currentPath: number[],
  paths: number[][]
): void {
  if (paths.length >= MAX_BACKTRACK_PATHS) return;

  if (queryIndex === query.length) {
    paths.push([...currentPath]);
    return;
  }

  const char = query[queryIndex];
  let branches = 0;

  for (let i = startIndex; i < target.length; i += 1) {
    if (target[i] !== char) continue;

    currentPath.push(i);
    collectBacktrackingPaths(query, target, queryIndex + 1, i + 1, currentPath, paths);
    currentPath.pop();

    branches += 1;
    if (branches >= MAX_BRANCHES_PER_CHAR || paths.length >= MAX_BACKTRACK_PATHS) {
      break;
    }
  }
}

function collectFuzzyPaths(query: string, target: string): number[][] {
  if (query.length > MAX_BACKTRACK_QUERY_LENGTH || target.length > MAX_BACKTRACK_TARGET_LENGTH) {
    const path = greedyFuzzyPath(query, target);
    return path ? [path] : [];
  }

  const paths: number[][] = [];
  collectBacktrackingPaths(query, target, 0, 0, [], paths);
  return paths;
}

export function fuzzyMatch(
  query: string,
  target: string,
  options: FuzzySearchOptions = {}
): FuzzyMatchResult | null {
  const normalizedQuery = normalizeForFuzzy(query, options);
  const normalizedTarget = normalizeForFuzzy(target, options);

  if (!normalizedQuery || !normalizedTarget) return null;
  if (normalizedQuery.length > normalizedTarget.length) return null;

  const paths = collectFuzzyPaths(normalizedQuery, normalizedTarget);
  let bestResult: FuzzyMatchResult | null = null;

  for (const positions of paths) {
    const score = scoreFuzzyPath(target, positions);
    if (!bestResult || score > bestResult.score) {
      bestResult = { score, positions };
    }
  }

  return bestResult;
}
