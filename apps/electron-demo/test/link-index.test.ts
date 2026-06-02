import { describe, expect, it } from "vitest";
import {
  LinkIndex,
  findAnchorPosition,
  parseAnchor,
  stripAnchor,
} from "../src/renderer/link-index";

describe("LinkIndex.resolve", () => {
  it("resolves a globally unique basename", () => {
    const idx = new LinkIndex();
    idx.rebuild([
      { path: "/vault/Topics/AI.md", content: "# AI" },
      { path: "/vault/Journal/2026.md", content: "see [[AI]] today" },
    ]);
    expect(idx.resolve("AI", "/vault/Journal/2026.md")).toBe("/vault/Topics/AI.md");
  });

  it("prefers a same-directory neighbor over a globally ambiguous name", () => {
    const idx = new LinkIndex();
    idx.rebuild([
      { path: "/v/work/Meeting.md", content: "" },
      { path: "/v/personal/Meeting.md", content: "" },
      { path: "/v/work/Inbox.md", content: "[[Meeting]]" },
    ]);
    expect(idx.resolve("Meeting", "/v/work/Inbox.md")).toBe("/v/work/Meeting.md");
  });

  it("returns null for a completely unknown name", () => {
    const idx = new LinkIndex();
    idx.rebuild([{ path: "/v/a.md", content: "" }]);
    expect(idx.resolve("Ghost", "/v/a.md")).toBeNull();
  });

  it("returns an exact absolute-path match", () => {
    const idx = new LinkIndex();
    idx.rebuild([{ path: "/v/nested/a.md", content: "" }]);
    expect(idx.resolve("/v/nested/a.md", "/v/other.md")).toBe("/v/nested/a.md");
  });
});

describe("LinkIndex.backlinks", () => {
  it("lists inbound references with source path and snippet", () => {
    const idx = new LinkIndex();
    idx.rebuild([
      { path: "/v/Meeting.md", content: "# Meeting" },
      { path: "/v/Inbox.md", content: "line\nSee [[Meeting]] tomorrow" },
      { path: "/v/Diary.md", content: "[[Meeting|notes]] again" },
    ]);
    const hits = idx.getBacklinks("/v/Meeting.md");
    expect(hits).toHaveLength(2);
    const sources = hits.map((h) => h.sourcePath).sort();
    expect(sources).toEqual(["/v/Diary.md", "/v/Inbox.md"]);
    const inbox = hits.find((h) => h.sourcePath === "/v/Inbox.md")!;
    expect(inbox.snippet).toBe("See [[Meeting]] tomorrow");
  });

  it("updates backlinks incrementally when a file is edited", () => {
    const idx = new LinkIndex();
    idx.rebuild([
      { path: "/v/X.md", content: "" },
      { path: "/v/Y.md", content: "" },
      { path: "/v/a.md", content: "[[X]]" },
    ]);
    expect(idx.getBacklinks("/v/X.md").map((h) => h.sourcePath)).toEqual(["/v/a.md"]);
    expect(idx.getBacklinks("/v/Y.md")).toEqual([]);

    idx.updateFile("/v/a.md", "[[Y]]");
    expect(idx.getBacklinks("/v/X.md")).toEqual([]);
    expect(idx.getBacklinks("/v/Y.md").map((h) => h.sourcePath)).toEqual(["/v/a.md"]);
  });

  it("drops edges when a file is removed", () => {
    const idx = new LinkIndex();
    idx.rebuild([
      { path: "/v/X.md", content: "" },
      { path: "/v/a.md", content: "[[X]]" },
    ]);
    expect(idx.getBacklinks("/v/X.md")).toHaveLength(1);
    idx.removeFile("/v/a.md");
    expect(idx.getBacklinks("/v/X.md")).toHaveLength(0);
  });
});

describe("LinkIndex.getAllNoteNames", () => {
  it("returns dedup'd basenames without extension", () => {
    const idx = new LinkIndex();
    idx.rebuild([
      { path: "/v/a/Apple.md", content: "" },
      { path: "/v/b/Banana.md", content: "" },
    ]);
    expect(idx.getAllNoteNames()).toEqual(["Apple", "Banana"]);
  });
});

