// @vitest-environment jsdom
// 5.1 — jsdom environment; DOMPurify binds to this window lazily on first use,
// so the security tests below genuinely execute the sanitizer.
import { marked } from "marked";
import { describe, expect, it, vi } from "vitest";

import { createPastePlugin, htmlToMarkdown } from "../src/index";

type UploadAsset = (file: File) => Promise<string | null>;

const noUpload: UploadAsset = async () => null;

const md = (html: string, uploadAsset: UploadAsset = noUpload): Promise<string> =>
  htmlToMarkdown(html, { uploadAsset });

// Extract every inline link/image destination from emitted Markdown. The label
// matcher honours turndown's backslash escapes so a `\]` cannot end the label.
function extractDestinations(markdown: string): string[] {
  const re = /!?\[(?:\\.|[^\]\\])*\]\(([^)\s]*)(?:\s+"(?:\\.|[^"\\])*")?\)/g;
  const dests: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) dests.push(m[1]);
  return dests;
}

// Parse emitted Markdown through a REAL CommonMark renderer (marked) and pull
// every href/src from the resulting HTML. Regex extraction of the *Markdown*
// missed the backslash-escape (`\:`) and autolink (`<scheme:…>`) vectors —
// those only gain meaning once a CommonMark parser runs.
function renderedUrls(markdown: string): string[] {
  const html = marked.parse(markdown) as string;
  const urls: string[] = [];
  const re = /(?:href|src)\s*=\s*"([^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) urls.push(m[1]);
  return urls;
}

function expectNoDangerousScheme(urls: string[]): void {
  for (const u of urls) {
    expect(u.trim().toLowerCase()).not.toMatch(/^(?:javascript|vbscript|data):/);
  }
}

function isSafeDest(d: string): boolean {
  let abs: URL | null = null;
  try {
    abs = new URL(d);
  } catch {
    abs = null;
  }
  if (abs) {
    const scheme = abs.protocol.slice(0, -1).toLowerCase();
    return scheme === "http" || scheme === "https" || scheme === "mailto" || scheme === "nexus-vault";
  }
  try {
    return new URL(d, "https://host.invalid/").host === "host.invalid";
  } catch {
    return false;
  }
}

// --- handler harness ---------------------------------------------------------

interface FakeClipboard {
  files: File[];
  items: Array<{ kind: string; getAsFile: () => File | null }>;
  getData: (type: string) => string;
}

function makeClipboard(opts: {
  html?: string;
  files?: File[];
  items?: FakeClipboard["items"];
  throwOnGet?: boolean;
}): FakeClipboard {
  return {
    files: opts.files ?? [],
    items: opts.items ?? [],
    getData: (type: string) => {
      if (opts.throwOnGet) throw new Error("boom");
      return type === "text/html" ? opts.html ?? "" : "";
    },
  };
}

