import { type EditorState, type Extension } from "@codemirror/state";
import {
  codeFolding,
  foldAll,
  foldCode,
  foldGutter,
  foldKeymap,
  foldService,
  unfoldAll,
  unfoldCode,
} from "@codemirror/language";
import { keymap, type EditorView } from "@codemirror/view";

import type { NexusLocale } from "./locale";
import type { EditorCommand } from "./types";

const ATX_HEADING_RE = /^(#{1,6}) /;
const FENCE_OPEN_RE = /^[ \t]*(`{3,}|~{3,})/;
const INDENT_RE = /^([ \t]*)/;
const SETEXT_H1_RE = /^=+[ \t]*$/;
const SETEXT_H2_RE = /^-+[ \t]*$/;
const ALERT_LINE_RE =
  /^ {0,3}>[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;
const BLOCKQUOTE_LINE_RE = /^ {0,3}>/;

export interface MarkdownFoldOptions {
  /** Show the fold gutter next to line numbers. Default: true. */
  gutter?: boolean;
  locale?: Pick<
    NexusLocale,
    "foldCode" | "unfoldCode" | "foldHeading" | "unfoldHeading"
  >;
}

interface HeadingInfo {
  level: number;
  /** Document offset where the folded body starts (exclusive of the heading). */
  foldFrom: number;
  /** Line number of the last heading chrome line (ATX line, or setext underline). */
  endLine: number;
}

function isSetextUnderline(text: string, kind: 1 | 2): boolean {
  if (text.trim().length === 0) return false;
  return kind === 1 ? SETEXT_H1_RE.test(text) : SETEXT_H2_RE.test(text);
}

function headingInfo(state: EditorState, lineNumber: number): HeadingInfo | null {
  const line = state.doc.line(lineNumber);
  const atx = ATX_HEADING_RE.exec(line.text);
  if (atx) {
    return { level: atx[1].length, foldFrom: line.to, endLine: lineNumber };
  }

  if (line.text.trim().length === 0) return null;
  if (lineNumber >= state.doc.lines) return null;

  const underline = state.doc.line(lineNumber + 1);
  if (isSetextUnderline(underline.text, 1)) {
    return { level: 1, foldFrom: underline.to, endLine: lineNumber + 1 };
  }
  if (isSetextUnderline(underline.text, 2)) {
    return { level: 2, foldFrom: underline.to, endLine: lineNumber + 1 };
  }
  return null;
}

function sectionEnd(state: EditorState, afterLine: number, level: number): number {
  let foldEnd = state.doc.length;
  for (let i = afterLine + 1; i <= state.doc.lines; i++) {
    const next = headingInfo(state, i);
    if (next && next.level <= level) {
      foldEnd = state.doc.line(i).from - 1;
      break;
    }
  }
  return foldEnd;
}

function fenceFoldRange(
  state: EditorState,
  lineNumber: number,
  fence: string
): { from: number; to: number } | null {
  const line = state.doc.line(lineNumber);
  const fenceChar = fence[0];
  const fenceLen = fence.length;
  for (let i = lineNumber + 1; i <= state.doc.lines; i++) {
    const nextLine = state.doc.line(i);
    const trimmed = nextLine.text.trimStart();
    if (
      trimmed.startsWith(fenceChar.repeat(fenceLen)) &&
      trimmed.trim().length <= fenceLen + 1
    ) {
      return { from: line.to, to: nextLine.to };
    }
  }
  return null;
}

function alertFoldRange(
  state: EditorState,
  lineNumber: number
): { from: number; to: number } | null {
  const line = state.doc.line(lineNumber);
  let foldEnd = line.to;
  for (let i = lineNumber + 1; i <= state.doc.lines; i++) {
    const nextLine = state.doc.line(i);
    if (!BLOCKQUOTE_LINE_RE.test(nextLine.text)) break;
    foldEnd = nextLine.to;
  }
  return foldEnd > line.to ? { from: line.to, to: foldEnd } : null;
}

function indentFoldRange(
  state: EditorState,
  lineNumber: number,
  indent: number
): { from: number; to: number } | null {
  const line = state.doc.line(lineNumber);
  let foldEnd = -1;
  for (let i = lineNumber + 1; i <= state.doc.lines; i++) {
    const nextLine = state.doc.line(i);
    if (nextLine.text.trim().length === 0) continue;
    const nextIndent = INDENT_RE.exec(nextLine.text);
    if (nextIndent && nextIndent[1].length > indent) {
      foldEnd = nextLine.to;
    } else {
      break;
    }
  }
  return foldEnd > line.to ? { from: line.to, to: foldEnd } : null;
}

/**
 * CM6 fold service for markdown headings, fenced code blocks, GFM alerts,
 * and indented nested content.
 *
 * - ATX / setext headings fold from the heading chrome to the line before
 *   the next same-or-higher-level heading (or end of document).
 * - Fenced code blocks fold from the opening fence to the closing fence.
 * - GFM alerts (`> [!NOTE]`) fold through consecutive blockquote lines.
 */
export function markdownFoldService(): Extension {
  return foldService.of((state, lineStart) => {
    const line = state.doc.lineAt(lineStart);
    const text = line.text;

    const heading = headingInfo(state, line.number);
    if (heading) {
      const foldEnd = sectionEnd(state, heading.endLine, heading.level);
      if (foldEnd > heading.foldFrom) {
        return { from: heading.foldFrom, to: foldEnd };
      }
    }

    const fenceMatch = FENCE_OPEN_RE.exec(text);
    if (fenceMatch) {
      const range = fenceFoldRange(state, line.number, fenceMatch[1]);
      if (range) return range;
    }

    if (ALERT_LINE_RE.test(text)) {
      const range = alertFoldRange(state, line.number);
      if (range) return range;
    }

    const indentMatch = INDENT_RE.exec(text);
    if (indentMatch && text.trim().length > 0) {
      const range = indentFoldRange(state, line.number, indentMatch[1].length);
      if (range) return range;
    }

    return null;
  });
}

function foldTooltip(
  open: boolean,
  locale: MarkdownFoldOptions["locale"]
): string {
  if (open) return locale?.foldHeading ?? "Fold section";
  return locale?.unfoldHeading ?? "Unfold section";
}

/** Fold service, optional gutter, keymap, and fold state for markdown documents. */
export function markdownFold(options: MarkdownFoldOptions = {}): Extension {
  const locale = options.locale;
  const extensions: Extension[] = [markdownFoldService()];

  if (options.gutter === false) {
    extensions.push(codeFolding());
  } else {
    extensions.push(
      foldGutter({
        markerDOM(open) {
          const marker = document.createElement("span");
          marker.textContent = open ? "▾" : "▸";
          const label = foldTooltip(open, locale);
          marker.title = label;
          marker.setAttribute("aria-label", label);
          return marker;
        },
      })
    );
  }

  extensions.push(keymap.of(foldKeymap));
  return extensions;
}

/** Built-in fold commands. Plugin commands with the same id win. */
export function createMarkdownFoldCommands(
  view: EditorView,
  locale: NexusLocale
): EditorCommand[] {
  return [
    {
      id: "editor:fold",
      label: locale.foldHeading,
      run: () => foldCode(view),
    },
    {
      id: "editor:unfold",
      label: locale.unfoldHeading,
      run: () => unfoldCode(view),
    },
    {
      id: "editor:fold-all",
      label: locale.foldAll,
      run: () => foldAll(view),
    },
    {
      id: "editor:unfold-all",
      label: locale.unfoldAll,
      run: () => unfoldAll(view),
    },
  ];
}
