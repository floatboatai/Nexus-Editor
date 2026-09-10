import { describe, expect, it, vi } from "vitest";
import { rankNavigationItems } from "../src/fuzzy";
import { matchesSearchPath, scanSearchDocument } from "../src/search-matcher";
import {
  SearchController,
  SearchError,
  type SearchExecutor,
  type SearchScanRequest,
} from "../src/workspace";

const document = { id: "a", path: "Notes/例子.md", version: "v1" };
function scan(content: string, text: string, options: Partial<SearchScanRequest> = {}) {
  return scanSearchDocument({ document, content, query: { text }, offset: 0, limit: 50, ...options });
}
function executor(): SearchExecutor {
  return { scan: async (request) => scanSearchDocument(request), dispose: vi.fn() };
}

describe("pure search services", () => {
  it("ranks stable original objects without changing the candidate array", () => {
    const items = Object.freeze([{ title: "Reopen" }, { title: "Open", detail: "中文" }, { title: "Export PDF" }]);
    const result = rankNavigationItems(items, "op");
    expect(result).toEqual([items[1], items[0], items[2]]);
    expect(result[0]).toBe(items[1]);
    expect(rankNavigationItems(items, "")).toEqual(items);
    expect(rankNavigationItems(items, "中文")).toEqual([items[1]]);
  });

  it("uses literal characters and original UTF-16 positions", () => {
    expect(scan("İ\r\n😀 中文 Word", "中文 word").hits[0]).toMatchObject({ from: 6, to: 13, line: 1, column: 3 });
    expect(scan("a.b aXb A.B", "a.b").hits).toHaveLength(2);
    expect(scan("中文 中文字 😀中文 _中文", "中文", { query: { text: "中文", wholeWord: true } }).hits.map((hit) => hit.from)).toEqual([0, 9]);
  });

  it("pages zero-width Unicode matches without repeating boundaries", () => {
    const first = scan("😀", "", { query: { text: "(?=)", regex: true }, limit: 1 });
    expect(first.nextOffset).toBe(2);
    const second = scan("😀", "", { query: { text: "(?=)", regex: true }, offset: 2, limit: 1 });
    expect(second.hits).toMatchObject([{ from: 2, to: 2 }]);
    expect(second.nextOffset).toBeNull();
    expect(scan("x ".repeat(50), "x").nextOffset).toBeNull();
  });

  it("computes capture substitutions inside the isolated matching operation", () => {
    const result = scan("before a12 after", "", { query: { text: "a(?<digits>\\d+)", regex: true, replacement: "[$1/$<digits>/$$/$&]" } });
    expect(result.hits[0].replacement).toBe("[12/12/$/a12]");
    expect(scan("a", "a", { query: { text: "a", replacement: "$1" } }).hits[0].replacement).toBe("$1");
    expect(() => scan("a", "", { query: { text: "[", regex: true } })).toThrow();
    expect(() => scan("prefix a a suffix", "", {
      query: { text: "a", regex: true, replacement: "$`$'" }, maxReplacementBytes: 8,
    })).toThrow("file-size limit");
  });

  it("matches bounded globs and rejects excessive filters", () => {
    expect(matchesSearchPath("note.md", "**/*.md")).toBe(true);
    expect(matchesSearchPath("Notes/a/b.md", "Notes/*.md")).toBe(false);
    expect(matchesSearchPath("Archive/a.md", "*.md", "Archive/")).toBe(false);
    expect(matchesSearchPath("Notes/😀.md", "missing, 😀.md")).toBe(true);
    expect(() => matchesSearchPath("x", "*".repeat(4097))).toThrow();
  });
});

