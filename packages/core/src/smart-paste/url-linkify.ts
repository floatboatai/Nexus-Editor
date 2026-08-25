/**
 * URL-over-selection linkify rules for smart paste.
 *
 * Pure function over (pasted text, selected text) → replacement Markdown or
 * `null` (fall through to the default paste). The rule table is deliberately
 * explicit so every branch is testable:
 *
 * | # | Selection              | Pasted    | Result                          |
 * |---|------------------------|-----------|---------------------------------|
 * | 1 | collapsed              | URL       | fall through (verbatim insert)  |
 * | 2 | non-empty single line  | URL       | `[selection](url)`              |
 * | 3 | selection is a URL     | URL       | `[old-url-text](new-url)`       |
 * | 4 | anything               | non-URL   | fall through                    |
 * | 5 | multi-line             | URL       | fall through (avoids bad links) |
 * | 6 | inside link syntax     | URL       | fall through (avoids mangling)  |
 */

import { formatLinkTarget } from "./html-table-to-gfm";

const URL_PATTERN = /^https?:\/\/\S+$/;

/**
 * Compute the linkified replacement for a URL paste, or `null` when the
 * default paste behavior should run instead.
 */
export function applyUrlLinkify(pastedText: string, selectedText: string): string | null {
  const url = pastedText.trim();
  if (!URL_PATTERN.test(url)) return null;

  const label = selectedText.trim();
  if (!label) return null;
  // Multi-line labels cannot sit inside `[...]`; wrapping would produce a
  // broken link, so leave the paste to the default path.
  if (/[\r\n]/.test(selectedText)) return null;
  // A selection that already looks like link syntax (or part of one) is being
  // edited deliberately — re-wrapping would mangle it.
  if (selectedText.includes("](") || selectedText.startsWith("[")) return null;

  const safeLabel = label.replace(/([[\\\]])/g, "\\$1");
  return `[${safeLabel}](${formatLinkTarget(url)})`;
}
