import { describe, expect, it } from "vitest";

import { isSafeUrl, sanitizeHtmlFragment } from "../src/sanitize-html";

function parseFragment(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

/**
 * Behaviour-bearing attributes the browser built from the markup. Sanitised
 * output must produce none; the same helper is used on the raw payload first so
 * every case proves it was a working vector before the fix removed it.
 */
function handlerNames(html: string): string[] {
  const names: string[] = [];
  for (const element of Array.from(parseFragment(html).querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = (attribute.localName || attribute.name).toLowerCase();
      if (name.startsWith("on") || name === "srcdoc") names.push(`${element.localName}.${name}`);
    }
  }
  return names;
}

/** The scheme the browser resolves the fragment's first anchor to. */
function resolvedScheme(html: string): string | null {
  const href = parseFragment(html).querySelector("a")?.getAttribute("href");
  if (href === null || href === undefined) return null;
  try {
    return new URL(href, "https://editor.example/").protocol;
  } catch {
    return null;
  }
}

/** Attribute local names whose value the browser treats as a URL. */
const URL_ATTRIBUTE_LOCALS = new Set([
  "href",
  "src",
  "srcset",
  "poster",
  "action",
  "formaction",
  "background",
  "cite",
]);

/**
 * URLs the browser itself resolves to a script scheme, found by walking every
 * URL-bearing attribute in the fragment. `new URL` is deliberately used as an
 * independent oracle: it re-implements none of the module's own logic, so a
 * passing assertion means the browser agrees the destination is inert.
 */
function scriptResolvedUrls(html: string): string[] {
  const found: string[] = [];
  for (const element of Array.from(parseFragment(html).querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      // Matched on the local name so `xlink:href` on SVG elements is inspected too.
      const local = (attribute.localName || attribute.name).toLowerCase();
      if (!URL_ATTRIBUTE_LOCALS.has(local)) continue;
      const candidates = local === "srcset" ? attribute.value.split(",") : [attribute.value];
      for (const candidate of candidates) {
        const token = candidate.trim().split(/\s+/)[0] ?? "";
        if (token === "") continue;
        try {
          const protocol = new URL(token, "https://editor.example/").protocol;
          if (protocol === "javascript:" || protocol === "vbscript:") {
            found.push(`${element.localName}[${attribute.name}]=${protocol}`);
          }
        } catch {
          // A value the URL parser rejects cannot be navigated to either.
        }
      }
    }
  }
  return found;
}

describe("sanitizeHtmlFragment", () => {
  describe("attribute forms a source filter cannot see", () => {
    // The URL standard ignores leading control characters and spaces, strips tab
    // and newline, and resolves character references before the scheme is read.
    const SCRIPT_DESTINATIONS = [
      "<a href=javascript:alert(1)>x</a>",
      '<a href="java&#115;cript:alert(1)">x</a>',
      '<a href="java&#x73;cript:alert(1)">x</a>',
      '<a href="javascript&colon;alert(1)">x</a>',
      '<a href="&#1;javascript:alert(1)">x</a>',
      '<a href="\tjavascript:alert(1)">x</a>',
      '<a href="\njavascript:alert(1)">x</a>',
      '<a href=" javascript:alert(1)">x</a>',
      '<a href="JaVaScRiPt:alert(1)">x</a>',
      '<a href="vbscript:msgbox(1)">x</a>',
    ];

    it("is a working vector before sanitising", () => {
      for (const payload of SCRIPT_DESTINATIONS) {
        expect(["javascript:", "vbscript:"], payload).toContain(resolvedScheme(payload));
      }
    });

    it("removes the destination instead of rewriting it", () => {
      for (const payload of SCRIPT_DESTINATIONS) {
        const result = sanitizeHtmlFragment(payload);
        expect(resolvedScheme(result), payload).toBeNull();
        expect(parseFragment(result).querySelector("a")?.hasAttribute("href"), payload).toBe(false);
      }
    });

    // `/` is a valid attribute separator, so a handler does not need whitespace
    // in front of it — the form every whitespace-anchored pattern misses. It is
    // only reachable where the preceding attribute does not end in an unquoted
    // value, which would swallow the `/` as part of that value.
    const SEPARATOR_HANDLERS = [
      "<svg/onload=alert(1)>",
      '<img src="x"/onerror=alert(1)>',
      "<input/autofocus/onfocus=alert(1)>",
    ];

    it("is a working vector before sanitising", () => {
      for (const payload of SEPARATOR_HANDLERS) {
        expect(handlerNames(payload).length, payload).toBeGreaterThan(0);
      }
    });

    it("removes handlers separated by / instead of whitespace", () => {
      for (const payload of SEPARATOR_HANDLERS) {
        expect(handlerNames(sanitizeHtmlFragment(payload)), payload).toEqual([]);
      }
    });

    it("removes handlers written with any casing or quoting", () => {
      for (const payload of [
        '<img src="x" ONERROR="alert(1)">',
        "<img src=x OnErRoR=alert(1)>",
        "<details open ontoggle='alert(1)'>x</details>",
        '<div onmouseover = "alert(1)">x</div>',
      ]) {
        expect(handlerNames(sanitizeHtmlFragment(payload)), payload).toEqual([]);
      }
    });
  });

  describe("foreign content", () => {
    const FOREIGN_DESTINATIONS = [
      '<svg><a xlink:href="javascript:alert(1)">c</a></svg>',
      "<svg><a xlink:href=javascript:alert(1)>c</a></svg>",
      '<math><a href="javascript:alert(1)">c</a></math>',
    ];

    it("is a working vector before sanitising", () => {
      for (const payload of FOREIGN_DESTINATIONS) {
        const anchor = parseFragment(payload).querySelector("a");
        expect(anchor?.getAttribute("xlink:href") ?? anchor?.getAttribute("href"), payload).toContain("javascript:");
      }
    });

    it("removes destinations inside SVG and MathML", () => {
      for (const payload of FOREIGN_DESTINATIONS) {
        const anchor = parseFragment(sanitizeHtmlFragment(payload)).querySelector("a");
        expect(anchor?.getAttribute("xlink:href"), payload).toBeNull();
        expect(anchor?.getAttribute("href"), payload).toBeNull();
      }
    });

    it("removes animation elements, nested handlers and scripts inside SVG", () => {
      for (const payload of [
        "<svg><animate onbegin=alert(1) attributeName=x dur=1s>",
        "<svg><set onbegin=alert(1) attributeName=x to=1>",
        "<svg><script>alert(1)</script></svg>",
        "<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>",
      ]) {
        const result = sanitizeHtmlFragment(payload);
        expect(handlerNames(result), payload).toEqual([]);
        expect(parseFragment(result).querySelector("script"), payload).toBeNull();
      }
    });
  });

  describe("elements that rewrite attributes at runtime", () => {
    it("drops animation elements instead of trying to screen their values", () => {
      // `attributeName` and `to` are values, and the target attribute can be
      // anything — including `href` or an event handler — so there is no value to
      // screen. Measured in Chromium: `<set attributeName="href" to="javascript:…">`
      // put the script URL into the anchor's *animated* href, the value the browser
      // navigates with, and a real click executed it. jsdom runs no SMIL, so the
      // working-vector half of that evidence lives in the browser probe; this
      // asserts the elements and their values are gone.
      for (const payload of [
        '<svg><a href="#"><set attributeName="href" to="javascript:alert(1)"></set>x</a></svg>',
        '<svg><a href="#"><animate attributeName="href" values="javascript:alert(1)" dur="1s" fill="freeze"></animate>x</a></svg>',
        '<svg><a href="#"><animate attributeName="href" to="javascript:alert(1)"></animate>x</a></svg>',
        '<svg><a href="#"><animateMotion dur="1s"></animateMotion>x</a></svg>',
        '<svg><a href="#"><animateTransform attributeName="transform" dur="1s"></animateTransform>x</a></svg>',
        '<svg><a href="#"><animateColor attributeName="fill" dur="1s"></animateColor>x</a></svg>',
        '<svg><a href="#"><discard begin="1s"></discard>x</a></svg>',
        '<svg><a href="#"><SET attributeName="onclick" to="alert(1)"></SET>x</a></svg>',
      ]) {
        const result = sanitizeHtmlFragment(payload);
        const host = parseFragment(result);
        for (const tag of ["set", "animate", "animatemotion", "animatetransform", "animatecolor", "discard"]) {
          expect(host.querySelector(tag), `${payload} -> ${tag}`).toBeNull();
        }
        expect(result.toLowerCase()).not.toContain("javascript:");
        // The anchor itself is kept, so the note still renders.
        expect(host.querySelector("a")).not.toBeNull();
      }
    });
  });

  describe("elements that carry executable or document-wide behaviour", () => {
    it("removes them together with their subtree", () => {
      for (const payload of [
        "<script>alert(1)</script>",
        '<script src="https://evil.example/x.js"></script>',
        "<SCRIPT>alert(1)</SCRIPT>",
        "<div>before<style>body{display:none}</style>after</div>",
        '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
        '<iframe src="https://evil.example/"></iframe>',
        '<object data="https://evil.example/x.swf"></object>',
        '<embed src="https://evil.example/x.svg">',
        '<base href="https://evil.example/">',
        '<meta http-equiv="refresh" content="0;url=https://evil.example/">',
        '<link rel="stylesheet" href="https://evil.example/x.css">',
      ]) {
        const host = parseFragment(sanitizeHtmlFragment(payload));
        for (const tag of ["script", "style", "iframe", "object", "embed", "base", "meta", "link"]) {
          expect(host.querySelector(tag), `${payload} -> ${tag}`).toBeNull();
        }
      }
    });

    it("keeps the surrounding content when a forbidden element is removed", () => {
      const result = sanitizeHtmlFragment("<p>keep<script>alert(1)</script> this</p>");
      expect(parseFragment(result).textContent).toBe("keep this");
    });
  });

  describe("the authoring vocabulary stays available", () => {
    it("keeps inline tags, details, styling and inline SVG", () => {
      const host = parseFragment(
        sanitizeHtmlFragment(
          "<kbd>Ctrl</kbd> + <kbd>C</kbd> <mark>hi</mark> X<sub>1</sub> X<sup>2</sup><br>" +
            "<details open><summary>title</summary>body</details>" +
            '<div style="color:red" data-note="kept">red</div>' +
            '<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="15"/></svg>'
        )
      );
      expect(host.querySelectorAll("kbd").length).toBe(2);
      expect(host.querySelector("mark")?.textContent).toBe("hi");
      expect(host.querySelector("sub")?.textContent).toBe("1");
      expect(host.querySelector("sup")?.textContent).toBe("2");
      expect(host.querySelector("br")).not.toBeNull();
      expect(host.querySelector("details")?.hasAttribute("open")).toBe(true);
      expect(host.querySelector("summary")?.textContent).toBe("title");
      expect(host.querySelector("div")?.getAttribute("style")).toBe("color:red");
      expect(host.querySelector("div")?.getAttribute("data-note")).toBe("kept");
      expect(host.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 40 40");
      expect(host.querySelector("circle")).not.toBeNull();
    });

    it("keeps comments and destinations that carry no scheme", () => {
      const result = sanitizeHtmlFragment(
        '<!-- note --><a href="./doc.md#sec">d</a><a href="/abs">a</a><a href="#frag">f</a><a href="https://example.com">e</a>'
      );
      expect(result).toContain("<!-- note -->");
      const hrefs = Array.from(parseFragment(result).querySelectorAll("a")).map((a) => a.getAttribute("href"));
      expect(hrefs).toEqual(["./doc.md#sec", "/abs", "#frag", "https://example.com"]);
    });
  });

  describe("anchors that open a new browsing context", () => {
    it("gains an explicit rel", () => {
      const rel = parseFragment(
        sanitizeHtmlFragment('<a href="https://example.com" target="_blank">x</a>')
      )
        .querySelector("a")
        ?.getAttribute("rel");
      expect(rel?.split(/\s+/)).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
    });

    it("covers area, the other anchor-like element", () => {
      const area = parseFragment(
        sanitizeHtmlFragment('<map name="m"><area href="https://example.com" target="_blank"></map>')
      ).querySelector("area");
      expect(area?.getAttribute("rel")?.split(/\s+/)).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
    });

    it("keeps the tokens the author already set", () => {
      const rel = parseFragment(
        sanitizeHtmlFragment('<a href="https://example.com" target="_blank" rel="external">x</a>')
      )
        .querySelector("a")
        ?.getAttribute("rel");
      expect(rel?.split(/\s+/)).toEqual(expect.arrayContaining(["external", "noopener", "noreferrer"]));
    });

    it("leaves a same-document destination alone", () => {
      const anchor = parseFragment(sanitizeHtmlFragment('<a href="#section">x</a>')).querySelector("a");
      expect(anchor?.hasAttribute("target")).toBe(false);
      expect(anchor?.hasAttribute("rel")).toBe(false);
    });

    it("forces a new browsing context for anything outside the fragment", () => {
      // Otherwise a note could navigate the whole editor away, or reach the host
      // through the opener. The Markdown link paths already do this; raw HTML now
      // matches them.
      const anchor = parseFragment(sanitizeHtmlFragment('<a href="https://example.com">x</a>')).querySelector("a");
      expect(anchor?.getAttribute("target")).toBe("_blank");
      expect(anchor?.getAttribute("rel")?.split(/\s+/)).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
    });

    it("hardens a form submission and drops the per-control override", () => {
      const form = parseFragment(
        sanitizeHtmlFragment('<form action="https://example.com"><button formtarget="_self">go</button></form>')
      ).querySelector("form");
      expect(form?.getAttribute("target")).toBe("_blank");
      expect(form?.getAttribute("rel")?.split(/\s+/)).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
      expect(form?.querySelector("button")?.hasAttribute("formtarget")).toBe(false);
    });
  });

  describe("data: destinations", () => {
    it("keeps image payloads on image sources", () => {
      const src = parseFragment(
        sanitizeHtmlFragment('<img src="data:image/png;base64,iVBORw0KGgo=" alt="x">')
      )
        .querySelector("img")
        ?.getAttribute("src");
      expect(src).toBe("data:image/png;base64,iVBORw0KGgo=");
    });

    it("covers every attribute the browser renders as an image", () => {
      for (const payload of [
        '<img src="data:image/png;base64,AAA">',
        '<img srcset="data:image/png;base64,AAA 1x">',
        '<source src="data:image/png;base64,AAA">',
        '<video poster="data:image/png;base64,AAA"></video>',
        '<svg><image href="data:image/png;base64,AAA"></image></svg>',
      ]) {
        expect(sanitizeHtmlFragment(payload), payload).toContain("data:image/png");
      }
      for (const payload of [
        '<a href="data:image/png;base64,AAA">x</a>',
        '<video src="data:image/png;base64,AAA"></video>',
        '<iframe src="data:image/png;base64,AAA"></iframe>',
      ]) {
        expect(sanitizeHtmlFragment(payload), payload).not.toContain("data:");
      }
    });

    it("refuses a document payload", () => {
      const result = sanitizeHtmlFragment('<a href="data:text/html,<script>alert(1)</script>">x</a>');
      expect(parseFragment(result).querySelector("a")?.hasAttribute("href")).toBe(false);
    });
  });

describe("URL-bearing attributes beyond href and src", () => {
  const DESTINATIONS = [
    '<button formaction="javascript:alert(1)">go</button>',
    '<form action="javascript:alert(1)"><input type="submit"></form>',
    '<video poster="javascript:alert(1)"></video>',
    '<table background="javascript:alert(1)"><tr><td>x</td></tr></table>',
    '<blockquote cite="javascript:alert(1)">q</blockquote>',
    '<img srcset="javascript:alert(1)">',
    '<img srcset="a.png 1x, javascript:alert(1) 2x">',
    '<source srcset="javascript:alert(1)">',
    '<svg><use xlink:href="javascript:alert(1)"></use></svg>',
    '<svg><image href="javascript:alert(1)"></image></svg>',
    '<svg><a XLINK:HREF="javascript:alert(1)">c</a></svg>',
  ];

  it("is a working vector before sanitising", () => {
    for (const payload of DESTINATIONS) {
      expect(scriptResolvedUrls(payload), payload).not.toEqual([]);
    }
  });

  it("leaves no destination the browser resolves to a script scheme", () => {
    for (const payload of DESTINATIONS) {
      const result = sanitizeHtmlFragment(payload);
      expect(scriptResolvedUrls(result), `${payload} -> ${result}`).toEqual([]);
    }
  });

  it("keeps candidates that carry no scheme while dropping the script entry", () => {
    const result = sanitizeHtmlFragment('<img srcset="a.png 1x, javascript:alert(1) 2x">');
    expect(parseFragment(result).querySelector("img")?.hasAttribute("srcset")).toBe(false);
  });

  it("keeps a data: image in srcset", () => {
    const srcset = parseFragment(
      sanitizeHtmlFragment('<img srcset="data:image/png;base64,iVBORw0KGgo= 1x">')
    )
      .querySelector("img")
      ?.getAttribute("srcset");
    expect(srcset).toContain("data:image/png");
  });

  it("leaves non-URL data-* attributes alone", () => {
    const element = parseFragment(sanitizeHtmlFragment('<div data-note="javascript:alert(1)">x</div>')).querySelector("div");
    expect(element?.getAttribute("data-note")).toBe("javascript:alert(1)");
  });

  it("removes srcdoc as defence in depth", () => {
    const element = parseFragment(sanitizeHtmlFragment('<div srcdoc="<script>alert(1)</script>">x</div>')).querySelector("div");
    expect(element?.hasAttribute("srcdoc")).toBe(false);
  });
});

describe("compound obfuscation", () => {
  // The decisive difference from a source-level filter: character references are
  // decoded first, and only then does the URL parser strip the control
  // characters it ignores. A pattern that reads the raw text sees neither step.
  const COMPOUND = [
    '<a href="jav&#x0A;ascript:alert(1)">x</a>', // entity -> LF, removed anywhere by the URL parser
    '<a href="jav&#x09;ascript:alert(1)">x</a>', // entity -> TAB
    '<a href="jav&#x0D;ascript:alert(1)">x</a>', // entity -> CR
    '<a href="&#x6A;&#x61;vascript:alert(1)">x</a>', // whole scheme spelled with entities
    '<a href="&#14;javascript:alert(1)">x</a>', // decoded to a C0 control, ignored when leading
  ];

  it("is a working vector before sanitising", () => {
    for (const payload of COMPOUND) {
      expect(resolvedScheme(payload), payload).toBe("javascript:");
    }
  });

  it("removes the destination after decoding", () => {
    for (const payload of COMPOUND) {
      const result = sanitizeHtmlFragment(payload);
      expect(resolvedScheme(result), `${payload} -> ${result}`).toBeNull();
    }
  });

  it("treats a NUL before the scheme as inert, the way the browser does", () => {
    // Not a vector: the HTML parser turns NUL inside an attribute value into
    // U+FFFD, which is not a control character, so the URL parser no longer sees
    // a scheme at all and resolves the value as a relative reference. Keeping the
    // attribute is therefore harmless — asserting it away would be over-blocking.
    const payload = '<a href="&#x0;&#x9;javascript:alert(1)">x</a>';
    expect(resolvedScheme(payload)).toBe("https:");
    expect(scriptResolvedUrls(sanitizeHtmlFragment(payload))).toEqual([]);
  });

  it("does not let an interior control character forge a scheme", () => {
    // Mid-string controls survive the URL parser, so the value stays a relative
    // reference. Keeping it is correct; what matters is that the browser does not
    // read it as javascript:. Either outcome is acceptable, since both are inert.
    const result = sanitizeHtmlFragment('<a href="java&#x01;script:alert(1)">x</a>');
    expect(scriptResolvedUrls(result)).toEqual([]);
  });
});

describe("destinations that must keep working", () => {
  it("keeps the schemes a document may use and the schemeless forms", () => {
    for (const url of [
      "https://example.com/a?b=c",
      "http://example.com",
      "mailto:someone@example.com",
      "tel:+1234",
      "./relative.md",
      "../up.md",
      "/rooted/path",
      "#section",
      "//example.com/protocol-relative",
    ]) {
      const anchor = parseFragment(sanitizeHtmlFragment(`<a href="${url}">x</a>`)).querySelector("a");
      expect(anchor?.getAttribute("href"), url).toBe(url);
    }
  });
});

  it("returns markup that is stable under a second pass", () => {
    const once = sanitizeHtmlFragment('<div style="color:red"><svg/onload=alert(1)><a href=javascript:alert(1)>x</a></div>');
    expect(sanitizeHtmlFragment(once)).toBe(once);
  });

  it("returns the result for the exact input it was given", () => {
    // A bounded cache of recent results sits in front of the parse, because this
    // runs on every decoration rebuild. This guards the keying: an entry must
    // never be served for a different input.
    const first = sanitizeHtmlFragment('<a href=javascript:alert(1)>one</a>');
    const second = sanitizeHtmlFragment('<a href="https://example.com/two">two</a>');
    const firstAgain = sanitizeHtmlFragment('<a href=javascript:alert(1)>one</a>');
    expect(firstAgain).toBe(first);
    expect(second).not.toBe(first);
    expect(second).toContain("https://example.com/two");
    expect(first).not.toContain("javascript:");
  });
});

describe("classes a source-level filter is known to miss", () => {
  // Drawn from the OWASP XSS Filter Evasion cheat sheet, restricted to the ones
  // that are not already covered above. Each is included only because the
  // parser-normalises-then-check design should be immune; the guards prove the
  // payload is real before the removal is asserted.

  it("decodes numeric references that have no trailing semicolon", () => {
    const payloads = [
      '<a href="&#0000106&#0000097&#0000118&#0000097&#0000115&#0000099&#0000114&#0000105&#0000112&#0000116&#0000058&#0000097&#0000108&#0000101&#0000114&#0000116">x</a>',
      '<a href="&#x6A&#x61&#x76&#x61&#x73&#x63&#x72&#x69&#x70&#x74&#x3A&#x61&#x6C&#x65&#x72&#x74">x</a>',
    ];
    for (const payload of payloads) {
      expect(resolvedScheme(payload), payload).toBe("javascript:");
      expect(resolvedScheme(sanitizeHtmlFragment(payload)), payload).toBeNull();
    }
  });

  it("decodes an entity-encoded colon in every URL-bearing attribute", () => {
    const payloads = [
      '<button formaction="javascript&colon;alert(1)">go</button>',
      '<form action="javascript&colon;alert(1)"></form>',
      '<video poster="javascript&colon;alert(1)"></video>',
    ];
    for (const payload of payloads) {
      expect(scriptResolvedUrls(payload), payload).not.toEqual([]);
      expect(scriptResolvedUrls(sanitizeHtmlFragment(payload)), payload).toEqual([]);
    }
  });

  it("validates src on form controls too", () => {
    const payload = '<input type="image" src="javascript:alert(1)">';
    expect(scriptResolvedUrls(payload)).not.toEqual([]);
    expect(scriptResolvedUrls(sanitizeHtmlFragment(payload))).toEqual([]);
  });

  it("removes handlers inside the MathML HTML integration point", () => {
    // `annotation-xml` with an HTML encoding is an integration point: its children
    // are real HTML elements, so the same walk has to reach them.
    for (const payload of [
      '<math><annotation-xml encoding="text/html"><img src=x onerror=alert(1)></annotation-xml></math>',
      '<math><annotation-xml encoding="text/html"><a href="javascript:alert(1)">x</a></annotation-xml></math>',
    ]) {
      const result = sanitizeHtmlFragment(payload);
      expect(handlerNames(result), payload).toEqual([]);
      expect(scriptResolvedUrls(result), payload).toEqual([]);
    }
  });

  it("leaves raw-text elements as text rather than live markup", () => {
    for (const payload of [
      "<xmp><img src=x onerror=alert(1)></xmp>",
      "<plaintext><img src=x onerror=alert(1)>",
      "<noembed><img src=x onerror=alert(1)></noembed>",
    ]) {
      expect(handlerNames(sanitizeHtmlFragment(payload)), payload).toEqual([]);
    }
  });

  it("catches a literal tab in the middle of a scheme", () => {
    const payload = '<a href="java\tscript:alert(1)">x</a>';
    expect(resolvedScheme(payload), payload).toBe("javascript:");
    const result = sanitizeHtmlFragment(payload);
    expect(resolvedScheme(result)).toBeNull();
    expect(scriptResolvedUrls(result)).toEqual([]);
  });

  it("removes an attribute that merely starts with on, not only real handlers", () => {
    // Prefix matching is what makes the engine-specific "junk between the
    // handler name and =" tricks moot. The cost is that an invented attribute
    // like `one` is dropped as well; the spec has no non-handler on* attribute,
    // so that trade is deliberate.
    const host = parseFragment(sanitizeHtmlFragment('<img src=x onnotahandler=1 one=2 only=3>'));
    const img = host.querySelector("img");
    expect(img?.hasAttribute("onnotahandler")).toBe(false);
    expect(img?.hasAttribute("one")).toBe(false);
    expect(img?.hasAttribute("only")).toBe(false);
    expect(img?.getAttribute("src")).toBe("x");
  });
});

describe("isSafeUrl", () => {
  it("accepts destinations that carry no scheme", () => {
    for (const url of ["./notes/a.md", "../a.md", "/root", "#frag", "notes/a.md?x=1", "//example.com/a", ""]) {
      expect(isSafeUrl(url), JSON.stringify(url)).toBe(true);
    }
  });

  it("accepts the navigation schemes a document may use", () => {
    for (const url of ["https://example.com", "http://example.com/a?b=c", "HTTPS://EXAMPLE.COM", "mailto:a@b.c", "tel:+1234"]) {
      expect(isSafeUrl(url), url).toBe(true);
    }
  });

  it("refuses script and local-file schemes", () => {
    for (const url of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "vbscript:msgbox(1)",
      "file:///C:/Windows/System32/drivers/etc/hosts",
      "data:text/html,<script>alert(1)</script>",
    ]) {
      expect(isSafeUrl(url), url).toBe(false);
    }
  });

  it("sees through the normalisation a URL parser performs", () => {
    for (const url of [
      "\tjavascript:alert(1)",
      "\njavascript:alert(1)",
      " javascript:alert(1)",
      "\u0001javascript:alert(1)",
      "java\tscript:alert(1)",
      "JAVA\nSCRIPT:alert(1)",
    ]) {
      expect(isSafeUrl(url), JSON.stringify(url)).toBe(false);
    }
  });

  it("allows a data: image payload only when the caller opts in", () => {
    expect(isSafeUrl("data:image/png;base64,AAA", { allowDataImage: true })).toBe(true);
    expect(isSafeUrl("data:image/svg+xml,<svg/>", { allowDataImage: true })).toBe(true);
    expect(isSafeUrl("data:image/png;base64,AAA")).toBe(false);
    expect(isSafeUrl("data:text/html,<script>alert(1)</script>", { allowDataImage: true })).toBe(false);
  });
});
