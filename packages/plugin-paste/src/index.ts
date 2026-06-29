import DOMPurify from "dompurify";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

import { collectFilesFromDataTransfer } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Hard cap on pasted-HTML size, checked **before** any parse/regex touches the
 * string — guards against pathological / ReDoS input. Oversized → fall through.
 */
const MAX_HTML_LENGTH = 2_000_000;

/**
 * Explicit element allowlist. Excludes (by omission) `svg`, `image`, `video`,
 * `audio`, `source`, `track`, `foreignObject`, `math`, `object`, `embed`,
 * `iframe`, `base`, `form`, `style`, `script`. `input` is allowed only so GFM
 * task-list checkboxes survive for the converter.
 */
const ALLOWED_TAGS = [
  "a",
  "p",
  "br",
  "hr",
  "span",
  "div",
  "strong",
  "b",
  "em",
  "i",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "code",
  "pre",
  "blockquote",
  "del",
  "s",
  "img",
  "input",
];

const ALLOWED_ATTR = [
  "href",
  "src",
  "alt",
  "title",
  "colspan",
  "rowspan",
  "start",
  "align",
  "type",
  "checked",
  "disabled",
  "class", // inert; lets turndown read `language-*` on code blocks
];

/**
 * Formatting/structural elements whose presence makes a paste "meaningful"
 * (worth converting). Plain text wrapped in `<html>`/`<meta>`/`<p>`/`<div>`/
 * `<span>` has none of these → fall through.
 */
const MEANINGFUL_SELECTOR =
  "a,strong,em,b,i,h1,h2,h3,h4,h5,h6,ul,ol,li,table,thead,tbody,tfoot,tr,td,th,code,pre,blockquote,del,s,img,hr";

/** Only raster image MIME types may be decoded + uploaded. */
const RASTER_MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

// ---------------------------------------------------------------------------
// Markdown-safe encoding / escaping (local copies of core's markdown-safe.ts;
// that module is internal to @floatboat/nexus-core and not exported).
// ---------------------------------------------------------------------------

const CONTROL_CHARS_GLOBAL = /[\x00-\x1f\x7f]/g;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

const DEST_ENCODE: Record<string, string> = {
  "(": "%28",
  ")": "%29",
  "[": "%5B",
  "]": "%5D",
  "<": "%3C",
  ">": "%3E",
  " ": "%20",
  "\\": "%5C",
};

/**
 * Structural percent-encoding only: encodes the characters that would break the
 * `(url)` wrapper and strips control chars. No scheme check — used for the
 * host-trusted `ctx.uploadAsset` return (which may carry a custom scheme such
 * as `nexus-vault://`).
 */
function encodeDestination(url: string): string {
  return url.replace(CONTROL_CHARS_GLOBAL, "").replace(/[()[\]<> \\]/g, (c) => DEST_ENCODE[c]);
}

/**
 * Classify an HTML-derived destination via URL parsing (never `startsWith`):
 * `http`/`https`/`mailto` absolute or a path/query/fragment-relative URL is
 * allowed; everything else — disallowed schemes, protocol-relative `//host`,
 * backslash-authority `/\host` — is rejected.
 */
function classifyDestination(raw: string): "absolute" | "relative" | "reject" {
  let abs: URL | null = null;
  try {
    abs = new URL(raw);
  } catch {
    abs = null;
  }
  if (abs) {
    const scheme = abs.protocol.slice(0, -1).toLowerCase();
    return scheme === "http" || scheme === "https" || scheme === "mailto" ? "absolute" : "reject";
  }
  try {
    // Resolve against a sentinel base; a protocol-relative or backslash
    // authority injects a different host, which we reject.
    const resolved = new URL(raw, "https://nexus.invalid/");
    return resolved.host === "nexus.invalid" ? "relative" : "reject";
  } catch {
    return "reject";
  }
}

/**
 * Resolve an HTML-derived (untrusted) destination: scheme/authority gate, then
 * reject control chars, then structurally encode. Returns null to signal the
 * link/image should be dropped.
 */
function resolveHtmlDestination(raw: string): string | null {
  if (classifyDestination(raw) === "reject") return null;
  if (CONTROL_CHARS.test(raw)) return null;
  // Legit http/https/mailto/relative URLs never contain a literal backslash;
  // dropping any that do kills the `javascript\:` classify-bypass at the source.
  if (raw.includes("\\")) return null;
  return encodeDestination(raw);
}

/**
 * Markdown-escape text destined for image `alt`, image `title`, or link
 * `title`. These fields are tokenized before turndown runs, so the converter's
 * own (version-dependent) escaping never touches them — this is the sole,
 * authoritative escaper. Escapes `\` `[` `]` `(` `)` `"` `<` `>` `` ` `` and
 * strips control chars so the text cannot close its bracket/quote and open a
 * sibling destination, form an autolink, or open a code span. Backslash is
 * escaped first (single pass) to close the `\"`→`\\"`-premature-close vector.
 */
