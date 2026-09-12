import type { EditorAPI } from "@floatboat/nexus-core";
import { insertLink, toggleBold, toggleHeading, toggleInlineCode, toggleItalic, toggleStrikethrough, toggleWrap } from "./commands";
import { insertCodeBlock, insertHorizontalRule, insertImage, toggleBlockquote, toggleOrderedList, toggleUnorderedList } from "./formatting";

export interface FormattingCommand {
  readonly id: string;
  readonly name: string;
  readonly run: (editor: EditorAPI) => boolean | void;
  readonly hotkey?: { readonly key: string; readonly modifiers?: readonly ("Mod" | "Shift")[] };
}

export const formattingCommands: readonly FormattingCommand[] = Object.freeze([
  { id: "link", name: "Insert link", run: (editor) => insertLink(editor), hotkey: { key: "k", modifiers: ["Mod"] } },
  { id: "h1", name: "Heading 1", run: (editor) => toggleHeading(editor, 1), hotkey: { key: "1", modifiers: ["Mod"] } },
  { id: "h2", name: "Heading 2", run: (editor) => toggleHeading(editor, 2), hotkey: { key: "2", modifiers: ["Mod"] } },
  { id: "h3", name: "Heading 3", run: (editor) => toggleHeading(editor, 3), hotkey: { key: "3", modifiers: ["Mod"] } },
  { id: "bold", name: "Bold", run: (editor) => toggleBold(editor), hotkey: { key: "b", modifiers: ["Mod"] } },
  { id: "italic", name: "Italic", run: (editor) => toggleItalic(editor), hotkey: { key: "i", modifiers: ["Mod"] } },
  { id: "strikethrough", name: "Strikethrough", run: (editor) => toggleStrikethrough(editor), hotkey: { key: "s", modifiers: ["Mod", "Shift"] } },
  { id: "underline", name: "Underline", run: (editor) => toggleWrap(editor, "<u>") },
  { id: "inline-code", name: "Inline code", run: (editor) => toggleInlineCode(editor), hotkey: { key: "e", modifiers: ["Mod"] } },
  { id: "blockquote", name: "Blockquote", run: (editor) => toggleBlockquote(editor) },
  { id: "code-block", name: "Code block", run: (editor) => insertCodeBlock(editor) },
  { id: "olist", name: "Ordered list", run: (editor) => toggleOrderedList(editor) },
  { id: "ulist", name: "Unordered list", run: (editor) => toggleUnorderedList(editor) },
  { id: "image", name: "Insert image", run: (editor) => insertImage(editor) },
  { id: "hr", name: "Divider", run: (editor) => insertHorizontalRule(editor) },
]);
