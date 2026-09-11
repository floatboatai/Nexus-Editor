// @vitest-environment node
import { describe, expect, it } from "vitest";
import { diffDocumentText } from "../src/index";

describe("diffDocumentText", () => {
  it.each([
    ["", "中文🙂"], ["one\n", "one"], ["x \n", "x\n"],
    ["🙂\nold\nend", "🙂\nnew\nend"], ["a\r\nb\r\n", "a\nb\n"],
    ["a\nb\nc", "x\nb\ny"], ["delete", ""], ["", ""],
  ])("returns exact UTF-16 ranges for %j → %j", (before, after) => {
    const result = diffDocumentText(before, after);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("Expected complete diff");
    let applied = before;
    for (const hunk of [...result.hunks].reverse()) {
      applied = applied.slice(0, hunk.before.from) + after.slice(hunk.after.from, hunk.after.to) + applied.slice(hunk.before.to);
    }
    expect(applied).toBe(after);
    expect(Object.isFrozen(result.hunks)).toBe(true);
    if (before !== after) expect(result.hunks.length).toBeGreaterThan(0);
  });

  it("counts a supplementary character as two UTF-16 units", () => {
    expect(diffDocumentText("🙂\nold", "🙂\nnew")).toEqual({
      status: "complete", hunks: [{ before: { from: 3, to: 6 }, after: { from: 3, to: 6 } }],
    });
  });

  it("returns limited, never a fabricated empty diff, for all budget classes", () => {
    expect(diffDocumentText("long", "x", { maxInputLength: 2 })).toEqual({ status: "limited", reason: "input" });
    expect(diffDocumentText("a\nb", "x", { maxLines: 1 })).toEqual({ status: "limited", reason: "lines" });
    expect(diffDocumentText("old", "new", { maxEditLength: 0 })).toEqual({ status: "limited", reason: "work" });
    expect(diffDocumentText("old", "new", { timeoutMs: 0 })).toEqual({ status: "limited", reason: "work" });
    expect(diffDocumentText("a\nb\nc", "x\nb\ny", { maxHunks: 1 })).toEqual({ status: "limited", reason: "output" });
    expect(() => diffDocumentText("", "", { timeoutMs: Infinity })).toThrow(RangeError);
  });

  it("honors cancellation before synchronous computation", () => {
    expect(() => diffDocumentText("one", "two", { signal: AbortSignal.abort() })).toThrowError(expect.objectContaining({ name: "AbortError" }));
  });
});
