/**
 * True when the HTML block is purely an HTML comment (`<!-- ... -->`), possibly
 * with surrounding whitespace. Such blocks have no rendered output when parsed
 * as HTML, so preview surfaces can choose to render them as visible source.
 */
export function isHtmlComment(raw: string): boolean {
  return /^\s*<!--[\s\S]*-->\s*$/.test(raw);
}

const SAFE_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const URL_ATTRIBUTES = new Set(["href", "src", "xlink:href", "action", "formaction", "poster"]);
const UNSAFE_SELECTOR = "script,iframe,object,embed,style";

export function sanitizeUrl(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "#";

  if (trimmed.startsWith("#") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return trimmed;
  }

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }

  if (!/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) && !trimmed.startsWith("//")) {
    return trimmed;
  }

  try {
    const base = globalThis.location?.href ?? "https://example.invalid/";
    const parsed = new URL(trimmed, base);
    return SAFE_URL_PROTOCOLS.has(parsed.protocol) ? trimmed : "#";
  } catch {
    return "#";
  }
}

function fallbackSanitizeHtml(rawHtml: string): string {
  let html = rawHtml;
  html = html.replace(/<\s*(script|iframe|object|embed|style)\b[\s\S]*?<\/\s*\1\s*>/gi, "");
  html = html.replace(/<\s*(script|iframe|object|embed|style)\b[^>]*\/?>/gi, "");
  html = html.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  html = html.replace(
    /\s+(href|src|xlink:href|action|formaction|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (_match, attr: string, quotedDouble: string, quotedSingle: string, bare: string) =>
      ` ${attr}="${sanitizeUrl(quotedDouble ?? quotedSingle ?? bare)}"`
  );
  html = html.replace(/\s+srcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  return html;
}

// Tags that an embedded HTML block can safely render via innerHTML. We parse
// the block into an inert template, drop dangerous elements, remove event
// attributes, and rewrite URL-bearing attributes through a conservative
// protocol allowlist.
export function defaultSanitizeHtml(rawHtml: string): string {
  if (typeof document === "undefined") return fallbackSanitizeHtml(rawHtml);

  const template = document.createElement("template");
  template.innerHTML = rawHtml;

  for (const unsafe of Array.from(template.content.querySelectorAll(UNSAFE_SELECTOR))) {
    unsafe.remove();
  }

  for (const element of Array.from(template.content.querySelectorAll("*"))) {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "srcset") {
        element.removeAttribute(attr.name);
        continue;
      }

      if (URL_ATTRIBUTES.has(name)) {
        const sanitized = sanitizeUrl(attr.value);
        if (sanitized === "#") {
          element.setAttribute(attr.name, "#");
        } else {
          element.setAttribute(attr.name, sanitized);
        }
      }
    }
  }

  return template.innerHTML;
}
