// Installs a jsdom-backed DOM into the Node globals so the real editor can be
// mounted headless. This module MUST be imported *before* any core module,
// because core (and mermaid) touch `window` / `document` at import time.
//
// ESM guarantees a module's side effects run before the next import statement
// in the entry, so `import "./setup-dom"` placed first is sufficient.

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});

const g = globalThis as unknown as Record<string, unknown>;
const win = dom.window as unknown as Record<string, unknown>;

// Some globals (e.g. `navigator` on Node >= 21) are defined as getter-only on
// globalThis, so a plain assignment throws. Assign defensively.
function setGlobal(key: string, value: unknown): void {
  try {
    g[key] = value;
  } catch {
    try {
      Object.defineProperty(g, key, { value, configurable: true, writable: true });
    } catch {
      // Leave the platform-provided global in place; jsdom's window still has it.
    }
  }
}

for (const key of [
  "window",
  "document",
  "navigator",
  "location",
  "getComputedStyle",
  "getSelection",
] as const) {
  setGlobal(key, win[key]);
}

// Copy every DOM constructor / global jsdom exposes that Node lacks
// (Element, HTMLElement, MutationObserver, Range, KeyboardEvent, …). Node
// runtime globals are protected by a blocklist so we don't clobber console,
// timers, Buffer, etc.
const PROTECTED = new Set<string>([
  "console",
  "process",
  "global",
  "globalThis",
  "require",
  "module",
  "exports",
  "Buffer",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "queueMicrotask",
  "fetch",
  "URL",
  "URLSearchParams",
  "TextEncoder",
  "TextDecoder",
  "performance",
]);
for (const key of Object.getOwnPropertyNames(win)) {
  if (PROTECTED.has(key)) continue;
  if (key in g) continue;
  setGlobal(key, win[key]);
}

// jsdom lacks layout — CodeMirror's measure cycle calls these. Stub with empty
// geometry (same approach as the repo's vitest.setup.ts).
const RangeProto = (win.Range as unknown as { prototype: Record<string, unknown> }).prototype;
if (!RangeProto.getClientRects) {
  RangeProto.getClientRects = function getClientRects() {
    const list = [] as unknown as { item: (i: number) => unknown };
    list.item = () => null;
    return list;
  };
}
if (!RangeProto.getBoundingClientRect) {
  RangeProto.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
}

// Animation-frame + observer polyfills some widgets reference.
if (typeof g.requestAnimationFrame !== "function") {
  g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
  g.cancelAnimationFrame = (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}
if (typeof (win as { matchMedia?: unknown }).matchMedia !== "function") {
  win.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  g.matchMedia = win.matchMedia;
}
if (typeof g.ResizeObserver !== "function") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  g.ResizeObserver = ResizeObserverStub;
  win.ResizeObserver = ResizeObserverStub;
}
