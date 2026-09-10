import { SearchError } from "./search-types";
import type {
  SearchHit,
  SearchScanRequest,
  SearchScanResult,
} from "./search-types";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function advanceCodePoint(text: string, position: number): number {
  const point = text.codePointAt(position);
  return position + (point !== undefined && point > 0xffff ? 2 : 1);
}

function before(text: string, position: number): string {
  if (position === 0) return "";
  const last = text.charCodeAt(position - 1);
  return text.slice(
    last >= 0xdc00 && last <= 0xdfff && position > 1
      ? position - 2
      : position - 1,
    position,
  );
}

function after(text: string, position: number): string {
  return text.slice(position, advanceCodePoint(text, position));
}

const WORD_CHARACTER = /[\p{L}\p{N}\p{M}_]/u;

function replacementText(template: string, match: RegExpExecArray, content: string): string {
  return template.replace(/\$([$&`']|\d{1,2}|<[^>]*>)/g, (token, key: string) => {
    if (key === "$") return "$";
    if (key === "&") return match[0];
    if (key === "`") return content.slice(0, match.index);
    if (key === "'") return content.slice(match.index + match[0].length);
    if (key.startsWith("<")) return match.groups ? match.groups[key.slice(1, -1)] ?? "" : token;
    const index = Number(key);
    if (index > 0 && index < match.length) return match[index] ?? "";
    const first = Number(key[0]);
    if (key.length === 2 && first > 0 && first < match.length) return (match[first] ?? "") + key[1];
    return token;
  });
}

/** Runs only in a worker in production: arbitrary JS regexes may not terminate. */
export function scanSearchDocument(
  request: SearchScanRequest,
): SearchScanResult {
  const { content, query, document } = request;
  const started = performance.now();
  try {
    if (!Number.isSafeInteger(request.offset) || request.offset < 0 ||
      !Number.isSafeInteger(request.limit) || request.limit < 1) {
      throw new RangeError("Invalid scan offset or limit");
    }
    if (query.text.length > 4096) throw new RangeError("Search queries must be at most 4096 characters");
    if (!query.text || request.offset > content.length) {
      return {
        hits: [],
        nextOffset: null,
        elapsed: performance.now() - started,
      };
    }
    const expression = new RegExp(
      query.regex ? query.text : escapeRegExp(query.text),
      `gmu${query.caseSensitive ? "" : "i"}`,
    );
    expression.lastIndex = request.offset;
    const hits: SearchHit[] = [];
    let replacementBytes = 0;
    let nextOffset: number | null = null;
    let line = 0;
    let lineStart = 0;
    let newline = content.indexOf("\n");
    while (hits.length <= request.limit) {
      const match = expression.exec(content);
      if (!match) break;
      const from = match.index;
      const to = from + match[0].length;
      if (to === from) expression.lastIndex = advanceCodePoint(content, to);
      if (
        query.wholeWord &&
        (WORD_CHARACTER.test(before(content, from)) ||
          WORD_CHARACTER.test(after(content, to)))
      )
        continue;
      // Probe one valid match ahead so an exact page boundary is not reported
      // as truncation. The next request starts at that unconsumed match.
      if (hits.length === request.limit) {
        nextOffset = from;
        break;
      }
      while (newline >= 0 && newline < from) {
        line += 1;
        lineStart = newline + 1;
        newline = content.indexOf("\n", lineStart);
      }
      let snippetFrom = Math.max(lineStart, from - 70);
      // Never start a snippet in the middle of a surrogate pair.
      const startCode = content.charCodeAt(snippetFrom);
      if (startCode >= 0xdc00 && startCode <= 0xdfff) snippetFrom -= 1;
      let snippetTo = Math.min(
        content.length,
        Math.max(to, from + 100),
        snippetFrom + 220,
      );
      const endCode = content.charCodeAt(snippetTo);
      if (endCode >= 0xdc00 && endCode <= 0xdfff) snippetTo -= 1;
      const replacement = query.replacement === undefined ? undefined :
        query.regex ? replacementText(query.replacement, match, content) : query.replacement;
      replacementBytes += replacement === undefined ? 0 : new TextEncoder().encode(replacement).byteLength;
      if (request.maxReplacementBytes !== undefined && replacementBytes > request.maxReplacementBytes) {
        throw new RangeError("Expanded replacement output exceeds the file-size limit");
      }
      hits.push({
        fileId: document.id,
        path: document.path,
        version: document.version,
        from,
        to,
        line,
        column: from - lineStart,
        snippetFrom,
        snippet: content.slice(snippetFrom, snippetTo),
        ...(replacement === undefined ? {} : { replacement }),
      });
    }
    return {
      hits,
      nextOffset,
      elapsed: performance.now() - started,
    };
  } catch (error) {
    throw new SearchError("invalid-query", error instanceof Error ? error.message : String(error), { cause: error });
  }
}

export function matchesSearchPath(
  path: string,
  include = "",
  exclude = "",
): boolean {
  if (include.length + exclude.length > 4096)
    throw new Error("File filters must be at most 4096 characters.");
  const matches = (input: string): boolean =>
    input
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .some((pattern) => {
        if (pattern.endsWith("/")) pattern += "**";
        const target = Array.from(
          pattern.includes("/") ? path : path.slice(path.lastIndexOf("/") + 1),
        );
        // Glob matching uses bounded dynamic programming, not a backtracking RegExp
        // on the renderer thread.
        const tokens = pattern.match(/\*\*\/|\*\*|\*|\?|[^*?]/gu) ?? [];
        let previous = Array<boolean>(target.length + 1).fill(false);
        previous[0] = true;
        for (const token of tokens) {
          const next = Array<boolean>(target.length + 1).fill(false);
          if (token === "*" || token === "**" || token === "**/")
            next[0] = previous[0];
          let globstarReachable = false;
          for (let position = 1; position <= target.length; position += 1) {
            const character = target[position - 1];
            if (token === "**/") {
              globstarReachable ||= previous[position - 1];
              next[position] =
                previous[position] || (globstarReachable && character === "/");
            } else if (token === "**")
              next[position] = previous[position] || next[position - 1];
            else if (token === "*")
              next[position] =
                previous[position] || (next[position - 1] && character !== "/");
            else
              next[position] =
                previous[position - 1] &&
                (token === "?" ? character !== "/" : token === character);
          }
          previous = next;
        }
        return previous[target.length];
      });
  return (
    (!include.trim() || matches(include)) &&
    (!exclude.trim() || !matches(exclude))
  );
}
