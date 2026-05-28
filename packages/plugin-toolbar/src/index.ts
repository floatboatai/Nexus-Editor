import type {
  EditorAPI,
  NexusPlugin,
  SlashCommandDef,
} from "@floatboat/nexus-core";
import { colorDecorationExtension } from "./color-decoration";
import {
  countStarsLeft,
  countStarsRight,
  extractLineContent,
  getSelectionLineRange,
  insertCodeBlock,
  insertHorizontalRule,
  insertImage,
  isLineWrapped,
  stripAllMarkers,
  toggleBlockquote,
  toggleOrderedList,
  toggleUnorderedList,
  unwrapLine,
} from "./formatting";

export {
  toggleBlockquote,
  toggleOrderedList,
  toggleUnorderedList,
  insertCodeBlock,
  insertImage,
  insertHorizontalRule,
  applyTextColor,
  applyHighlight,
} from "./formatting";
export { createToolbarUI } from "./toolbar-ui";
export { colorDecorationExtension } from "./color-decoration";
export type {
  ToolbarUI,
  ToolbarUIOptions,
  ToolbarButton,
  ToolbarGroup,
} from "./toolbar-ui";

export function toggleWrap(editor: EditorAPI, marker: string): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const selected = doc.slice(from, to);

  if (selected.includes("\n")) {
    const { rangeStart, rangeEnd, lines, lineStarts } = getSelectionLineRange(
      doc,
      anchor,
      head,
    );

    const fullContentLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "") continue;
      const { prefix } = extractLineContent(line, marker);
      const prefixLen = prefix.length;
      const content = line.slice(prefixLen);
      const lStart = lineStarts[i];

      let selContentStart = 0;
      let selContentEnd = content.length;

      if (i === 0) {
        selContentStart = Math.max(from - lStart - prefixLen, 0);
      }
      if (i === lines.length - 1) {
        const lineEnd = lStart + line.length;
        if (to >= lineEnd || to >= lineEnd - marker.length) {
          selContentEnd = content.length;
        } else {
          selContentEnd = Math.min(to - lStart - prefixLen, content.length);
        }
      }

      if (
        selContentStart === 0 &&
        selContentEnd === content.length &&
        content.length > 0
      ) {
        fullContentLines.push(content);
      }
    }

    const allWrapped =
      fullContentLines.length > 0 &&
      fullContentLines.every((c) => isLineWrapped(c, marker));

    const newLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lStart = lineStarts[i];

      if (line.trim() === "") {
        newLines.push(line);
        continue;
      }

      const { prefix } = extractLineContent(line, marker);
      const prefixLen = prefix.length;
      const content = line.slice(prefixLen);

      let selContentStart = 0;
      let selContentEnd = content.length;

      if (i === 0) {
        selContentStart = Math.max(from - lStart - prefixLen, 0);
      }
      if (i === lines.length - 1) {
        const lineEnd = lStart + line.length;
        if (to >= lineEnd || to >= lineEnd - marker.length) {
          selContentEnd = content.length;
        } else {
          selContentEnd = Math.min(to - lStart - prefixLen, content.length);
        }
      }

      if (selContentStart >= selContentEnd) {
        newLines.push(line);
        continue;
      }

      let beforeContent = content.slice(0, selContentStart);
      const selContent = content.slice(selContentStart, selContentEnd);
      let afterContent = content.slice(selContentEnd);

      const isFullContent =
        selContentStart === 0 && selContentEnd === content.length;

      let newSel: string;
      if (isFullContent) {
        if (allWrapped) {
          newSel = unwrapLine(selContent, marker);
        } else if (marker === "*" && selContent.includes("**")) {
          let leftInside = 0;
          while (
            leftInside < selContent.length &&
            selContent[leftInside] === "*"
          ) {
            leftInside++;
          }
          let rightInside = 0;
          while (
            rightInside < selContent.length &&
            selContent[selContent.length - 1 - rightInside] === "*"
          ) {
            rightInside++;
          }
          const starTarget = (total: number, m: string): number => {
            if (m === "*") return total % 2 === 0 ? total + 1 : total - 1;
            return total >= 2 ? total - 2 : total + 2;
          };
          const leftTarget = starTarget(leftInside, marker);
          const rightTarget = starTarget(rightInside, marker);
          const inner = selContent.slice(
            leftInside,
            selContent.length - rightInside,
          );
          newSel = "*".repeat(leftTarget) + inner + "*".repeat(rightTarget);
        } else {
          const rewrap = marker + stripAllMarkers(selContent, marker) + marker;
          if (rewrap === selContent) {
            const single = unwrapLine(selContent, marker);
            if (single.startsWith(marker) && single.endsWith(marker)) {
              newSel = single;
            } else {
              newSel = rewrap;
            }
          } else {
            newSel = rewrap;
          }
        }
      } else if (isLineWrapped(selContent, marker)) {
        newSel = unwrapLine(selContent, marker);
      } else if (
        (marker === "*" || marker === "**") &&
        selContent.length > 0 &&
        (selContent[0] === "*" ||
          selContent[selContent.length - 1] === "*" ||
          beforeContent.endsWith("*") ||
          afterContent.startsWith("*"))
      ) {
        let leftInside = 0;
        while (
          leftInside < selContent.length &&
          selContent[leftInside] === "*"
        ) {
          leftInside++;
        }
        let rightInside = 0;
        while (
          rightInside < selContent.length &&
          selContent[selContent.length - 1 - rightInside] === "*"
        ) {
          rightInside++;
        }

        let leftOutside = 0;
        while (
          leftOutside < beforeContent.length &&
          beforeContent[beforeContent.length - 1 - leftOutside] === "*"
        ) {
          leftOutside++;
        }
        let rightOutside = 0;
        while (
          rightOutside < afterContent.length &&
          afterContent[rightOutside] === "*"
        ) {
          rightOutside++;
        }

        const splitsCluster =
          (leftOutside > 0 && leftInside > 0) ||
          (rightOutside > 0 && rightInside > 0);

        if (splitsCluster) {
          if (marker === "*") {
            const leftTotal = leftOutside + leftInside;
            const rightTotal = rightInside + rightOutside;
            const starTargetN = (total: number, m: string): number => {
              if (m === "*") return total % 2 === 0 ? total + 1 : total - 1;
              return total >= 2 ? total - 2 : total + 2;
            };
            const leftTarget = starTargetN(leftTotal, marker);
            const rightTarget = starTargetN(rightTotal, marker);
            const inner = selContent.slice(
              leftInside,
              selContent.length - rightInside,
            );
            newSel = "*".repeat(leftTarget) + inner + "*".repeat(rightTarget);
            beforeContent = beforeContent.slice(
              0,
              beforeContent.length - leftOutside,
            );
            afterContent = afterContent.slice(rightOutside);
            newLines.push(prefix + beforeContent + newSel + afterContent);
            continue;
          }
          newSel = stripAllMarkers(selContent, marker);
        } else {
          const leftTotal = leftOutside + leftInside;
          const rightTotal = rightInside + rightOutside;

          const targetN = (total: number, m: string): number => {
            if (m === "*") return total % 2 === 0 ? total + 1 : total - 1;
            return total >= 2 ? total - 2 : total + 2;
          };

          const leftTarget = targetN(leftTotal, marker);
          const rightTarget = targetN(rightTotal, marker);
          const inner = selContent.slice(
            leftInside,
            selContent.length - rightInside,
          );

          newSel = "*".repeat(leftTarget) + inner + "*".repeat(rightTarget);
          beforeContent = beforeContent.slice(
            0,
            beforeContent.length - leftOutside,
          );
          afterContent = afterContent.slice(rightOutside);
          newLines.push(prefix + beforeContent + newSel + afterContent);
          continue;
        }
      } else if (selContent === marker) {
        if (beforeContent.startsWith(marker)) {
          newSel = "";
        } else {
          newSel = selContent;
        }
        newLines.push(prefix + beforeContent + newSel + afterContent);
        continue;
      } else if (
        selContent.startsWith(marker) &&
        selContent.length > marker.length
      ) {
        newSel = selContent.slice(marker.length);
        if (afterContent.includes(marker) && !afterContent.startsWith(marker)) {
          afterContent = marker + afterContent;
        }
        newLines.push(prefix + beforeContent + newSel + afterContent);
        continue;
      } else if (
        selContent.endsWith(marker) &&
        selContent.length > marker.length
      ) {
        newSel = selContent.slice(0, selContent.length - marker.length);
        if (beforeContent.includes(marker) && !beforeContent.endsWith(marker)) {
          beforeContent = beforeContent + marker;
        }
        newLines.push(prefix + beforeContent + newSel + afterContent);
        continue;
      } else if (selContent.includes(marker)) {
        newSel = stripAllMarkers(selContent, marker);
      } else {
        newSel = marker + selContent + marker;
      }

      if (afterContent.includes(marker) && !afterContent.startsWith(marker)) {
        afterContent = marker + afterContent;
      }
      if (beforeContent.includes(marker) && !beforeContent.endsWith(marker)) {
        beforeContent = beforeContent + marker;
      }

      newLines.push(prefix + beforeContent + newSel + afterContent);
    }

    let cursorOffset = 0;
    for (let i = 0; i < newLines.length - 1; i++) {
      cursorOffset += newLines[i].length + 1;
    }
    cursorOffset += newLines[newLines.length - 1].length;

    const newRangeText = newLines.join("\n");
    const newDoc =
      doc.slice(0, rangeStart) + newRangeText + doc.slice(rangeEnd);
    editor.setDocument(newDoc);
    editor.setSelection(rangeStart + cursorOffset);
    return true;
  }

  const markerTarget = (total: number, m: string): number => {
    if (m === "*") return total % 2 === 0 ? total + 1 : total - 1;
    return total >= 2 ? total - 2 : total + 2;
  };

  if (from !== to && (marker === "*" || marker === "**")) {
    const leftOutside = countStarsLeft(doc, from);
    const rightOutside = countStarsRight(doc, to);

    let leftInside = 0;
    while (leftInside < selected.length && selected[leftInside] === "*") {
      leftInside++;
    }
    let rightInside = 0;
    while (
      rightInside < selected.length &&
      selected[selected.length - 1 - rightInside] === "*"
    ) {
      rightInside++;
    }

    const skipStarCount =
      selected.includes(marker) && leftInside === 0 && rightInside === 0;

    if (!skipStarCount) {
      const leftTotal = leftOutside + leftInside;
      const rightTotal = rightOutside + rightInside;
      const leftTarget = markerTarget(leftTotal, marker);
      const rightTarget = markerTarget(rightTotal, marker);
      const inner = selected.slice(leftInside, selected.length - rightInside);

      const newDoc =
        doc.slice(0, from - leftOutside) +
        "*".repeat(leftTarget) +
        inner +
        "*".repeat(rightTarget) +
        doc.slice(to + rightOutside);
      editor.setDocument(newDoc);
      const newFrom = from - leftOutside + leftTarget;
      editor.setSelection(newFrom, newFrom + inner.length);
      return true;
    }
  }

  const before = doc.slice(Math.max(0, from - marker.length), from);
  const after = doc.slice(to, to + marker.length);

  if (before === marker && after === marker) {
    const newDoc =
      doc.slice(0, from - marker.length) +
      selected +
      doc.slice(to + marker.length);
    editor.setDocument(newDoc);
    editor.setSelection(from - marker.length, to - marker.length);
    return true;
  }

  if (before === marker || after === marker) {
    if (selected.startsWith(marker) || selected.endsWith(marker)) {
      const cleaned = stripAllMarkers(selected, marker);
      const adjFrom = before === marker ? from - marker.length : from;
      const adjTo = after === marker ? to + marker.length : to;
      const newDoc = doc.slice(0, adjFrom) + cleaned + doc.slice(adjTo);
      editor.setDocument(newDoc);
      editor.setSelection(adjFrom, adjFrom + cleaned.length);
      return true;
    }

    if (selected.includes(marker)) {
      const lineStart = doc.lastIndexOf("\n", from - 1) + 1;
      const nlIdx = doc.indexOf("\n", to);
      const lineEnd = nlIdx === -1 ? doc.length : nlIdx;
      const line = doc.slice(lineStart, lineEnd);

      const { prefix, content } = extractLineContent(line, marker);
      const isWrapped = isLineWrapped(content, marker);

      let newLine: string;
      if (isWrapped) {
        newLine = prefix + unwrapLine(content, marker);
      } else {
        newLine = prefix + marker + stripAllMarkers(content, marker) + marker;
      }

      const newDoc = doc.slice(0, lineStart) + newLine + doc.slice(lineEnd);
      editor.setDocument(newDoc);
      editor.setSelection(lineStart + newLine.length);
      return true;
    }

    if (before === marker) {
      const newDoc =
        doc.slice(0, from - marker.length) + selected + marker + doc.slice(to);
      editor.setDocument(newDoc);
      editor.setSelection(
        from - marker.length,
        from - marker.length + selected.length,
      );
      return true;
    }

    const newDoc =
      doc.slice(0, from) + marker + selected + doc.slice(to + marker.length);
    editor.setDocument(newDoc);
    editor.setSelection(
      from + marker.length,
      from + marker.length + selected.length,
    );
    return true;
  }

  const newDoc =
    doc.slice(0, from) + marker + selected + marker + doc.slice(to);
  editor.setDocument(newDoc);
  editor.setSelection(from + marker.length, to + marker.length);
  return true;
}

