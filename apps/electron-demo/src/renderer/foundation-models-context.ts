export interface SuggestionContext {
  from: number;
  to: number;
  paragraph: string;
}

interface LineInfo {
  start: number;
  end: number;
  breakEnd: number;
  text: string;
}

function isBlankLine(text: string): boolean {
  return text.trim().length === 0;
}

function isFenceLine(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("```") || trimmed.startsWith("~~~");
}

function isHeadingLine(text: string): boolean {
  return /^#{1,6}(?:\s|$)/.test(text.trimStart());
}

function isListLine(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    /^[-+*]\s+/.test(trimmed) ||
    /^[-+*]\s+\[(?: |x|X)\]\s+/.test(trimmed) ||
    /^\d+[.)]\s+/.test(trimmed)
  );
}

function isBlockQuoteLine(text: string): boolean {
  return /^>\s?/.test(text.trimStart());
}

function isTableLine(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("|") || /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(trimmed);
}

function isThematicBreakLine(text: string): boolean {
  return /^(?:-{3,}|\*{3,}|_{3,})$/.test(text.trim());
}

function hasUnsafeInlineSyntax(text: string): boolean {
  return (
    /!?\[[^\]\n]+\]\([^\)\n]+\)/.test(text) ||
    /`[^`\n]+`/.test(text) ||
    /(^|[^\\])\*[^*\n]+\*(?!\w)/.test(text) ||
    /(^|[^\\])_[^_\n]+_(?!\w)/.test(text) ||
    /!?\[[^\]\n]*$/.test(text) ||
    /`[^`\n]*$/.test(text) ||
    /(^|[^\\])\*[^*\n]*$/.test(text) ||
    /(^|[^\\])_[^_\n]*$/.test(text)
  );
}

function readLines(document: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let start = 0;

  while (start <= document.length) {
    let end = start;
    let breakEnd = start;

    while (end < document.length && document[end] !== "\n" && document[end] !== "\r") {
      end += 1;
    }

    breakEnd = end;
    if (end < document.length) {
      if (document[end] === "\r" && document[end + 1] === "\n") {
        breakEnd = end + 2;
      } else {
        breakEnd = end + 1;
      }
    }

    lines.push({
      start,
      end,
      breakEnd,
      text: document.slice(start, end),
    });

    if (breakEnd >= document.length) {
      break;
    }

    start = breakEnd;
  }

  return lines;
}

function lineForPosition(lines: LineInfo[], position: number): number {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (position >= line.start && position <= line.end) {
      return index;
    }
    if (position > line.end && position < line.breakEnd) {
      return -1;
    }
  }
  return -1;
}

function fenceStateBefore(lines: LineInfo[], lineIndex: number): boolean {
  let inFence = false;
  for (let index = 0; index < lineIndex; index += 1) {
    if (isFenceLine(lines[index].text)) {
      inFence = !inFence;
    }
  }
  return inFence;
}

export function findSuggestionContext(document: string, position: number): SuggestionContext | null {
  if (!Number.isInteger(position) || position < 0 || position > document.length) {
    return null;
  }

  const lines = readLines(document);
  if (lines.length === 0) {
    return null;
  }

  const lineIndex = lineForPosition(lines, position);
  if (lineIndex < 0) {
    return null;
  }

  const line = lines[lineIndex];
  if (position !== line.end || isBlankLine(line.text)) {
    return null;
  }

  let start = lineIndex;
  while (start > 0 && !isBlankLine(lines[start - 1].text)) {
    start -= 1;
  }

  let end = lineIndex;
  while (end + 1 < lines.length && !isBlankLine(lines[end + 1].text)) {
    end += 1;
  }

  if (lineIndex !== end) {
    return null;
  }

  if (fenceStateBefore(lines, start)) {
    return null;
  }

  for (let index = start; index <= end; index += 1) {
    const current = lines[index].text;
    if (
      isBlankLine(current) ||
      isFenceLine(current) ||
      isHeadingLine(current) ||
      isListLine(current) ||
      isBlockQuoteLine(current) ||
      isThematicBreakLine(current) ||
      isTableLine(current)
    ) {
      return null;
    }
  }

  const paragraph = document.slice(lines[start].start, position);
  if (paragraph.trim().length === 0 || hasUnsafeInlineSyntax(paragraph)) {
    return null;
  }

  return {
    from: lines[start].start,
    to: position,
    paragraph,
  };
}
