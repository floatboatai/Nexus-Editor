import { describe, expect, it } from "vitest";
import { buildAIContext, formatContextPath } from "../src/renderer/ai-context";

describe("formatContextPath", () => {
  it("uses vault-relative paths when possible", () => {
    expect(formatContextPath("/vault/Projects/Nexus.md", "/vault")).toBe("Projects/Nexus.md");
  });

  it("falls back to normalized absolute paths outside a vault", () => {
    expect(formatContextPath("C:\\notes\\Nexus.md", "D:\\vault")).toBe("C:/notes/Nexus.md");
  });

  it("labels missing files as untitled", () => {
    expect(formatContextPath(null, "/vault")).toBe("Untitled");
  });
});

describe("buildAIContext", () => {
  it("builds a structured context bundle for the active note", () => {
    const context = buildAIContext({
      activeFile: "/vault/Projects/Nexus.md",
      vaultPath: "/vault",
      document: "# Nexus\n\nCurrent plan",
      selectedText: "Current plan",
      stats: { characters: 22, words: 3, lines: 3 },
      outline: [{ level: 1, text: "Nexus", from: 0, to: 7 }],
      backlinks: [
        {
          sourcePath: "/vault/Daily/Today.md",
          target: "Nexus",
          from: 4,
          to: 13,
          snippet: "Review [[Nexus]] before sending the PR.",
        },
      ],
      unlinkedMentions: [],
    });

    expect(context).toContain("# Nexus AI Context");
    expect(context).toContain("- Path: Projects/Nexus.md");
    expect(context).toContain("## Selected Text");
    expect(context).toContain("Current plan");
    expect(context).toContain("- H1 Nexus");
    expect(context).toContain("- Daily/Today.md: Review [[Nexus]] before sending the PR.");
    expect(context).toContain("## Markdown");
    expect(context).toContain("# Nexus\n\nCurrent plan");
  });

  it("omits empty selected text and caps long mention lists", () => {
    const context = buildAIContext({
      activeFile: "/vault/Nexus.md",
      vaultPath: "/vault",
      document: "body",
      selectedText: "   ",
      stats: { characters: 4, words: 1, lines: 1 },
      outline: [],
      backlinks: [
        { sourcePath: "/vault/1.md", target: "Nexus", from: 0, to: 5, snippet: "one" },
        { sourcePath: "/vault/2.md", target: "Nexus", from: 0, to: 5, snippet: "two" },
      ],
      unlinkedMentions: [],
      maxMentions: 1,
    });

    expect(context).not.toContain("## Selected Text");
    expect(context).toContain("## Outline\nNone");
    expect(context).toContain("- 1.md: one");
    expect(context).toContain("... and 1 more mentions");
    expect(context).not.toContain("- 2.md: two");
  });

  it("uses a longer code fence when markdown contains backticks", () => {
    const context = buildAIContext({
      activeFile: null,
      vaultPath: null,
      document: "```ts\nconst value = 1;\n```",
      selectedText: "",
      stats: { characters: 25, words: 3, lines: 3 },
      outline: [],
      backlinks: [],
      unlinkedMentions: [],
    });

    expect(context).toContain("````markdown\n```ts\nconst value = 1;\n```\n````");
  });
});
