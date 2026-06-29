import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

import { escapeMarkdownLabel, encodeMarkdownDestination } from "../src/markdown-safe";

// Render Markdown through the repo's existing CommonMark pipeline (remark →
// rehype). Regex extraction of the *Markdown* missed the backslash-escape and
// `<scheme:…>` autolink vectors; a real parser surfaces them.
function renderToHtml(markdown: string): string {
  return String(
    unified().use(remarkParse).use(remarkRehype).use(rehypeStringify).processSync(markdown),
  );
}

// True if any of `chars` appears "active" (preceded by an even run of
// backslashes, i.e. CommonMark would treat it as syntax, not a literal).
function hasActiveSpecial(s: string, chars: string): boolean {
  let backslashes = 0;
  for (const c of s) {
    if (c === "\\") {
      backslashes++;
      continue;
    }
    if (chars.includes(c) && backslashes % 2 === 0) return true;
    backslashes = 0;
  }
  return false;
}

describe("escapeMarkdownLabel", () => {
  it("escapes brackets so a crafted filename cannot inject a sibling link", () => {
    const escaped = escapeMarkdownLabel("a](javascript:alert(1))[t](javascript:alert(1)).png");
    // `]` is backslash-escaped, so it cannot close `![…]` and inject a destination.
    expect(escaped).toContain("\\]");
    // No unescaped `](` survives to start a new link target.
    expect(escaped).not.toMatch(/(?<!\\)\]\(/);
    // The full snippet parses to a single image with no injected javascript: destination.
    const snippet = `![${escaped}](safeurl)`;
    expect(snippet).not.toContain("javascript:alert(1))[");
  });

  it("strips control chars", () => {
    expect(escapeMarkdownLabel("a\x00b\x1fc\x7f")).toBe("abc");
  });

  it("a crafted filename cannot break out of the image label (parser-level)", () => {
    const escaped = escapeMarkdownLabel("x\\]<javascript:alert(1)>.png");
    // No active `]` (the `\\]` premature-close vector) and no unescaped `<`/`>`
    // (the `<scheme:…>` autolink vector).
    expect(hasActiveSpecial(escaped, "]")).toBe(false);
    expect(hasActiveSpecial(escaped, "<>")).toBe(false);

    const html = renderToHtml(`![${escaped}](nexus-vault://v/a.png)`);
    // No injected anchor / autolink, and the only destination is the safe src.
    expect(html).not.toMatch(/<a\b/);
    const urls = [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
    for (const u of urls) expect(u.toLowerCase()).not.toMatch(/^javascript:/);
    expect(urls).toEqual(["nexus-vault://v/a.png"]);
  });

  it("escapes a trailing backslash so it cannot escape the closing bracket (parser-level)", () => {
    // A trailing `\` would turn `![…\](dest)` into an escaped `\]` that never
    // closes the label, dropping the image (or worse, merging constructs).
    const escaped = escapeMarkdownLabel("name\\");
    const html = renderToHtml(`![${escaped}](nexus-vault://v/a.png)`);
    expect(html).not.toMatch(/<a\b/);
    const urls = [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
    // Fails if `\` is dropped from escapeMarkdownLabel's regex: the label never
    // closes, no image renders, and this becomes `[]` instead of the safe src.
    expect(urls).toEqual(["nexus-vault://v/a.png"]);
  });
});

describe("encodeMarkdownDestination", () => {
  it("leaves a custom-scheme url with no special chars unchanged", () => {
    const url = "nexus-vault://vault/attachments/x.png";
    expect(encodeMarkdownDestination(url)).toBe(url);
  });

  it("percent-encodes structural chars and spaces", () => {
    expect(encodeMarkdownDestination("nexus-vault://v/a b)c.png")).toBe(
      "nexus-vault://v/a%20b%29c.png",
    );
  });

  it("percent-encodes a backslash so it cannot escape the destination", () => {
    const encoded = encodeMarkdownDestination("a\\b");
    expect(encoded).toContain("%5C");
    expect(encoded).not.toContain("\\");
  });
});