function escapeText(s: string): string {
  return s.replace(CONTROL_CHARS_GLOBAL, "").replace(/[\\"[\]()<>`]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// DOMPurify (lazily bound to the current window, incl. jsdom in tests)
// ---------------------------------------------------------------------------

let purifier: ReturnType<typeof DOMPurify> | undefined;

function sanitizeToBody(html: string): HTMLElement {
  if (!purifier) {
    purifier = DOMPurify(window as unknown as Parameters<typeof DOMPurify>[0]);
  }
  // Default ALLOWED_URI_REGEXP + default DATA_URI_TAGS (keeps `data:` on <img>
  // only). Inert parse; unknown tags strip to text (KEEP_CONTENT).
  return purifier.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    KEEP_CONTENT: true,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM: true,
    RETURN_DOM_FRAGMENT: false,
  }) as unknown as HTMLElement;
}

// ---------------------------------------------------------------------------
// turndown
// ---------------------------------------------------------------------------

function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    strongDelimiter: "**",
    emDelimiter: "_",
    linkStyle: "inlined",
  });
  service.use(gfm);
  return service;
}

// ---------------------------------------------------------------------------
// data: image decoding
// ---------------------------------------------------------------------------

function parseDataMime(src: string): string | null {
  const comma = src.indexOf(",");
  if (comma < 0) return null;
  const meta = src.slice(5, comma); // after "data:"
  const semi = meta.indexOf(";");
  const mime = (semi >= 0 ? meta.slice(0, semi) : meta).trim().toLowerCase();
  return mime || null;
}

/** Decode a `data:` URL to raw bytes. Throws on malformed base64 (caught upstream). */
function dataUrlToBytes(src: string): Uint8Array {
  const comma = src.indexOf(",");
  if (comma < 0) throw new Error("malformed data URL");
  const meta = src.slice(0, comma);
  const payload = src.slice(comma + 1);
  const raw = /;base64/i.test(meta) ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// Tokenization + token resolution
// ---------------------------------------------------------------------------

interface PendingImage {
  token: string;
  src: string;
  mime: string;
  name: string;
}

type TokenResolution =
  | { kind: "swap"; value: string } // replace token with this literal (URL or escaped alt/title text)
  | { kind: "drop"; isImage: boolean }; // remove the whole link/image construct

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace a unique token with a resolved URL (tokens are fixed-width alnum). */
function swapToken(markdown: string, token: string, url: string): string {
  return markdown.split(token).join(url);
}

/**
 * Remove the whole `![…](TOKEN …)` (image) or unwrap `[label](TOKEN …)` to its
 * label (link) for a dropped destination. The label matcher honours turndown's
 * backslash escapes (`\[`, `\]`).
 */
function dropConstruct(markdown: string, token: string, isImage: boolean): string {
  const re = new RegExp(
    "(!?)\\[((?:\\\\.|[^\\]\\\\])*)\\]\\(" + escapeRegExp(token) + '(?:\\s+"(?:\\\\.|[^"\\\\])*")?\\)',
    "g",
  );
  return markdown.replace(re, isImage ? "" : "$2");
}

interface ConvertResult {
  markdown: string;
  pending: PendingImage[];
}

/**
 * Synchronous phase: sanitize → meaningfulness gate → tokenize every
 * `<a href>`/`<img src>` destination **and** every `alt`/`title` text field
 * (turndown's own escaping is a no-op on the alnum tokens, so the plugin is the
 * sole authority for both) → convert to Markdown → resolve every sync token.
 * `data:` image src tokens are left as placeholders and returned in `pending`
 * for the detached upload phase. Returns null when the HTML has no
 * formatting/structural element (fall through). May throw — callers wrap in
 * try/catch.
 */
function convertSync(html: string): ConvertResult | null {
  const body = sanitizeToBody(html);
  if (!body.querySelector(MEANINGFUL_SELECTOR)) return null;

  const tokenBase = "nexuspaste" + Math.random().toString(36).slice(2) + "x";
  let counter = 0;
  const nextToken = (): string => tokenBase + String(counter++).padStart(6, "0");

  const resolutions = new Map<string, TokenResolution>();
  const pending: PendingImage[] = [];

  // Replace an `alt`/`title` text attribute with a token, recording the
  // escaped text for a post-conversion swap.
  const tokenizeText = (el: Element, attr: string): void => {
    const value = el.getAttribute(attr);
    if (!value) return;
    const token = nextToken();
    el.setAttribute(attr, token);
    resolutions.set(token, { kind: "swap", value: escapeText(value) });
  };

  body.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href");
    if (!href) return;
    const token = nextToken();
    anchor.setAttribute("href", token);
    const url = resolveHtmlDestination(href);
    resolutions.set(token, url ? { kind: "swap", value: url } : { kind: "drop", isImage: false });
    tokenizeText(anchor, "title");
  });

  body.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src");
    if (!src) {
      img.remove();
      return;
    }
    const token = nextToken();
    img.setAttribute("src", token);

    if (/^data:/i.test(src)) {
      const mime = parseDataMime(src);
      const ext = mime ? RASTER_MIME_EXT[mime] : undefined;
      if (mime && ext) {
        pending.push({ token, src, mime, name: `pasted-image-${pending.length + 1}.${ext}` });
      } else {
        resolutions.set(token, { kind: "drop", isImage: true });
      }
    } else {
      const url = resolveHtmlDestination(src);
      resolutions.set(token, url ? { kind: "swap", value: url } : { kind: "drop", isImage: true });
    }
    tokenizeText(img, "alt");
    tokenizeText(img, "title");
  });

  let markdown = createTurndown().turndown(body.innerHTML);

  for (const [token, res] of resolutions) {
    markdown =
      res.kind === "drop" ? dropConstruct(markdown, token, res.isImage) : swapToken(markdown, token, res.value);
  }

  return { markdown, pending };
}

