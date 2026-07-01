import { describe, expect, it } from "vitest";

import {
  findFuzzyNextIndex,
  findFuzzyPreviousIndex,
  findFuzzyReplaceIndex
} from "../src/fuzzy-navigation";

const MATCHES = [
  { from: 0, to: 7 },
  { from: 8, to: 19 }
];

describe("fuzzy-navigation", () => {
  it("finds the next index from the document start", () => {
    expect(findFuzzyNextIndex(MATCHES, 0, 0, 0)).toBe(0);
  });

  it("advances from the current exact match", () => {
    expect(findFuzzyNextIndex(MATCHES, 0, 3, 3)).toBe(1);
  });

  it("steps to the previous match from an exact selection", () => {
    expect(findFuzzyPreviousIndex(MATCHES, 11, 14, 14)).toBe(0);
  });

  it("steps to the previous match when the caret is inside the current span", () => {
    expect(findFuzzyPreviousIndex(MATCHES, 5, 5, 12)).toBe(0);
  });

  it("picks the nearest replace target from the caret", () => {
    expect(findFuzzyReplaceIndex(MATCHES, 5, 5, 12)).toBe(1);
  });
});
