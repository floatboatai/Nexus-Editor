import { describe, expect, it } from "vitest";
import { remarkMention, stringifyMention } from "../src/mention-ast";
import type { MentionMdastNode } from "../src/mention-types";

describe("remarkMention", () => {
  it("parses a single mention into a mention node", () => {
    const tree: any = {
      type: "root",
      children: [{
        type: "paragraph",
        children: [{ type: "text", value: "Hello [@Alice](user-1) welcome!" }],
      }],
    };
    remarkMention()(tree);
    const paragraph = tree.children[0];
    expect(paragraph.children).toHaveLength(3);
    expect(paragraph.children[0]).toMatchObject({ type: "text", value: "Hello " });
    expect(paragraph.children[1]).toMatchObject({ type: "mention", id: "user-1", name: "Alice" });
    expect(paragraph.children[2]).toMatchObject({ type: "text", value: " welcome!" });
  });

  it("parses multiple mentions in one text node", () => {
    const tree: any = {
      type: "root",
      children: [{
        type: "paragraph",
        children: [{ type: "text", value: "[@A](1) and [@B](2)" }],
      }],
    };
    remarkMention()(tree);
    const paragraph = tree.children[0];
    expect(paragraph.children).toHaveLength(4);
    expect(paragraph.children[0]).toMatchObject({ type: "mention", name: "A", id: "1" });
    expect(paragraph.children[1]).toMatchObject({ type: "text", value: " and " });
    expect(paragraph.children[2]).toMatchObject({ type: "mention", name: "B", id: "2" });
  });

  it("leaves plain text untouched when no mention present", () => {
    const tree: any = {
      type: "root",
      children: [{
        type: "paragraph",
        children: [{ type: "text", value: "Just plain text." }],
      }],
    };
    remarkMention()(tree);
    const paragraph = tree.children[0];
    expect(paragraph.children).toHaveLength(1);
    expect(paragraph.children[0]).toMatchObject({ type: "text", value: "Just plain text." });
  });
});

describe("stringifyMention", () => {
  it("serializes a mention node back to markdown", () => {
    const node: MentionMdastNode = { type: "mention", id: "u-42", name: "Bob" };
    expect(stringifyMention(node)).toBe("[@Bob](u-42)");
  });
});