describe("stripAnchor", () => {
  it("returns the target unchanged when no anchor is present", () => {
    expect(stripAnchor("Foo")).toBe("Foo");
    expect(stripAnchor("Folder/Foo")).toBe("Folder/Foo");
  });

  it("strips # heading anchors", () => {
    expect(stripAnchor("Foo#Heading")).toBe("Foo");
    expect(stripAnchor("Folder/Foo#Heading text")).toBe("Folder/Foo");
  });

  it("strips ^ block anchors", () => {
    expect(stripAnchor("Foo^block-id")).toBe("Foo");
  });

  it("uses whichever anchor marker appears first", () => {
    expect(stripAnchor("Foo#bar^baz")).toBe("Foo");
    expect(stripAnchor("Foo^baz#bar")).toBe("Foo");
  });

  it("returns empty when the target begins with an anchor marker", () => {
    expect(stripAnchor("#Heading")).toBe("");
    expect(stripAnchor("^block")).toBe("");
  });
});

describe("parseAnchor", () => {
  it("returns null anchor when the target has none", () => {
    expect(parseAnchor("Foo")).toEqual({ bare: "Foo", anchor: null });
  });

  it("splits heading anchors", () => {
    expect(parseAnchor("Foo#Bar")).toEqual({
      bare: "Foo",
      anchor: { kind: "heading", value: "Bar" },
    });
  });

  it("splits block anchors", () => {
    expect(parseAnchor("Foo^blk-1")).toEqual({
      bare: "Foo",
      anchor: { kind: "block", value: "blk-1" },
    });
  });

  it("respects the first marker (heading wins over later ^)", () => {
    expect(parseAnchor("Foo#Head^ignored")).toEqual({
      bare: "Foo",
      anchor: { kind: "heading", value: "Head^ignored" },
    });
  });

  it("allows bare anchors (same-file jump)", () => {
    expect(parseAnchor("#Bar")).toEqual({
      bare: "",
      anchor: { kind: "heading", value: "Bar" },
    });
  });
});

describe("findAnchorPosition", () => {
  it("locates a top-level heading line", () => {
    const doc = "intro line\n# First\ntext\n## Second section\nmore";
    const pos = findAnchorPosition(doc, { kind: "heading", value: "Second section" });
    expect(pos).not.toBeNull();
    // Should point at the line start
    expect(doc.slice(pos!, pos! + 18)).toBe("## Second section\n");
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    const doc = "# Hello    World\nbody";
    const pos = findAnchorPosition(doc, { kind: "heading", value: "hello world" });
    expect(pos).toBe(0);
  });

  it("returns null when no heading matches", () => {
    const doc = "# Alpha\n## Beta";
    expect(findAnchorPosition(doc, { kind: "heading", value: "Gamma" })).toBeNull();
  });

  it("matches the last segment of a nested heading path", () => {
    const doc = "# Parent\ntext\n## Child\nmore";
    const pos = findAnchorPosition(doc, { kind: "heading", value: "Parent#Child" });
    expect(pos).not.toBeNull();
    expect(doc.slice(pos!).startsWith("## Child")).toBe(true);
  });

  it("locates block refs at end of line", () => {
    const doc = "first line\nanchor paragraph ^blk-1\nnext line";
    const pos = findAnchorPosition(doc, { kind: "block", value: "blk-1" });
    expect(pos).not.toBeNull();
    expect(doc.slice(pos!).startsWith("anchor paragraph")).toBe(true);
  });

  it("returns null for unknown block refs", () => {
    expect(findAnchorPosition("no markers here", { kind: "block", value: "nope" })).toBeNull();
  });
});

