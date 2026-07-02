import { describe, expect, it } from "vitest";

import {
  applyScrollRatio,
  attachSyncScroll,
  computeScrollRatio,
} from "../src/sync-scroll";

function mockScrollElement(
  scrollHeight: number,
  clientHeight: number,
  scrollTop = 0
): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });
  let top = scrollTop;
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });
  return el;
}

describe("computeScrollRatio", () => {
  it("returns 0 when content fits without scrolling", () => {
    const el = mockScrollElement(100, 100, 0);
    expect(computeScrollRatio(el)).toBe(0);
  });

  it("returns normalized ratio for partial scroll", () => {
    const el = mockScrollElement(300, 100, 100);
    expect(computeScrollRatio(el)).toBeCloseTo(0.5);
  });

  it("returns 1 at the bottom", () => {
    const el = mockScrollElement(500, 100, 400);
    expect(computeScrollRatio(el)).toBeCloseTo(1);
  });
});

describe("applyScrollRatio", () => {
  it("maps ratio back to scrollTop", () => {
    const el = mockScrollElement(500, 100);
    applyScrollRatio(el, 0.25);
    expect(el.scrollTop).toBeCloseTo(100);
  });

  it("clamps out-of-range ratios", () => {
    const el = mockScrollElement(500, 100);
    applyScrollRatio(el, 1.5);
    expect(el.scrollTop).toBeCloseTo(400);
    applyScrollRatio(el, -0.2);
    expect(el.scrollTop).toBe(0);
  });

  it("round-trips with computeScrollRatio", () => {
    const el = mockScrollElement(800, 200, 150);
    const ratio = computeScrollRatio(el);
    const target = mockScrollElement(1200, 200);
    applyScrollRatio(target, ratio);
    expect(computeScrollRatio(target)).toBeCloseTo(ratio);
  });
});

describe("attachSyncScroll", () => {
  it("mirrors scroll from primary to secondary", () => {
    const primary = mockScrollElement(400, 100, 150);
    const secondary = mockScrollElement(800, 100);
    const handle = attachSyncScroll({ primary, secondary });

    primary.dispatchEvent(new Event("scroll"));
    expect(computeScrollRatio(secondary)).toBeCloseTo(computeScrollRatio(primary));

    handle.destroy();
  });

  it("mirrors scroll from secondary to primary", () => {
    const primary = mockScrollElement(600, 100);
    const secondary = mockScrollElement(900, 100, 300);
    const handle = attachSyncScroll({ primary, secondary });

    secondary.dispatchEvent(new Event("scroll"));
    expect(computeScrollRatio(primary)).toBeCloseTo(computeScrollRatio(secondary));

    handle.destroy();
  });

  it("stops syncing after destroy", () => {
    const primary = mockScrollElement(400, 100, 200);
    const secondary = mockScrollElement(800, 100);
    const handle = attachSyncScroll({ primary, secondary });

    handle.destroy();
    primary.dispatchEvent(new Event("scroll"));
    expect(secondary.scrollTop).toBe(0);
  });
});
