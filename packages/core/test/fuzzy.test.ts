import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyMatch } from "../src/fuzzy";

describe("fuzzyMatch", () => {
  it("returns null for empty query", () => {
    expect(fuzzyMatch("", "Hello")).toBeNull();
  });

  it("returns a match for exact string", () => {
    const result = fuzzyMatch("hello", "Hello World");
    expect(result).not.toBeNull();
    expect(result!.item).toBe("Hello World");
    expect(result!.score).toBeGreaterThan(0);
    expect(result!.indices.length).toBe(5);
  });

  it("matches non-contiguous characters", () => {
    const result = fuzzyMatch("hlg", "Highlight");
    expect(result).not.toBeNull();
    expect(result!.item).toBe("Highlight");
    // h=0, l=4, g=6 → the greedy matcher picks the first valid path
    expect(result!.indices).toContain(0); // H
    expect(result!.indices.length).toBe(3); // three characters matched
  });

  it("returns null when not all query characters match", () => {
    expect(fuzzyMatch("xyz", "Hello World")).toBeNull();
  });

  it("scores word boundary matches higher than mid-word matches", () => {
    const boundary = fuzzyMatch("w", "Hello World");
    const midWord = fuzzyMatch("o", "Hello World");

    expect(boundary).not.toBeNull();
    expect(midWord).not.toBeNull();
    // "W" is at a word boundary, "o" is not → boundary should score higher
    expect(boundary!.score).toBeGreaterThan(midWord!.score);
  });

  it("scores prefix matches highest", () => {
    const prefix = fuzzyMatch("h", "Hello");
    const midWord = fuzzyMatch("h", "Uh oh");

    expect(prefix).not.toBeNull();
    expect(midWord).not.toBeNull();
    expect(prefix!.score).toBeGreaterThan(midWord!.score);
  });

  it("is case-insensitive", () => {
    const lower = fuzzyMatch("hello", "HELLO");
    const upper = fuzzyMatch("HELLO", "hello");
    const mixed = fuzzyMatch("hElLo", "HeLlO");

    expect(lower).not.toBeNull();
    expect(upper).not.toBeNull();
    expect(mixed).not.toBeNull();
    expect(lower!.score).toBe(upper!.score);
    expect(lower!.score).toBe(mixed!.score);
  });
});

describe("fuzzyFilter", () => {
  it("returns empty array for empty query", () => {
    expect(fuzzyFilter("", ["Hello", "World"])).toEqual([]);
  });

  it("returns matches sorted by score descending", () => {
    const items = ["Highlight", "Bold", "Heading", "Horizontal Rule"];
    const results = fuzzyFilter("h", items);

    expect(results.length).toBe(3); // Highlight, Heading, Horizontal Rule (not Bold)
    // Heading and Highlight are prefix matches, Horizontal Rule is word-boundary match
    // All should be present; prefix matches should score higher
    const ids = results.map((r) => r.item);
    expect(ids).toContain("Heading");
    expect(ids).toContain("Highlight");
    expect(ids).toContain("Horizontal Rule");

    // First result should be a prefix match (score > word-boundary match)
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });

  it("matches non-contiguous characters across items", () => {
    const items = ["Heading", "Bold", "Horizontal Rule"];
    const results = fuzzyFilter("hr", items);

    // "hr" should match "Horizontal Rule" (h=0, r=11 at word boundary)
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.item === "Horizontal Rule")).toBe(true);
  });

  it("returns empty when no items match", () => {
    expect(fuzzyFilter("zzz", ["Hello", "World"])).toEqual([]);
  });

  it("provides match indices for highlighting", () => {
    const results = fuzzyFilter("hl", ["Hello"]);
    expect(results.length).toBe(1);
    expect(results[0].indices).toContain(0); // H
    expect(results[0].indices).toContain(2); // first l in Hello (index 2)
  });

  it("scores contiguous matches higher than gapped matches", () => {
    const contiguous = fuzzyMatch("he", "Hello"); // h=0, e=1 (contiguous)
    const gapped = fuzzyMatch("hl", "Hello");     // h=0, l=4 (gap in between)

    expect(contiguous).not.toBeNull();
    expect(gapped).not.toBeNull();
    expect(contiguous!.score).toBeGreaterThan(gapped!.score);
  });

  it("handles single character query", () => {
    const results = fuzzyFilter("a", ["Alpha", "Beta", "Gamma"]);
    const items = results.map((r) => r.item);
    expect(items).toContain("Alpha");
    expect(items).toContain("Gamma");
    expect(items).toContain("Beta"); // "a" in "Beta" matches too
    // Alpha and Gamma should score higher (word boundary) than Beta
    const alpha = results.find((r) => r.item === "Alpha")!;
    const beta = results.find((r) => r.item === "Beta")!;
    expect(alpha.score).toBeGreaterThan(beta.score);
  });
});