describe("LinkIndex.resolve — anchor-aware", () => {
  it("resolves [[Foo#Heading]] to the file Foo.md", () => {
    const idx = new LinkIndex();
    idx.rebuild([
      { path: "/v/Nexus-Editor.md", content: "# Nexus" },
      { path: "/v/Ideas.md", content: "[[Nexus-Editor#Context]]" },
    ]);
    expect(idx.resolve("Nexus-Editor#Context", "/v/Ideas.md")).toBe("/v/Nexus-Editor.md");
  });

  it("resolves [[Folder/Foo^block]] to the file Folder/Foo.md", () => {
    const idx = new LinkIndex();
    idx.rebuild([
      { path: "/v/Projects/Nexus-Editor.md", content: "# Nexus" },
      { path: "/v/Projects/Ideas.md", content: "[[Projects/Nexus-Editor^block]]" },
    ]);
    expect(idx.resolve("Projects/Nexus-Editor^block", "/v/Projects/Ideas.md")).toBe(
      "/v/Projects/Nexus-Editor.md",
    );
  });

  it("bare anchors with no target are unresolved", () => {
    const idx = new LinkIndex();
    idx.rebuild([{ path: "/v/a.md", content: "" }]);
    expect(idx.resolve("#Just a heading", "/v/a.md")).toBeNull();
  });
});

describe("LinkIndex.getUnlinkedMentions", () => {
  it("finds plain-text basename mentions across other files", () => {
    const idx = new LinkIndex();
    idx.rebuild([
      { path: "/v/Meeting.md", content: "# Meeting notes" },
      { path: "/v/a.md", content: "Talked about Meeting yesterday." },
      { path: "/v/b.md", content: "No mention here." },
    ]);
    const hits = idx.getUnlinkedMentions("/v/Meeting.md");
    expect(hits).toHaveLength(1);
    expect(hits[0].sourcePath).toBe("/v/a.md");
    expect(hits[0].snippet).toBe("Talked about Meeting yesterday.");
  });

  it("is case-insensitive and word-bounded", () => {
    const idx = new LinkIndex();
    idx.rebuild([
      { path: "/v/AI.md", content: "" },
      { path: "/v/a.md", content: "AI is great; ai rules; SAIL not ai-topic" },
    ]);
    const hits = idx.getUnlinkedMentions("/v/AI.md");
    // `AI`, `ai`, `ai` (in `ai-topic`) are matches; `SAIL` is not (no boundary).
    // Total: 3 matches in a.md.
    expect(hits).toHaveLength(3);
    expect(hits.every((h) => h.sourcePath === "/v/a.md")).toBe(true);
  });

  it("excludes occurrences that fall inside existing wiki links", () => {
    const idx = new LinkIndex();
    idx.rebuild([
      { path: "/v/Meeting.md", content: "" },
      { path: "/v/a.md", content: "See [[Meeting]] and Meeting again" },
    ]);
    const hits = idx.getUnlinkedMentions("/v/Meeting.md");
    // The bracketed occurrence is a linked mention; only the bare one counts.
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toBe("See [[Meeting]] and Meeting again");
  });

  it("excludes self-mentions in the target file", () => {
    const idx = new LinkIndex();
    idx.rebuild([{ path: "/v/Meeting.md", content: "# Meeting — the word Meeting appears" }]);
    expect(idx.getUnlinkedMentions("/v/Meeting.md")).toEqual([]);
  });

  it("returns empty when the target has an empty basename", () => {
    const idx = new LinkIndex();
    idx.rebuild([{ path: "/v/.md", content: "hi" }]);
    expect(idx.getUnlinkedMentions("/v/.md")).toEqual([]);
  });

  it("escapes regex special chars in the basename", () => {
    const idx = new LinkIndex();
    idx.rebuild([
      { path: "/v/C++ notes.md", content: "" },
      { path: "/v/a.md", content: "I love C++ notes and also Cxx notes" },
    ]);
    const hits = idx.getUnlinkedMentions("/v/C++ notes.md");
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toBe("I love C++ notes and also Cxx notes");
  });
});

describe("LinkIndex.subscribe", () => {
  it("fires listeners on rebuild and updateFile", async () => {
    const idx = new LinkIndex();
    let count = 0;
    idx.subscribe(() => {
      count++;
    });
    idx.rebuild([{ path: "/v/a.md", content: "" }]);
    idx.updateFile("/v/a.md", "[[X]]");
    idx.removeFile("/v/a.md");
    // Notifications are rAF-coalesced to avoid redundant subscriber re-renders
    // under keystroke bursts; rapid successive mutations collapse into a
    // single tick. Wait for rAF to flush.
    await new Promise((r) => setTimeout(r, 30));
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(3);
  });
});
