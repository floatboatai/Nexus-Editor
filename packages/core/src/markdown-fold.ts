import { type Extension } from "@codemirror/state";
import { foldGutter, foldService } from "@codemirror/language";

const HEADING_RE = /^(#{1,6}) /;
const FENCE_OPEN_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_RE = /^ {0,3}(`+|~+)[ \t]*$/;
const INDENT_RE = /^([ \t]*)/;

interface Fence {
  char: "`" | "~";
  length: number;
}

function parseOpeningFence(text: string): Fence | null {
  const match = FENCE_OPEN_RE.exec(text);
  if (!match) return null;

  const marker = match[2];
  if (marker[0] === "`" && match[3].includes("`")) return null;

  return {
    char: marker[0] as Fence["char"],
    length: marker.length,
  };
}

function isClosingFence(text: string, opening: Fence): boolean {
  const match = FENCE_CLOSE_RE.exec(text);
  if (!match) return false;

  const marker = match[1];
  return marker[0] === opening.char && marker.length >= opening.length;
}

/**
 * CM6 fold service for markdown headings and fenced code blocks.
 *
 * - Headings fold from the heading line to the line before the next
 *   same-or-higher-level heading (or end of document).
 * - Fenced code blocks fold from the opening fence to the closing fence.
 */
export function markdownFoldService(): Extension {
  return foldService.of((state, lineStart, lineEnd) => {
    const line = state.doc.lineAt(lineStart);
    const text = line.text;

    // ── Heading fold ──
    const headingMatch = HEADING_RE.exec(text);
    if (headingMatch) {
      const level = headingMatch[1].length;
      // Fold from end of heading line to before next same-or-higher heading
      let foldEnd = state.doc.length;
      for (let i = line.number + 1; i <= state.doc.lines; i++) {
        const nextLine = state.doc.line(i);
        const nextMatch = HEADING_RE.exec(nextLine.text);
        if (nextMatch && nextMatch[1].length <= level) {
          // Fold up to the end of the previous line
          foldEnd = nextLine.from - 1;
          break;
        }
      }
      // Only fold if there's content after the heading
      if (foldEnd > line.to) {
        return { from: line.to, to: foldEnd };
      }
    }

    // ── Fenced code block fold ──
    const openingFence = parseOpeningFence(text);
    if (openingFence) {
      for (let i = line.number + 1; i <= state.doc.lines; i++) {
        const nextLine = state.doc.line(i);
        if (isClosingFence(nextLine.text, openingFence)) {
          return { from: line.to, to: nextLine.to };
        }
      }

      // CommonMark treats an unclosed fence as extending to the end of its
      // containing block. At the document level, that means the end of the doc.
      if (state.doc.length > line.to) {
        return { from: line.to, to: state.doc.length };
      }
    }

    // ── Indent-based fold (lists, nested content) ──
    const indentMatch = INDENT_RE.exec(text);
    if (indentMatch && text.trim().length > 0) {
      const indent = indentMatch[1].length;
      // Only fold lines that have content and are followed by more-indented lines
      let foldEnd = -1;
      for (let i = line.number + 1; i <= state.doc.lines; i++) {
        const nextLine = state.doc.line(i);
        if (nextLine.text.trim().length === 0) {
          // Blank lines are included in the fold if followed by indented content
          continue;
        }
        const nextIndent = INDENT_RE.exec(nextLine.text);
        if (nextIndent && nextIndent[1].length > indent) {
          foldEnd = nextLine.to;
        } else {
          break;
        }
      }
      if (foldEnd > line.to) {
        return { from: line.to, to: foldEnd };
      }
    }

    return null;
  });
}

/** Fold gutter + fold service for markdown documents. */
export function markdownFold(): Extension {
  return [
    markdownFoldService(),
    foldGutter()
  ];
}
