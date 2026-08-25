import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyMatch } from "../src/fuzzy";

describe("fuzzyMatch", () => {
  it("matches a contiguous prefix", () => {
    const match = fuzzyMatch("gamma", "gam");
    expect(match).not.toBeNull();
    expect(match!.positions).toEqual([0, 1, 2]);
    expect(match!.score).toBeGreaterThan(0);
  });

  it("matches non-contiguous subsequences", () => {
    const match = fuzzyMatch("gamma cluster", "gcl");
    expect(match).not.toBeNull();
    // g(0) c(6) l(7)
    expect(match!.positions).toEqual([0, 6, 7]);
  });

  it("returns null when the query is not a subsequence", () => {
    expect(fuzzyMatch("gamma", "gax")).toBeNull();
    expect(fuzzyMatch("gamma", "amg")).toBeNull();
  });

  it("treats an empty query as a zero-score match with no positions", () => {
    expect(fuzzyMatch("gamma", "")).toEqual({ score: 0, positions: [] });
  });

  it("returns null for an empty target with a non-empty query", () => {
    expect(fuzzyMatch("", "a")).toBeNull();
  });

  it("is case-insensitive by default", () => {
    const match = fuzzyMatch("Gamma Cluster", "gc");
    expect(match).not.toBeNull();
    expect(match!.positions).toEqual([0, 6]);
  });

  it("respects caseSensitive option", () => {
    expect(fuzzyMatch("Gamma", "g", { caseSensitive: true })).toBeNull();
    expect(fuzzyMatch("Gamma", "G", { caseSensitive: true })).not.toBeNull();
  });

  it("scores a start-of-string match higher than a later match", () => {
    const start = fuzzyMatch("abc", "a")!;
    const later = fuzzyMatch("xxxa", "a")!;
    expect(start.score).toBeGreaterThan(later.score);
  });

  it("scores consecutive matches higher than scattered ones", () => {
    const consecutive = fuzzyMatch("abcdef", "abc")!;
    const scattered = fuzzyMatch("axbxcx", "abc")!;
    expect(consecutive.score).toBeGreaterThan(scattered.score);
  });

  it("rewards matches at word boundaries", () => {
    // "fb" against "foo bar" should align f(0) b(4, after a space) and beat
    // a same-length alignment that lands mid-word.
    const match = fuzzyMatch("foo bar", "fb")!;
    expect(match.positions).toEqual([0, 4]);
  });

  it("rewards camelCase humps as boundaries", () => {
    const match = fuzzyMatch("fooBar", "fb")!;
    expect(match.positions).toEqual([0, 3]);
  });

  it("handles a query equal to the target", () => {
    const match = fuzzyMatch("abc", "abc")!;
    expect(match.positions).toEqual([0, 1, 2]);
  });

  it("does not exceed target length in positions", () => {
    const match = fuzzyMatch("aaa", "aa")!;
    expect(match.positions.every((p) => p >= 0 && p < 3)).toBe(true);
    expect(match.positions).toEqual([0, 1]);
  });

  it("stays bounded on pathological repeated-character input", () => {
    const target = "a".repeat(2000);
    const query = "a".repeat(8);
    const match = fuzzyMatch(target, query);
    expect(match).not.toBeNull();
    expect(match!.positions).toHaveLength(8);
  });
});

describe("fuzzyFilter", () => {
  const commands = ["Heading 1", "Heading 2", "Bullet List", "Code Block", "Blockquote"];

  it("ranks matches best-first and drops non-matches", () => {
    const results = fuzzyFilter(commands, "head");
    expect(results.map((r) => r.item)).toEqual(["Heading 1", "Heading 2"]);
  });

  it("returns every item in original order for an empty query", () => {
    const results = fuzzyFilter(commands, "");
    expect(results.map((r) => r.item)).toEqual(commands);
    expect(results.every((r) => r.score === 0)).toBe(true);
  });

  it("matches subsequences across the candidate", () => {
    const results = fuzzyFilter(commands, "bl");
    // "Bullet List", "Code Block", "Blockquote" all contain b...l as a subsequence
    expect(results.map((r) => r.item)).toContain("Blockquote");
    expect(results.map((r) => r.item)).toContain("Bullet List");
    expect(results.map((r) => r.item)).toContain("Code Block");
  });

  it("ranks a prefix match above a mid-string match", () => {
    const results = fuzzyFilter(commands, "block");
    expect(results[0].item).toBe("Blockquote");
  });

  it("supports a key extractor for object items", () => {
    const items = [
      { id: 1, label: "Insert Table" },
      { id: 2, label: "Insert Image" }
    ];
    const results = fuzzyFilter(items, "img", { key: (i) => i.label });
    expect(results).toHaveLength(1);
    expect(results[0].item.id).toBe(2);
  });

  it("honors the limit option after sorting", () => {
    const results = fuzzyFilter(commands, "e", { limit: 2 });
    expect(results).toHaveLength(2);
  });

  it("treats a non-positive limit as no limit", () => {
    const all = fuzzyFilter(commands, "e", { limit: 0 });
    const unlimited = fuzzyFilter(commands, "e");
    expect(all.map((r) => r.item)).toEqual(unlimited.map((r) => r.item));
  });

  it("returns matched positions for highlighting", () => {
    const results = fuzzyFilter(["Heading 1"], "hd");
    expect(results[0].positions).toEqual([0, 3]);
  });

  it("keeps equal-score results in original order", () => {
    const tied = ["abx", "aby"];
    const results = fuzzyFilter(tied, "ab");
    expect(results.map((r) => r.item)).toEqual(["abx", "aby"]);
  });
});
