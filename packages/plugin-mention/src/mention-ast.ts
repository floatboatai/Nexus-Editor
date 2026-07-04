/**
 * remark / mdast plugin for parsing and serializing @mention nodes.
 */

import type { Plugin } from "unified";
import type { Node, Parent } from "mdast";
import { visit } from "unist-util-visit";
import type { MentionMdastNode } from "./mention-types";

const MENTION_PATTERN = /\[@([^\]]+)\]\(([^)]+)\)/g;

export const remarkMention: Plugin<[], Node> = () => {
  return (tree: Node) => {
    visit(tree, "text", (node: any, index: number | undefined, parent: Parent | undefined) => {
      if (!parent || typeof index !== "number") return;
      if (typeof node.value !== "string") return;

      const value: string = node.value;
      const matches: Array<{ from: number; to: number; name: string; id: string }> = [];

      let match: RegExpExecArray | null;
      MENTION_PATTERN.lastIndex = 0;
      while ((match = MENTION_PATTERN.exec(value)) !== null) {
        matches.push({
          from: match.index,
          to: match.index + match[0].length,
          name: match[1],
          id: match[2],
        });
      }

      if (matches.length === 0) return;

      const replacements: Node[] = [];
      let cursor = 0;

      for (const m of matches) {
        if (m.from > cursor) {
          replacements.push({ type: "text", value: value.slice(cursor, m.from) } as Node);
        }
        const mentionNode: MentionMdastNode & { type: string } = {
          type: "mention",
          id: m.id,
          name: m.name,
        };
        replacements.push(mentionNode as unknown as Node);
        cursor = m.to;
      }

      if (cursor < value.length) {
        replacements.push({ type: "text", value: value.slice(cursor) } as Node);
      }

      parent.children.splice(index, 1, ...replacements);
      return index + replacements.length;
    });
  };
};

export function stringifyMention(node: MentionMdastNode): string {
  return `[@${node.name}](${node.id})`;
}
