import type { SlashCommandDef } from "@floatboat/nexus-core";
import { insertLink, toggleBold, toggleHeading, toggleInlineCode, toggleItalic, toggleStrikethrough } from "./commands";
import { insertCodeBlock, insertHorizontalRule, insertImage, toggleBlockquote, toggleOrderedList, toggleUnorderedList } from "./formatting";

/** Shared command catalogue used by both the legacy and lifecycle entrypoints. */
export const formattingSlashCommands: SlashCommandDef[] = [
  {
    id: "h1",
    title: "Heading 1",
    description: "Big section heading",
    keywords: ["h1", "title", "heading", "header"],
    run: (editor) => toggleHeading(editor, 1),
  },
  {
    id: "h2",
    title: "Heading 2",
    description: "Medium section heading",
    keywords: ["h2", "subtitle", "heading", "header"],
    run: (editor) => toggleHeading(editor, 2),
  },
  {
    id: "h3",
    title: "Heading 3",
    description: "Small section heading",
    keywords: ["h3", "heading", "header"],
    run: (editor) => toggleHeading(editor, 3),
  },
  {
    id: "bold",
    title: "Bold",
    description: "Strong emphasis around the selection",
    keywords: ["bold", "strong", "b"],
    run: toggleBold,
  },
  {
    id: "italic",
    title: "Italic",
    description: "Italic emphasis around the selection",
    keywords: ["italic", "em", "i"],
    run: toggleItalic,
  },
  {
    id: "strikethrough",
    title: "Strikethrough",
    description: "Strike through the selection",
    keywords: ["strike", "strikethrough", "del"],
    run: toggleStrikethrough,
  },
  {
    id: "inline-code",
    title: "Inline code",
    description: "Wrap the selection in backticks",
    keywords: ["code", "inline", "monospace"],
    run: toggleInlineCode,
  },
  {
    id: "code-block",
    title: "Code block",
    description: "Insert a fenced code block",
    keywords: ["code", "block", "fence", "```"],
    run: insertCodeBlock,
  },
  {
    id: "blockquote",
    title: "Blockquote",
    description: "Quote the current line",
    keywords: ["quote", "blockquote", ">"],
    run: toggleBlockquote,
  },
  {
    id: "ulist",
    title: "Bulleted list",
    description: "Start an unordered list",
    keywords: ["list", "ul", "bullet", "unordered"],
    run: toggleUnorderedList,
  },
  {
    id: "olist",
    title: "Numbered list",
    description: "Start an ordered list",
    keywords: ["list", "ol", "ordered", "numbered"],
    run: toggleOrderedList,
  },
  {
    id: "link",
    title: "Link",
    description: "Insert a markdown link",
    keywords: ["link", "url", "href", "a"],
    run: insertLink,
  },
  {
    id: "image",
    title: "Image",
    description: "Insert a markdown image",
    keywords: ["image", "img", "picture", "photo"],
    run: insertImage,
  },
  {
    id: "hr",
    title: "Divider",
    description: "Insert a horizontal rule",
    keywords: ["hr", "rule", "divider", "separator", "---"],
    run: insertHorizontalRule,
  },
];
