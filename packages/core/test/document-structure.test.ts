import type { Root } from "mdast";
import { describe, expect, it } from "vitest";

import { analyzeDocumentStructure } from "../src/index";

describe("analyzeDocumentStructure", () => {
  it("analyzes headings, sections, and stats from markdown text", () => {
    const analysis = analyzeDocumentStructure(
      "# Report\n\nIntro words here.\n\n## Findings\n\nAlpha beta gamma.\n\n### Details\n\nNested words.\n\n## Impression\n\nDone."
    );

    expect(analysis.headings).toEqual([
      expect.objectContaining({ index: 0, level: 1, text: "Report" }),
      expect.objectContaining({ index: 1, level: 2, text: "Findings", parentIndex: 0 }),
      expect.objectContaining({ index: 2, level: 3, text: "Details", parentIndex: 1 }),
      expect.objectContaining({ index: 3, level: 2, text: "Impression", parentIndex: 0 })
    ]);
    expect(analysis.sections).toHaveLength(4);
    expect(analysis.sections[2]).toMatchObject({
      headingIndex: 2,
      level: 3,
      title: "Details",
      wordCount: 2
    });
    expect(analysis.stats).toMatchObject({
      headings: 4,
      sections: 4,
      paragraphs: 4
    });
    expect(analysis.issues).toEqual([]);
  });

  it("accepts an mdast Root without requiring an editor instance", () => {
    const root: Root = {
      type: "root",
      children: [
        {
          type: "heading",
          depth: 1,
          children: [{ type: "text", value: "Manual Root" }]
        },
        {
          type: "paragraph",
          children: [{ type: "text", value: "alpha beta" }]
        }
      ]
    };

    const analysis = analyzeDocumentStructure(root);

    expect(analysis.headings).toEqual([
      expect.objectContaining({ index: 0, level: 1, text: "Manual Root" })
    ]);
    expect(analysis.sections).toEqual([
      expect.objectContaining({ headingIndex: 0, title: "Manual Root", wordCount: 2 })
    ]);
    expect(analysis.stats.words).toBe(4);
  });

  it("reports empty headings, skipped levels, duplicate headings, and missing required headings", () => {
    const analysis = analyzeDocumentStructure(
      "# Intro\n\n### Details\n\n## Findings\n\n## Findings\n\n##\n\nBody.",
      {
        requiredHeadings: ["Intro", "Conclusion"]
      }
    );

    expect(analysis.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "heading-level-skip",
          headingIndex: 1,
          previousLevel: 1,
          actualLevel: 3
        }),
        expect.objectContaining({
          type: "duplicate-heading",
          headingIndex: 3,
          firstHeadingIndex: 2
        }),
        expect.objectContaining({
          type: "empty-heading",
          headingIndex: 4
        }),
        expect.objectContaining({
          type: "missing-required-heading",
          expected: "Conclusion"
        })
      ])
    );
  });

  it("reports sections over the configured word limit", () => {
    const analysis = analyzeDocumentStructure("# Summary\n\none two three four", {
      maxSectionWords: 3
    });

    expect(analysis.sections[0]).toMatchObject({
      headingIndex: 0,
      wordCount: 4
    });
    expect(analysis.issues).toEqual([
      expect.objectContaining({
        type: "section-too-long",
        headingIndex: 0,
        wordCount: 4,
        limit: 3
      })
    ]);
  });

  it("returns a stable empty analysis for an empty document", () => {
    expect(analyzeDocumentStructure("")).toEqual({
      headings: [],
      sections: [],
      stats: {
        headings: 0,
        sections: 0,
        words: 0,
        paragraphs: 0,
        lists: 0,
        tables: 0,
        codeBlocks: 0
      },
      issues: []
    });
  });
});