function runPaste(clipboard: FakeClipboard | null, ctx: { insertMarkdown: (m: string) => void; uploadAsset: (f: File) => Promise<string | null> }) {
  const plugin = createPastePlugin();
  const handler = plugin.handlers!.paste!;
  const event = { clipboardData: clipboard, preventDefault: () => {} };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return handler(event as any, { editor: {} as any, ...ctx } as any);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// ===========================================================================
// 5.2 — basic formatting
// ===========================================================================

describe("5.2 basic HTML → Markdown", () => {
  it("converts bold/italic/inline-code/headings", async () => {
    expect(await md("<b>bold</b>")).toContain("**bold**");
    expect(await md("<i>italic</i>")).toContain("_italic_");
    expect(await md("<code>x</code>")).toContain("`x`");
    expect(await md("<h1>Title</h1>")).toContain("# Title");
  });

  it("converts nested unordered lists with `-` bullets", async () => {
    const out = await md("<ul><li>a<ul><li>b</li></ul></li></ul>");
    expect(out).toMatch(/-\s+a/);
    expect(out).toMatch(/\s+-\s+b/);
  });

  it("keeps a hyperlink whose text equals text/plain (does not fall through)", async () => {
    expect(await md('<a href="https://example.com">Example</a>')).toContain(
      "[Example](https://example.com)",
    );
  });
});

// ===========================================================================
// 5.3 — GFM + editor conventions
// ===========================================================================

describe("5.3 GFM constructs", () => {
  it("converts a table to GFM", async () => {
    const out = await md(
      "<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>C</td></tr></tbody></table>",
    );
    expect(out).toContain("| H |");
    expect(out).toContain("| C |");
    expect(out).toMatch(/\|\s*-+\s*\|/);
  });

  it("converts strikethrough", async () => {
    // turndown-plugin-gfm 1.0.2 emits single-tilde strikethrough (GitHub renders it).
    expect(await md("<del>gone</del>")).toMatch(/~+gone~+/);
  });

  it("converts task lists", async () => {
    const out = await md(
      '<ul><li><input type="checkbox" checked>done</li><li><input type="checkbox">todo</li></ul>',
    );
    expect(out).toMatch(/-\s+\[x\]\s+done/);
    expect(out).toMatch(/-\s+\[ \]\s+todo/);
  });

  it("converts a fenced code block preserving the language", async () => {
    const out = await md('<pre><code class="language-js">const a=1;</code></pre>');
    expect(out).toContain("```");
    expect(out).toContain("const a=1;");
    expect(out).toContain("js");
  });
});

// ===========================================================================
// 5.4 — fall-through for plain / no-formatting
// ===========================================================================

describe("5.4 fall-through", () => {
  it("falls through when there is no HTML (plain text only)", () => {
    const ctx = { insertMarkdown: vi.fn(), uploadAsset: vi.fn() };
    expect(runPaste(makeClipboard({ html: "" }), ctx)).toBe(false);
    expect(ctx.insertMarkdown).not.toHaveBeenCalled();
  });

  it("falls through for HTML with no formatting/structural element", () => {
    const ctx = { insertMarkdown: vi.fn(), uploadAsset: vi.fn() };
    const html = "<html><meta charset=utf-8><div><p>hello <span>world</span></p></div></html>";
    expect(runPaste(makeClipboard({ html }), ctx)).toBe(false);
    expect(ctx.insertMarkdown).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 5.5 — file-bearing clipboards always fall through
// ===========================================================================

describe("5.5 file paste falls through", () => {
  it("falls through when clipboardData.files is non-empty", () => {
    const ctx = { insertMarkdown: vi.fn(), uploadAsset: vi.fn() };
    const file = new File(["x"], "a.png", { type: "image/png" });
    expect(runPaste(makeClipboard({ html: "<b>x</b>", files: [file] }), ctx)).toBe(false);
    expect(ctx.insertMarkdown).not.toHaveBeenCalled();
  });

  it("falls through when clipboardData.items has a kind==='file' entry", () => {
    const ctx = { insertMarkdown: vi.fn(), uploadAsset: vi.fn() };
    const file = new File(["x"], "a.png", { type: "image/png" });
    const items = [{ kind: "file", getAsFile: () => file }];
    expect(runPaste(makeClipboard({ html: "<b>x</b>", items }), ctx)).toBe(false);
    expect(ctx.insertMarkdown).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 5.6 — image handling via the upload pipeline
// ===========================================================================

const PNG_B64 = "iVBORw0KGgo="; // valid base64, decodes fine

describe("5.6 images", () => {
  it("keeps a remote image as a Markdown link (no upload)", async () => {
    const upload = vi.fn();
    expect(await md('<img src="https://e/a.png" alt="pic">', upload)).toContain(
      "![pic](https://e/a.png)",
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads a data: image and references the returned URL (not inlined)", async () => {
    const upload = vi.fn(async (_file: File) => "https://cdn/x.png");
    const out = await md(`<img src="data:image/png;base64,${PNG_B64}">`, upload);
    expect(out).toContain("https://cdn/x.png");
    expect(out).not.toContain("data:");
    expect(upload).toHaveBeenCalledTimes(1);
    const file = upload.mock.calls[0][0];
    expect(file.type).toBe("image/png");
    expect(file.name).toMatch(/^pasted-image-\d+\.png$/);
    expect(file.name).not.toMatch(/[/\\]|\.\./);
  });

  it("omits only the failed image when one upload rejects (per-image best-effort)", async () => {
    const upload = vi
      .fn()
      .mockResolvedValueOnce("https://cdn/a.png")
      .mockRejectedValueOnce(new Error("boom"));
    const out = await md(
      `<p>before <img src="data:image/png;base64,${PNG_B64}"> mid <img src="data:image/png;base64,${PNG_B64}"> after</p>`,
      upload,
    );
    expect(out).toContain("before");
    expect(out).toContain("after");
    expect(out).toContain("https://cdn/a.png");
    expect(extractDestinations(out)).toEqual(["https://cdn/a.png"]);
  });

  it("omits only the image whose base64 fails to decode", async () => {
    const upload = vi.fn(async () => "https://cdn/good.png");
    const out = await md(
      `<p>x <img src="data:image/png;base64,${PNG_B64}"> y <img src="data:image/png;base64,@@@"> z</p>`,
      upload,
    );
    expect(out).toContain("x");
    expect(out).toContain("y");
    expect(out).toContain("z");
    expect(extractDestinations(out)).toEqual(["https://cdn/good.png"]);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("omits a data: image when the upload returns null", async () => {
    const out = await md(`text<img src="data:image/png;base64,${PNG_B64}">`, async () => null);
    expect(extractDestinations(out)).toEqual([]);
    expect(out).toContain("text");
  });

  it("does not upload non-raster data: URIs", async () => {
    const upload = vi.fn();
    const outHtml = await md('a<img src="data:text/html,<b>x</b>">b', upload);
    const outSvg = await md('a<img src="data:image/svg+xml,<svg></svg>">b', upload);
    expect(extractDestinations(outHtml)).toEqual([]);
    expect(extractDestinations(outSvg)).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
  });

  it("keeps a custom-scheme URL returned by uploadAsset (no scheme gate)", async () => {
    const upload = vi.fn(async () => "nexus-vault://abc/def.png");
    const out = await md(`<img src="data:image/png;base64,${PNG_B64}">`, upload);
    expect(out).toContain("nexus-vault://abc/def.png");
  });
});

// ===========================================================================
// 5.7 — security
// ===========================================================================

describe("5.7 security", () => {
  it("strips executable / unsafe content", async () => {
    expect(await md("<script>alert(1)</script><b>ok</b>")).not.toContain("alert");
    expect(await md('<iframe src="https://e"></iframe><b>ok</b>')).not.toContain("iframe");
    expect(await md('<b onclick="alert(1)">ok</b>')).not.toContain("onclick");

    const onerr = await md('<img onerror="alert(1)" src="https://e/a.png">');
    expect(onerr).not.toContain("onerror");
    expect(onerr).not.toContain("alert");
    expect(onerr).toContain("https://e/a.png");

    const svg = await md('<svg><image xlink:href="data:image/png;base64,AAA"/></svg><b>ok</b>');
    expect(svg).not.toContain("svg");
    expect(svg).not.toContain("data:");
    expect(svg).toContain("ok");

    // disallowed link schemes → href stripped by DOMPurify → plain text, no link
    for (const href of ["javascript:alert(1)", "data:text/html,x", "vbscript:msgbox(1)", "javas&#99;ript:alert(1)"]) {
      const out = await md(`<a href="${href}">x</a>`);
      expect(extractDestinations(out)).toEqual([]);
      expect(out.toLowerCase()).not.toContain("javascript");
      expect(out.toLowerCase()).not.toContain("vbscript");
      expect(out).toContain("x");
    }
  });

  it("structurally encodes a breakout destination (img), no extra link/image", async () => {
    const out = await md('<img src="/x)[t](javascript:alert(1))">');
    const dests = extractDestinations(out);
    expect(dests).toHaveLength(1);
    expect(isSafeDest(dests[0])).toBe(true); // resolves relative, not a javascript: scheme
    expect(out).toContain("%28"); // proof of structural encoding
  });

  it("drops a malformed-scheme link destination, no extra link", async () => {
    const out = await md('<a href="https://x)[c](javascript:alert(1))">t</a>');
    expect(extractDestinations(out)).toEqual([]);
    expect(out).toContain("t");
  });

  it("escapes image alt so it cannot break Markdown", async () => {
    const out = await md('<img alt="x](javascript:alert(1))![" src="https://e/a.png">');
    expect(out).toContain("![x\\]\\(javascript:alert\\(1\\)\\)!\\[](https://e/a.png)");
    const dests = extractDestinations(out);
    expect(dests).toEqual(["https://e/a.png"]);
  });

  it("escapes image title so it cannot break Markdown", async () => {
    const out = await md("<img title='x\") [c](javascript:alert(1))' src=\"https://e/a.png\">");
    expect(out).toContain(
      '![](https://e/a.png "x\\"\\) \\[c\\]\\(javascript:alert\\(1\\)\\)")',
    );
    expect(extractDestinations(out)).toEqual(["https://e/a.png"]);
  });

  it("does not let link text break out into a second link", async () => {
    const out = await md('<a href="https://ok">x](javascript:alert(1))[y</a>');
    const dests = extractDestinations(out);
    expect(dests).toEqual(["https://ok"]);
    expect(dests.every(isSafeDest)).toBe(true);
  });

  it("rejects protocol-relative and backslash-authority link destinations", async () => {
    for (const href of ["//evil.com", "/\\evil.com"]) {
      const out = await md(`<a href="${href}">x</a>`);
      expect(extractDestinations(out)).toEqual([]);
      expect(out).not.toContain("evil.com");
      expect(out).toContain("x");
    }
  });

  it("every emitted destination across fixtures is scheme-safe", async () => {
    const fixtures = [
      '<img src="/x)[t](javascript:alert(1))">',
      '<a href="https://x)[c](javascript:alert(1))">t</a>',
      '<img alt="x](javascript:alert(1))![" src="https://e/a.png">',
      "<img title='x\") [c](javascript:alert(1))' src=\"https://e/a.png\">",
      '<a href="https://ok">x](javascript:alert(1))[y</a>',
      '<a href="//evil.com">x</a>',
      '<a href="/\\evil.com">x</a>',
    ];
    for (const html of fixtures) {
      const dests = extractDestinations(await md(html));
      for (const d of dests) expect(isSafeDest(d)).toBe(true);
    }
  });
});

// ===========================================================================
// 5.7b — parser-level: emitted Markdown is safe under a REAL CommonMark parser.
// The old regex extractor missed the `\:` backslash-escape and `<scheme:…>`
// autolink vectors; marked renders both, so these tests genuinely depend on the
// encoders (they fail if the backslash/autolink hardening is removed).
// ===========================================================================

describe("5.7b parser-level (marked)", () => {
  it("drops a backslash-colon javascript: link (CommonMark unescapes `\\:` → `:`)", async () => {
    const out = await md('<a href="javascript\\:alert`1`">x</a>');
    expectNoDangerousScheme(renderedUrls(out));
    expect(out).toContain("x");
  });

  it("yields no dangerous-scheme href/src for any breakout fixture", async () => {
    const fixtures = [
      '<a href="javascript\\:alert`1`">x</a>',
      '<img src="/x)[t](javascript:alert(1))">',
      '<a href="https://x)[c](javascript:alert(1))">t</a>',
      '<img alt="x](javascript:alert(1))![" src="https://e/a.png">',
      "<img title='x\") [c](javascript:alert(1))' src=\"https://e/a.png\">",
      '<a href="https://ok">x](javascript:alert(1))[y</a>',
      '<a href="//evil.com">x</a>',
      '<a href="/\\evil.com">x</a>',
    ];
    for (const html of fixtures) {
      expectNoDangerousScheme(renderedUrls(await md(html)));
    }
  });
});

// ===========================================================================
// 5.7c — entity / homoglyph / hr / backslash regression. Locks in the
// contested HTML-entity scheme vector and the T2/T3 review findings.
// ===========================================================================

describe("5.7c entity / homoglyph / hr / backslash regression", () => {
  it("keeps HTML-entity scheme bypasses closed (DOMPurify decodes+strips at parse time)", async () => {
    const fixtures = [
      '<a href="java&#115;cript:alert(1)">x</a>',
      '<a href="&#106;avascript:alert(1)">x</a>',
      '<a href="javascript&#58;alert(1)">x</a>',
      '<a href="javascript&#x3a;alert(1)">x</a>',
      '<img src="java&#115;cript:alert(1)" alt="y">',
    ];
    for (const html of fixtures) {
      expectNoDangerousScheme(renderedUrls(await md(html)));
    }
  });

  it("treats a full-width-colon homoglyph as inert (not the javascript: scheme)", async () => {
    const urls = renderedUrls(await md('<a href="javascript：alert(1)">x</a>'));
    expect(urls).toHaveLength(1);
    expect(urls[0].toLowerCase()).not.toMatch(/^javascript:/);
    expect(isSafeDest(urls[0])).toBe(true); // relative/percent-encoded dest is fine
  });

  it("emits a thematic break for <hr> and converts surrounding structure (T2)", async () => {
    const hr = await md("<hr>");
    expect(hr.trim().length).toBeGreaterThan(0);
    expect(hr).toMatch(/(?:\*\s?){3,}|-{3,}|_{3,}/);
    const wrapped = await md("<div><p>x</p><hr></div>");
    expect(wrapped).toContain("x");
    expect(wrapped).toMatch(/(?:\*\s?){3,}|-{3,}|_{3,}/);
  });

  it("escapes a trailing backslash in alt/title so it cannot merge constructs (T3)", async () => {
    const imgUrls = renderedUrls(await md('<img alt="x\\" src="https://e/a.png">'));
    expect(imgUrls).toEqual(["https://e/a.png"]);
    expectNoDangerousScheme(imgUrls);

    const aUrls = renderedUrls(await md('<a href="https://ok" title="t\\">x</a>'));
    expect(aUrls).toEqual(["https://ok"]);
    expectNoDangerousScheme(aUrls);
  });
});

// ===========================================================================
// 5.8 — never break paste on error
// ===========================================================================

describe("5.8 error handling", () => {
  it("falls through on oversized input", () => {
    const ctx = { insertMarkdown: vi.fn(), uploadAsset: vi.fn() };
    const html = "<b>x</b>" + "a".repeat(2_000_001);
    expect(runPaste(makeClipboard({ html }), ctx)).toBe(false);
    expect(ctx.insertMarkdown).not.toHaveBeenCalled();
  });

  it("falls through (does not throw) when the sync phase throws", () => {
    const ctx = { insertMarkdown: vi.fn(), uploadAsset: vi.fn() };
    expect(runPaste(makeClipboard({ throwOnGet: true }), ctx)).toBe(false);
    expect(ctx.insertMarkdown).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// handler integration: consume + insert
// ===========================================================================

describe("handler consume + insert", () => {
  it("consumes meaningful HTML and inserts synchronously when no data: images", () => {
    const ctx = { insertMarkdown: vi.fn(), uploadAsset: vi.fn() };
    expect(runPaste(makeClipboard({ html: "<b>hi</b>" }), ctx)).toBe(true);
    expect(ctx.insertMarkdown).toHaveBeenCalledTimes(1);
    expect(ctx.insertMarkdown.mock.calls[0][0]).toContain("**hi**");
  });

  it("consumes synchronously and inserts once after data: uploads resolve", async () => {
    const ctx = {
      insertMarkdown: vi.fn(),
      uploadAsset: vi.fn(async () => "https://cdn/x.png"),
    };
    const consumed = runPaste(makeClipboard({ html: `<img src="data:image/png;base64,${PNG_B64}">` }), ctx);
    expect(consumed).toBe(true);
    expect(ctx.insertMarkdown).not.toHaveBeenCalled(); // deferred
    await flush();
    expect(ctx.insertMarkdown).toHaveBeenCalledTimes(1);
    expect(ctx.insertMarkdown.mock.calls[0][0]).toContain("https://cdn/x.png");
  });
});
