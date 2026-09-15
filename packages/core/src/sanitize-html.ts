/**
 * Trust-boundary helpers for Markdown-authored content.
 *
 * Embedded HTML blocks — and paragraphs promoted to HTML nodes because they
 * contain inline tags — reach the document through `innerHTML`, so everything
 * in this module treats its input as hostile.
 *
 * Rewriting the raw source with regular expressions cannot express these rules.
 * The browser resolves character references, accepts `/` in place of whitespace
 * as an attribute separator, ignores leading control characters before a URL
 * scheme, and puts `<svg>` / `<math>` subtrees in foreign namespaces; none of
 * that is visible in the text a pattern would match. These helpers therefore
 * parse first and inspect the same DOM the browser will use, which makes every
 * one of those normalisations irrelevant to the decision.
 */

/**
 * Elements dropped together with their subtree.
 *
 * The animation elements belong here because they write attributes at runtime,
 * after this walk has finished. `<set attributeName="href" to="javascript:…">`
 * was measured putting a script URL into the anchor's *animated* href — the value
 * the browser navigates with — so a click ran the payload while every attribute
 * in the markup looked clean. Screening `to`/`values` cannot cover that, because
 * `attributeName` may name any attribute, including an event handler. Allowlist
 * based sanitisers drop these elements by default for the same reason.
 */
const FORBIDDEN_ELEMENTS = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "param",
  "base",
  "meta",
  "link",
  "noscript",
  "template",
  "portal",
  "animate",
  "animatecolor",
  "animatemotion",
  "animatetransform",
  "set",
  "discard"
]);

/**
 * Attribute names that carry a URL, matched against `localName`. Reading the
 * local name rather than the qualified name means the namespaced forms —
 * `xlink:href` being the one that matters for SVG — are covered by the same
 * entry instead of needing their own.
 */
const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "srcset",
  "poster",
  "action",
  "formaction",
  "background",
  "cite",
  "data"
]);

/** Schemes a Markdown document may navigate to. */
const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

/**
 * `data:` is refused everywhere except the attributes the browser renders as an
 * image, where the payload cannot run script. Serving it to `href` would make the
 * destination a document of the author's choosing.
 */
const DATA_IMAGE_URL = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,]/;

const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/;

export interface SafeUrlOptions {
  /** Permit a `data:image/*` payload. Only meaningful for image sources. */
  allowDataImage?: boolean;
}

/**
 * Reduces a value to what a URL parser will actually treat as the scheme: the
 * URL standard removes tab and newline characters wherever they appear and
 * ignores leading C0 controls and spaces, so `&#1;javascript:` and
 * `java\tscript:` both reach the parser as `javascript:`.
 */
function toSchemeCheckInput(value: string): string {
  return value.replace(/[\t\n\r]/g, "").replace(/^[\u0000-\u0020\u007f]+/, "").toLowerCase();
}

/**
 * True when the destination is safe to hand to the browser. Relative
 * references, fragments and protocol-relative URLs carry no scheme and are
 * accepted; anything with a scheme must be on the allowlist.
 */
export function isSafeUrl(value: string, options: SafeUrlOptions = {}): boolean {
  const candidate = toSchemeCheckInput(value);
  const match = SCHEME_PATTERN.exec(candidate);
  if (!match) return true;
  const scheme = match[1];
  if (ALLOWED_SCHEMES.has(scheme)) return true;
  if (scheme === "data") return options.allowDataImage === true && DATA_IMAGE_URL.test(candidate);
  return false;
}

/** Returns the value when it is safe to keep, or `null` when the caller must drop it. */
function sanitizeUrlAttribute(value: string, options: SafeUrlOptions = {}): string | null {
  return isSafeUrl(value, options) ? value : null;
}

/**
 * `srcset` holds a comma-separated candidate list, and a candidate may carry a
 * descriptor after the URL. Every candidate has to pass on its own; a single
 * unsafe entry invalidates the attribute because the browser picks the winner.
 * Returns the value to keep, or `null` to drop the attribute — the same contract
 * as `sanitizeUrlAttribute`, so the caller only has one thing to test.
 */
function sanitizeSrcset(value: string, options: SafeUrlOptions): string | null {
  const everyCandidateSafe = value.split(",").every((candidate) => {
    const url = candidate.trim().split(/\s+/)[0] ?? "";
    return url === "" || isSafeUrl(url, options);
  });
  return everyCandidateSafe ? value : null;
}

/**
 * True when the browser renders this attribute's value as an image, which is the
 * only place a `data:image/*` payload is inert. Kept narrow on purpose: `<a href>`
 * is not an image slot even though an SVG `<image href>` is.
 */
function isImageSlot(tag: string, name: string): boolean {
  if (name === "poster") return true; // <video poster>
  if (tag === "image" && name === "href") return true; // SVG <image href>
  return (tag === "img" || tag === "source") && (name === "src" || name === "srcset");
}