export function toggleBold(editor: EditorAPI): boolean {
  return toggleWrap(editor, "**");
}

export function toggleItalic(editor: EditorAPI): boolean {
  return toggleWrap(editor, "*");
}

export function toggleStrikethrough(editor: EditorAPI): boolean {
  return toggleWrap(editor, "~~");
}

export function toggleUnderline(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const selected = doc.slice(from, to);

  if (selected.includes("\n")) {
    const { rangeStart, rangeEnd, lines, lineStarts } = getSelectionLineRange(
      doc,
      anchor,
      head,
    );

    const fullContentLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "") continue;
      const { prefix } = extractLineContent(line, "<u>");
      const prefixLen = prefix.length;
      const content = line.slice(prefixLen);
      const lStart = lineStarts[i];

      let selContentStart = 0;
      let selContentEnd = content.length;

      if (i === 0) {
        selContentStart = Math.max(from - lStart - prefixLen, 0);
      }
      if (i === lines.length - 1) {
        const lineEnd = lStart + line.length;
        if (to >= lineEnd || to >= lineEnd - 4) {
          selContentEnd = content.length;
        } else {
          selContentEnd = Math.min(to - lStart - prefixLen, content.length);
        }
      }

      if (
        selContentStart === 0 &&
        selContentEnd === content.length &&
        content.length > 0
      ) {
        fullContentLines.push(content);
      }
    }

    const isWrapped = (l: string) =>
      l.startsWith("<u>") && l.endsWith("</u>") && l.length >= 7;
    const allWrapped =
      fullContentLines.length > 0 && fullContentLines.every(isWrapped);

    const newLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lStart = lineStarts[i];

      if (line.trim() === "") {
        newLines.push(line);
        continue;
      }

      const { prefix } = extractLineContent(line, "<u>");
      const prefixLen = prefix.length;
      const content = line.slice(prefixLen);

      let selContentStart = 0;
      let selContentEnd = content.length;

      if (i === 0) {
        selContentStart = Math.max(from - lStart - prefixLen, 0);
      }
      if (i === lines.length - 1) {
        const lineEnd = lStart + line.length;
        if (to >= lineEnd || to >= lineEnd - 4) {
          selContentEnd = content.length;
        } else {
          selContentEnd = Math.min(to - lStart - prefixLen, content.length);
        }
      }

      if (selContentStart >= selContentEnd) {
        newLines.push(line);
        continue;
      }

      let beforeContent = content.slice(0, selContentStart);
      const selContent = content.slice(selContentStart, selContentEnd);
      let afterContent = content.slice(selContentEnd);

      const isFullContent =
        selContentStart === 0 && selContentEnd === content.length;

      let newSel: string;
      if (isFullContent && allWrapped) {
        newSel = selContent.slice(3, selContent.length - 4);
      } else if (isWrapped(selContent)) {
        newSel = selContent.slice(3, selContent.length - 4);
      } else {
        newSel = "<u>" + selContent + "</u>";
      }

      newLines.push(prefix + beforeContent + newSel + afterContent);
    }

    const newDoc =
      doc.slice(0, rangeStart) + newLines.join("\n") + doc.slice(rangeEnd);
    editor.setDocument(newDoc);
    let cursorOffset = 0;
    for (let i = 0; i < newLines.length - 1; i++) {
      cursorOffset += newLines[i].length + 1;
    }
    cursorOffset += newLines[newLines.length - 1].length;
    editor.setSelection(rangeStart + cursorOffset);
    return true;
  }

  const before = doc.slice(Math.max(0, from - 3), from);
  const after = doc.slice(to, to + 4);

  if (before === "<u>" && after === "</u>") {
    editor.setDocument(doc.slice(0, from - 3) + selected + doc.slice(to + 4));
    editor.setSelection(from - 3, to - 3);
    return true;
  }

  editor.setDocument(
    doc.slice(0, from) + "<u>" + selected + "</u>" + doc.slice(to),
  );
  editor.setSelection(from + 3, to + 3);
  return true;
}