describe("workspace search lifecycle", () => {
  it("streams bounded pages with configurable limits and destroys the owned executor", async () => {
    const scanner = executor();
    const controller = new SearchController({
      source: { list: async () => [document], read: async () => ({ content: "x ".repeat(5110), version: "v1" }) },
      executor: scanner,
    });
    const lengths: number[] = [];
    controller.subscribe((state) => lengths.push(state.hits.length));
    await controller.search({ text: "x" });
    expect(controller.getState().hits).toHaveLength(200);
    expect(lengths).toContain(50);
    while (controller.getState().hasMore) await controller.loadMore();
    expect(controller.getState().hits).toHaveLength(5000);
    expect(controller.getState().truncated).toBe(true);
    expect(new Set(controller.getState().hits.map((hit) => hit.from)).size).toBe(5000);
    await controller.destroy();
    expect(scanner.dispose).toHaveBeenCalledOnce();
  });

  it("skips oversized metadata before reading and validates loaded byte size", async () => {
    const read = vi.fn(async () => ({ content: "中文", version: "v1" }));
    const controller = new SearchController({
      source: { list: async () => [{ ...document, size: 10 }, { ...document, id: "b", path: "B.md" }], read },
      executor: executor(), limits: { maxFileBytes: 5 },
    });
    await controller.search({ text: "中" });
    expect(read).toHaveBeenCalledTimes(1);
    expect(controller.getState().skippedFiles).toBe(2);
    await controller.destroy();
  });

  it("settles cancellation even when source enumeration ignores its signal", async () => {
    const controller = new SearchController({
      source: { list: () => new Promise(() => undefined), read: async () => ({ content: "", version: "v1" }) },
      executor: executor(),
    });
    const pending = controller.search({ text: "x" });
    controller.cancel();
    await pending;
    expect(controller.getState().status).toBe("idle");
    await controller.destroy();
  });

  it("skips explicitly unavailable files without discarding other matches", async () => {
    const controller = new SearchController({
      source: {
        list: async () => [document, { ...document, id: "missing", path: "Missing.md" }],
        read: async (file) => {
          if (file.id === "missing") throw new SearchError("file-unavailable", "File was removed");
          return { content: "needle", version: document.version };
        },
      },
      executor: executor(),
    });
    try {
      await controller.search({ text: "needle" });
      expect(controller.getState()).toMatchObject({ status: "ready", skippedFiles: 1, error: null });
      expect(controller.getState().hits).toMatchObject([{ fileId: document.id }]);
    } finally {
      await controller.destroy();
    }
  });

  it("does not disguise other source failures as skipped files", async () => {
    const controller = new SearchController({
      source: {
        list: async () => [document],
        read: async () => { throw new Error("The entire source is unavailable"); },
      },
      executor: executor(),
    });
    try {
      await controller.search({ text: "needle" });
      expect(controller.getState()).toMatchObject({ status: "error", skippedFiles: 0 });
    } finally {
      await controller.destroy();
    }
  });

  it("withdraws earlier pages when a file becomes unavailable before the next page", async () => {
    let missing = false;
    const controller = new SearchController({
      source: {
        list: async () => [document],
        read: async () => {
          if (missing) throw new SearchError("file-unavailable", "File was removed");
          return { content: "x x", version: document.version };
        },
      },
      executor: executor(),
      limits: { pageSize: 1 },
    });
    try {
      await controller.search({ text: "x" });
      expect(controller.getState().hits).toHaveLength(1);
      missing = true;
      await controller.loadMore();
      expect(controller.getState()).toMatchObject({
        status: "ready",
        hits: [],
        skippedFiles: 1,
        hasMore: false,
      });
    } finally {
      await controller.destroy();
    }
  });

  it("rejects a changed version between listing and reading without exposing old hits", async () => {
    vi.useFakeTimers();
    let version = "v1";
    const controller = new SearchController({
      source: {
        list: async () => [{ ...document, version }],
        read: async () => { version = "v2"; return { content: "current", version }; },
      }, executor: executor(),
    });
    try {
      await controller.search({ text: "current" });
      expect(controller.getState().hits).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(181);
      expect(controller.getState().hits[0].version).toBe("v2");
    } finally { await controller.destroy(); vi.useRealTimers(); }
  });

  it("revalidates the cached document before resuming pagination", async () => {
    let version = "v1";
    const controller = new SearchController({
      source: {
        list: async () => [{ ...document, version }],
        read: async () => ({ content: "x ".repeat(300), version }),
      }, executor: executor(),
    });
    await controller.search({ text: "x" });
    version = "v2";
    await controller.loadMore();
    expect(controller.getState().hits).toHaveLength(0);
    expect(controller.getState().hasMore).toBe(false);
    await controller.destroy();
  });

  it("does not allow cancelled results to replace a newer query", async () => {
    let release: (() => void) | undefined;
    let first = true;
    const controller = new SearchController({
      source: { list: async () => [document], read: async () => ({ content: "old new", version: "v1" }) },
      executor: {
        scan: async (request) => {
          if (first) {
            first = false;
            await new Promise<void>((resolve) => { release = resolve; });
          }
          return scanSearchDocument(request);
        }, dispose() {},
      },
    });
    const pending = controller.search({ text: "old" });
    await vi.waitFor(() => expect(release).toBeDefined());
    await controller.search({ text: "new" });
    release?.();
    await pending;
    expect(controller.getState().hits).toMatchObject([{ from: 4 }]);
    await controller.destroy();
  });
});
