import type {
  BlockContext,
  LeafBlock,
  LeafBlockParser,
  Line,
  MarkdownConfig,
} from "@lezer/markdown";

// GFM-style footnote syntax:
//   * Inline reference: `[^id]` — emits FootnoteReference with FootnoteMark + FootnoteLabel children.
//   * Block definition: `[^id]: text...` (continued on indented lines) — emits FootnoteDefinition.
//
// Implements the same shape as remark-gfm's footnote so getAst()'s lazy
// remark pipeline and our Lezer decoration pipeline agree on the surface
// shape (node names) for the live preview to consume.

const OPEN_BRACKET = 91; // [
const CARET = 94; // ^
const CLOSE_BRACKET = 93; // ]
const COLON = 58; // :
const _SPACE = 32;
const _TAB = 9;
const NEWLINE = 10;

function isLabelChar(code: number): boolean {
  // Match remark/micromark gfm-footnote: any printable char except ], whitespace.
  return code > 32 && code !== CLOSE_BRACKET && code !== NEWLINE;
}

class FootnoteDefinitionLeafParser implements LeafBlockParser {
  nextLine(_cx: BlockContext, line: Line, _leaf: LeafBlock): boolean {
    // Continuation rule: stop on a blank line or a non-indented new block.
    // GFM-footnote allows lazy continuation on indented lines (>= 4 spaces or
    // a tab) following the marker line. Anything else terminates.
    if (line.next < 0) return true; // EOF
    const nonBlank =
      line.text.length > line.basePos && line.text.slice(line.basePos).trim().length > 0;
    if (!nonBlank) return false; // blank — keep accumulating until a real line forces close
    if (line.indent < 4) return true; // not indented enough → end definition
    return false;
  }
  finish(cx: BlockContext, leaf: LeafBlock): boolean {
    cx.addLeafElement(
      leaf,
      cx.elt("FootnoteDefinition", leaf.start, leaf.start + leaf.content.length),
    );
    return true;
  }
}

export const footnoteExtension: MarkdownConfig = {
  defineNodes: [
    { name: "FootnoteReference" },
    { name: "FootnoteDefinition", block: true },
    { name: "FootnoteMark" },
    { name: "FootnoteLabel" },
  ],
  parseInline: [
    {
      name: "FootnoteReference",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== OPEN_BRACKET) return -1;
        if (cx.char(pos + 1) !== CARET) return -1;
        let end = pos + 2;
        while (end < cx.end) {
          const ch = cx.char(end);
          if (ch === CLOSE_BRACKET) {
            if (end === pos + 2) return -1; // empty label
            const ref = cx.elt("FootnoteReference", pos, end + 1, [
              cx.elt("FootnoteMark", pos, pos + 2),
              cx.elt("FootnoteLabel", pos + 2, end),
              cx.elt("FootnoteMark", end, end + 1),
            ]);
            return cx.addElement(ref);
          }
          if (!isLabelChar(ch)) return -1;
          end++;
        }
        return -1;
      },
    },
  ],
  parseBlock: [
    {
      name: "FootnoteDefinition",
      leaf(_cx, leaf) {
        // Match `[^id]:` at the very start of the leaf's first line.
        const head = leaf.content;
        if (head.charCodeAt(0) !== OPEN_BRACKET) return null;
        if (head.charCodeAt(1) !== CARET) return null;
        let i = 2;
        while (i < head.length) {
          const ch = head.charCodeAt(i);
          if (ch === CLOSE_BRACKET) break;
          if (!isLabelChar(ch)) return null;
          i++;
        }
        if (i === 2 || i >= head.length) return null;
        if (head.charCodeAt(i + 1) !== COLON) return null;
        return new FootnoteDefinitionLeafParser();
      },
    },
  ],
};