type UploadAsset = (file: File) => Promise<string | null>;

/** Per-image best-effort: decode → upload. Resolves to a URL or null (never throws). */
function uploadDataImage(image: PendingImage, uploadAsset: UploadAsset): Promise<string | null> {
  return (async () => {
    const bytes = dataUrlToBytes(image.src);
    const file = new File([bytes as BlobPart], image.name, { type: image.mime });
    return uploadAsset(file);
  })().catch(() => null);
}

/** Resolve `data:` image tokens via await-all, replacing each with its uploaded URL (or dropping it). */
async function resolvePending(
  markdown: string,
  pending: PendingImage[],
  uploadAsset: UploadAsset,
): Promise<string> {
  if (pending.length === 0) return markdown;
  const settled = await Promise.allSettled(pending.map((image) => uploadDataImage(image, uploadAsset)));
  let result = markdown;
  pending.forEach((image, index) => {
    const outcome = settled[index];
    const url = outcome.status === "fulfilled" ? outcome.value : null;
    const encoded = url != null ? encodeDestination(url) : null;
    result = encoded ? swapToken(result, image.token, encoded) : dropConstruct(result, image.token, true);
  });
  return result;
}

function dropAllPending(markdown: string, pending: PendingImage[]): string {
  let result = markdown;
  for (const image of pending) result = dropConstruct(result, image.token, true);
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @internal Convert an HTML string to Markdown, awaiting all `data:` image
 * uploads before returning. Exposed for tests; production code uses
 * {@link createPastePlugin}.
 */
export async function htmlToMarkdown(
  html: string,
  options: { uploadAsset: UploadAsset },
): Promise<string> {
  const converted = convertSync(html);
  if (!converted) return "";
  return resolvePending(converted.markdown, converted.pending, options.uploadAsset);
}

/**
 * Paste plugin: converts pasted rich-text/HTML into Markdown, sanitizes
 * untrusted HTML, and keeps converted destinations + alt/title text
 * syntactically safe. Falls through for plain text, no-formatting HTML, and any
 * file-bearing clipboard.
 */
export function createPastePlugin(): NexusPlugin {
  return {
    name: "plugin-paste",
    handlers: {
      paste(event, ctx) {
        const clipboard = event.clipboardData;
        if (!clipboard) return false;
        try {
          // File-bearing clipboards always fall through to core's onAssetUpload.
          if (collectFilesFromDataTransfer(clipboard).length > 0) return false;

          const html = clipboard.getData("text/html");
          if (!html) return false;
          if (html.length > MAX_HTML_LENGTH) return false;

          const converted = convertSync(html);
          if (!converted) return false; // no formatting/structural element

          if (converted.pending.length === 0) {
            ctx.insertMarkdown(converted.markdown); // single synchronous insert
            return true;
          }

          // data: images present → consume now, upload + insert in a detached
          // task (the handler must return its boolean synchronously).
          void (async () => {
            let markdown: string;
            try {
              markdown = await resolvePending(converted.markdown, converted.pending, ctx.uploadAsset);
            } catch {
              markdown = dropAllPending(converted.markdown, converted.pending);
            }
            ctx.insertMarkdown(markdown);
          })().catch(() => {}); // never throw from a detached paste task
          return true;
        } catch {
          return false; // never throw — fall through on any sync-phase error
        }
      },
    },
  };
}