export function toggleInlineCode(editor: EditorAPI): boolean {
  return toggleWrap(editor, "`");
}

export function insertLink(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const selected = doc.slice(from, to);

  const linkText = selected || "link text";
  const md = `[${linkText}](url)`;
  const newDoc = doc.slice(0, from) + md + doc.slice(to);
  editor.setDocument(newDoc);

  // Select the "url" part for easy replacement
  const urlStart = from + linkText.length + 3;
  editor.setSelection(urlStart, urlStart + 3);
  return true;
}

export function toggleHeading(editor: EditorAPI, level: number): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const prefix = "#".repeat(level) + " ";
  const selected = doc.slice(Math.min(anchor, head), Math.max(anchor, head));

  if (selected.includes("\n")) {
    const { rangeStart, rangeEnd, lines } = getSelectionLineRange(
      doc,
      anchor,
      head,
    );
    const newLines = lines.map((line) => {
      const trimmed = line.trimEnd();
      if (trimmed === "") return line;
      const { prefix: listPrefix, content } = extractLineContent(
        trimmed,
        prefix,
      );
      const headingMatch = content.match(/^#{1,6}\s/);
      if (headingMatch && headingMatch[0] === prefix) {
        return listPrefix + content.slice(headingMatch[0].length);
      } else if (headingMatch) {
        return listPrefix + prefix + content.slice(headingMatch[0].length);
      }
      return listPrefix + prefix + content;
    });
    const newDoc =
      doc.slice(0, rangeStart) + newLines.join("\n") + doc.slice(rangeEnd);
    editor.setDocument(newDoc);
    let cursorOffset = 0;
    for (let i = 0; i < newLines.length - 1; i++) {
      cursorOffset += newLines[i].length + 1;
    }
    cursorOffset += newLines[newLines.length - 1].length;
    editor.setSelection(rangeStart + cursorOffset);
    return true;
  }

  const lineStart = doc.lastIndexOf("\n", anchor - 1) + 1;
  const lineEnd = doc.indexOf("\n", anchor);
  const end = lineEnd === -1 ? doc.length : lineEnd;
  const line = doc.slice(lineStart, end);
  const trimmed = line.trimEnd();

  let newLine: string;
  if (trimmed === "") {
    newLine = prefix;
  } else {
    const { prefix: listPrefix, content } = extractLineContent(trimmed, prefix);
    const headingMatch = content.match(/^#{1,6}\s/);
    if (headingMatch && headingMatch[0] === prefix) {
      newLine = listPrefix + content.slice(headingMatch[0].length);
    } else if (headingMatch) {
      newLine = listPrefix + prefix + content.slice(headingMatch[0].length);
    } else {
      newLine = listPrefix + prefix + content;
    }
  }

  const newDoc = doc.slice(0, lineStart) + newLine + doc.slice(end);
  editor.setDocument(newDoc);
  editor.setSelection(lineStart + newLine.length);
  return true;
}

/**
 * Slash-command catalogue exposed by the toolbar plugin. Each entry
 * reuses an existing formatting helper as its `run` so the slash menu
 * and the toolbar always produce identical output.
 *
 * Exported separately so hosts can compose this list with their own
 * commands (e.g. a vault-aware plugin adding `[[wikilink]]` insertion)
 * without re-deriving the toolbar set by hand.
 */
export const toolbarSlashCommands: SlashCommandDef[] = [
  {
    id: "h1",
    title: "Heading 1",
    description: "Big section heading",
    keywords: ["h1", "title", "heading", "header"],
    run: (e) => toggleHeading(e, 1),
  },
  {
    id: "h2",
    title: "Heading 2",
    description: "Medium section heading",
    keywords: ["h2", "subtitle", "heading", "header"],
    run: (e) => toggleHeading(e, 2),
  },
  {
    id: "h3",
    title: "Heading 3",
    description: "Small section heading",
    keywords: ["h3", "heading", "header"],
    run: (e) => toggleHeading(e, 3),
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

export function createToolbarPlugin(): NexusPlugin {
  return {
    name: "plugin-toolbar",
    shortcuts: [
      { key: "Mod-b", run: toggleBold },
      { key: "Mod-i", run: toggleItalic },
      { key: "Mod-Shift-s", run: toggleStrikethrough },
      { key: "Mod-e", run: toggleInlineCode },
      { key: "Mod-k", run: insertLink },
      { key: "Mod-1", run: (e) => toggleHeading(e, 1) },
      { key: "Mod-2", run: (e) => toggleHeading(e, 2) },
      { key: "Mod-3", run: (e) => toggleHeading(e, 3) },
    ],
    slashCommands: toolbarSlashCommands,
    cmExtensions: [colorDecorationExtension()],
  };
}
