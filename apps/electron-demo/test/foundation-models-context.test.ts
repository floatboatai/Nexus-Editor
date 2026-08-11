import { describe, expect, it } from "vitest";
import { findSuggestionContext } from "../src/renderer/foundation-models-context";

describe("findSuggestionContext", () => {
  it("returns the current plain paragraph range at the paragraph end", () => {
    expect(findSuggestionContext("A normal paragraph", 18)).toEqual({
      from: 0,
      to: 18,
      paragraph: "A normal paragraph",
    });

    expect(findSuggestionContext("Intro\n\nA normal paragraph", 25)).toEqual({
      from: 7,
      to: 25,
      paragraph: "A normal paragraph",
    });
  });

  it("rejects non-terminal cursors and blank paragraphs", () => {
    expect(findSuggestionContext("A normal paragraph", 5)).toBeNull();
    expect(findSuggestionContext("", 0)).toBeNull();
    expect(findSuggestionContext("First\n\n  ", 9)).toBeNull();
  });

  it("keeps trailing spaces before the cursor inside the eligible paragraph", () => {
    expect(findSuggestionContext("A normal paragraph  ", 20)).toEqual({
      from: 0,
      to: 20,
      paragraph: "A normal paragraph  ",
    });
  });

  it("supports CRLF paragraph boundaries and offsets", () => {
    const document = "One\r\n\r\nSecond paragraph";

    expect(findSuggestionContext(document, document.length)).toEqual({
      from: 7,
      to: 23,
      paragraph: "Second paragraph",
    });
  });

  it("rejects structural Markdown paragraphs", () => {
    expect(findSuggestionContext("# Heading", 9)).toBeNull();
    expect(findSuggestionContext("## Heading", 10)).toBeNull();
    expect(findSuggestionContext("- list item", 11)).toBeNull();
    expect(findSuggestionContext("1. list item", 12)).toBeNull();
    expect(findSuggestionContext("- [ ] task", 10)).toBeNull();
    expect(findSuggestionContext("> quoted", 8)).toBeNull();
    expect(findSuggestionContext("| a | b |", 9)).toBeNull();
    expect(findSuggestionContext("| --- | --- |", 13)).toBeNull();
    expect(findSuggestionContext("---", 3)).toBeNull();
  });

  it("rejects paragraphs inside fenced code blocks", () => {
    expect(findSuggestionContext("```\ncode\n```", 8)).toBeNull();
    expect(findSuggestionContext("before\n```ts\ncode", 17)).toBeNull();
    expect(findSuggestionContext("```\ncode\n```\n\nAfter", 19)).toEqual({
      from: 14,
      to: 19,
      paragraph: "After",
    });
  });

  it("rejects paragraphs containing conservative inline Markdown syntax", () => {
    expect(findSuggestionContext("A [link](url)", 13)).toBeNull();
    expect(findSuggestionContext("A [link](url)", 5)).toBeNull();
    expect(findSuggestionContext("An ![image](url)", 15)).toBeNull();
    expect(findSuggestionContext("A `code` span", 13)).toBeNull();
    expect(findSuggestionContext("A *strong* claim", 16)).toBeNull();
    expect(findSuggestionContext("A _strong_ claim", 16)).toBeNull();
  });

  it("rejects invalid positions", () => {
    expect(findSuggestionContext("A normal paragraph", -1)).toBeNull();
    expect(findSuggestionContext("A normal paragraph", 19)).toBeNull();
  });
});
