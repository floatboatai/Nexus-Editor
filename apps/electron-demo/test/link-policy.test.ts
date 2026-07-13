import { describe, expect, it } from "vitest";

import { externalTarget, isSamePageReload } from "../electron/link-policy";

describe("link policy", () => {
  it("routes web and mail links to the system browser", () => {
    expect(externalTarget("https://example.com")).toBe("https://example.com");
    expect(externalTarget("http://example.com/a?b=c")).toBe("http://example.com/a?b=c");
    expect(externalTarget("HTTPS://EXAMPLE.COM")).toBe("HTTPS://EXAMPLE.COM");
    expect(externalTarget("mailto:a@example.com")).toBe("mailto:a@example.com");
  });

  it("denies everything that is not a web or mail link", () => {
    expect(externalTarget("file:///C:/Windows/system32")).toBeNull();
    expect(externalTarget("javascript:alert(1)")).toBeNull();
    expect(externalTarget("app://internal")).toBeNull();
    expect(externalTarget("")).toBeNull();
    // Not a scheme at all — a relative path must not leave the app either.
    expect(externalTarget("relative/path.md")).toBeNull();
  });

  it("allows only same-page reloads to navigate in place", () => {
    expect(isSamePageReload("http://localhost:5173/", "http://localhost:5173/")).toBe(true);
    expect(isSamePageReload("http://localhost:5173/other", "http://localhost:5173/")).toBe(false);
    expect(isSamePageReload("https://example.com", "file:///app/index.html")).toBe(false);
  });
});
