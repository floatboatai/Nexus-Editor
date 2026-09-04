import type { EditorAPI, NexusPlugin } from "@floatboat/nexus-core";

export interface DuplicateLineOptions {
  hotkey?: string;
}

/**
 * 重复行 / 重复选区。
 *
 * - 无选区：复制当前行，插入到下一行，光标移到新行。
 * - 单行选区：复制选中文本，追加到选区后面。
 * - 跨行选区：复制整段选中行，追加到块末尾。
 */
function duplicateSelection(editor: EditorAPI): boolean {
  const { anchor, head } = editor.getSelection();
  const doc = editor.getDocument();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const isCollapsed = from === to;

  if (isCollapsed) {
    // 无选区：复制整行
    const lineStart = doc.lastIndexOf("\n", from - 1) + 1;
    const lineEnd = doc.indexOf("\n", from);
    const end = lineEnd === -1 ? doc.length : lineEnd;
    const lineText = doc.slice(lineStart, end);
    const insertText = "\n" + lineText;

    editor.replaceRange(end, end, insertText);
    const newCursorPos = end + 1 + Math.min(from - lineStart, lineText.length);
    editor.setSelection(newCursorPos);
    return true;
  }

  const selectedText = doc.slice(from, to);
  const hasNewline = selectedText.includes("\n");

  if (hasNewline) {
    // 跨行选区
    const blockStart = doc.lastIndexOf("\n", from - 1) + 1;
    const blockEndRaw = doc.indexOf("\n", to);
    const blockEnd = blockEndRaw === -1 ? doc.length : blockEndRaw;
    const blockText = doc.slice(blockStart, blockEnd);
    editor.replaceRange(blockEnd, blockEnd, "\n" + blockText);
    return true;
  }

  // 单行内选区
  editor.replaceRange(to, to, selectedText);
  editor.setSelection(to + selectedText.length);
  return true;
}

export function createDuplicateLinePlugin(options: DuplicateLineOptions = {}): NexusPlugin {
  const { hotkey = "Mod-L" } = options;

  return {
    name: "plugin-duplicate-line",
    // ✅ 正确字段：shortcuts，不是 commands
    shortcuts: [
      {
        key: hotkey,
        run(editor: EditorAPI): boolean {
          try {
            return duplicateSelection(editor);
          } catch (err) {
            console.warn("[plugin‑duplicate‑line] run error:", err);
            return false;
          }
        },
      },
    ],
  };
}