/**
 * Attributes that are never kept, whatever their value: `on*` event handlers —
 * matched by prefix on the parsed name, so a `/` separator or a missing quote
 * cannot hide one — plus `srcdoc` and `formtarget`, the two remaining ways to
 * hand a document a destination the URL policy never sees.
 */
function isDroppedAttribute(name: string): boolean {
  return name.startsWith("on") || name === "srcdoc" || name === "formtarget";
}

/**
 * Untrusted markup must not be able to navigate the editor itself: anything that
 * points outside the current fragment is forced to open in a new browsing context
 * with an explicit `rel`, and a fragment-only destination stays same-document and
 * is left alone. This is the policy the Markdown link paths already apply to
 * rendered links, extended to the markup an author writes by hand — and it is why
 * the opener cannot be reached through a form submission either.
 */
function hardenNavigation(element: Element, tag: string): void {
  if (tag !== "form") {
    const href = element.getAttribute("href");
    if (href === null || href.trim().startsWith("#")) return;
  }
  element.setAttribute("target", "_blank");
  const tokens = new Set(
    (element.getAttribute("rel") ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 0)
  );
  const before = tokens.size;
  tokens.add("noopener");
  tokens.add("noreferrer");
  if (tokens.size !== before) element.setAttribute("rel", Array.from(tokens).join(" "));
}

/** Applies the attribute policy to one element: dropped names, then URLs. */
function sanitizeAttributes(element: Element, tag: string): void {
  for (const attribute of Array.from(element.attributes)) {
    const name = (attribute.localName || attribute.name).toLowerCase();
    if (isDroppedAttribute(name)) {
      // `removeAttributeNode` is namespace-agnostic, unlike `removeAttribute`,
      // which would need the exact qualified name and its prefix.
      element.removeAttributeNode(attribute);
      continue;
    }
    if (!URL_ATTRIBUTES.has(name)) continue;
    const options: SafeUrlOptions = { allowDataImage: isImageSlot(tag, name) };
    // Both branches return `string | null`, so a single null check covers them.
    const keep = name === "srcset" ? sanitizeSrcset(attribute.value, options) : sanitizeUrlAttribute(attribute.value, options);
    if (keep === null) element.removeAttributeNode(attribute);
  }
}

/**
 * Walks the parsed tree: forbidden elements are dropped, everything else is
 * sanitised attribute by attribute. Foreign content (SVG, MathML) needs no
 * separate path — it is the same DOM, and walking it is exactly what a
 * source-level filter cannot do.
 */
function sanitizeSubtree(root: Element | DocumentFragment): void {
  for (const node of Array.from(root.childNodes)) {
    // Text and comment nodes carry no executable behaviour.
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    const tag = element.localName.toLowerCase();
    if (FORBIDDEN_ELEMENTS.has(tag)) {
      element.remove();
      continue;
    }
    sanitizeAttributes(element, tag);
    if (tag === "a" || tag === "area" || tag === "form") hardenNavigation(element, tag);
    sanitizeSubtree(element);
  }
}

/**
 * Sanitising runs while decorations are rebuilt, which happens on every edit, so
 * an unchanged block would be re-parsed on each keystroke. The function is pure —
 * the same input always produces the same output — so a bounded cache of recent
 * results removes that repeat cost. Entries are dropped oldest-first once either
 * bound is exceeded, which keeps the retained markup small.
 */
const CACHE_ENTRY_LIMIT = 24;
const CACHE_CHARACTER_LIMIT = 256 * 1024;
const recentResults = new Map<string, string>();
let recentResultCharacters = 0;

function remember(key: string, value: string): string {
  recentResults.set(key, value);
  recentResultCharacters += key.length + value.length;
  while (
    (recentResults.size > CACHE_ENTRY_LIMIT || recentResultCharacters > CACHE_CHARACTER_LIMIT) &&
    recentResults.size > 1
  ) {
    const oldest = recentResults.keys().next();
    if (oldest.done) break;
    recentResultCharacters -= oldest.value.length + (recentResults.get(oldest.value)?.length ?? 0);
    recentResults.delete(oldest.value);
  }
  return value;
}

/**
 * Sanitises an HTML fragment and returns markup that is safe to assign to
 * `innerHTML`. The result keeps the structural and styling vocabulary authors
 * rely on — including `<details>`, inline SVG and `style` attributes — while
 * removing script-bearing elements, event handler attributes and unsafe
 * destinations.
 *
 * Known limitation: `style` attributes are preserved, so a document can still
 * affect its own rendering. Hosts that need a stricter policy can replace this
 * step through `LivePreviewConfig.renderers.html`.
 */
export function sanitizeHtmlFragment(raw: string): string {
  const cached = recentResults.get(raw);
  if (cached !== undefined) return cached;
  const template = document.createElement("template");
  // `template.content` is inert: scripts do not run and images do not load
  // while the tree is inspected, so nothing can fire before it is removed.
  template.innerHTML = raw;
  sanitizeSubtree(template.content);
  const container = document.createElement("div");
  container.appendChild(template.content);
  return remember(raw, container.innerHTML);
}
