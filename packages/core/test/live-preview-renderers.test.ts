import type { Link } from "mdast";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDefaultRenderer } from "../src/live-preview-renderers";

function renderLink(url = "https://example.com/guide"): HTMLAnchorElement {
  const node: Link = { type: "link", url, children: [{ type: "text", value: "Guide" }] };
  return createDefaultRenderer({
    node,
    nodeType: "link",
    source: `[Guide](${url})`,
    text: "Guide",
    from: 0,
    to: url.length + 9
  }) as HTMLAnchorElement;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("default live-preview link renderer", () => {
  it("keeps an unmodified click inside the editor", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });

    const dispatched = renderLink().dispatchEvent(event);

    expect(dispatched).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    ["Control", { ctrlKey: true }],
    ["Meta", { metaKey: true }]
  ] as const)("opens the link on %s-click without navigating the editor", (_name, modifier) => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ...modifier
    });

    const dispatched = renderLink().dispatchEvent(event);

    expect(dispatched).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(
      "https://example.com/guide",
      "_blank",
      "noopener,noreferrer"
    );
  });
});
