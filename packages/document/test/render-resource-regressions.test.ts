import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDocument } from "../src/render";
import { exportHtml } from "../src/export-html";
import type { DocumentRenderHandle } from "../src/types";

const handles: DocumentRenderHandle[] = [];
afterEach(async () => {
  await Promise.allSettled(handles.splice(0).map((handle) => handle.dispose()));
  document.body.replaceChildren();
});

describe("render resource and cleanup regressions", () => {
  it("resolves a DOM extension's inert image through the authorized provider", async () => {
    const read = vi.fn(async () => ({ bytes: new Uint8Array([1, 2]), mimeType: "image/png" }));
    const result = await exportHtml("body", {
      document, strictAssets: true, assetProvider: { read },
      extensions: [{ render(element, context) {
        expect(context.document).toBe(document);
        const image = context.document.createElement("img");
        image.setAttribute("data-resource-src", "local.png");
        element.append(image);
      } }],
    });
    expect(read).toHaveBeenCalledWith("local.png", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(result.html).toContain('src="data:image/png;base64,AQI="');
    expect(result.html).not.toContain("data-resource-src");
    expect(result.diagnostics).toHaveLength(0);
  });

  it("removes a callback's active src before awaiting authorization and diagnoses the unsafe convention", async () => {
    let image: HTMLImageElement | undefined;
    const result = await exportHtml("body", {
      document, strictAssets: true,
      assetProvider: { read: async () => {
        expect(image?.hasAttribute("src")).toBe(false);
        expect(image?.hasAttribute("srcset")).toBe(false);
        return { bytes: new Uint8Array([1]), mimeType: "image/png" };
      } },
      extensions: [{ render(element, context) {
        image = context.document.createElement("img");
        image.src = "local.png";
        image.srcset = "other.png 2x";
        element.append(image);
      } }],
    });
    expect(result.html).toContain("data:image/png;base64,AQ==");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "unsafe-content" }));
  });

  it("rejects unauthorized post-render network images in strict mode", async () => {
    const read = vi.fn(async () => null);
    await expect(exportHtml("body", { document, strictAssets: true, assetProvider: { read }, extensions: [{ render(element) {
      const image = document.createElement("img");
      image.setAttribute("data-resource-src", "https://example.invalid/image.png");
      element.append(image);
    } }] })).rejects.toThrow("unavailable");
    expect(read).not.toHaveBeenCalled();
  });

  it("shares a total resource budget across Markdown, DOM-added images and stylesheet fonts", async () => {
    const options = {
      document,
      styles: ['@font-face{font-family:a;src:url("a.woff2")}'],
      assetProvider: { read: async (source: string) => ({ bytes: new Uint8Array([1, 2]), mimeType: source.endsWith("woff2") ? "font/woff2" : "image/png" }) },
      extensions: [{ render(element: HTMLElement) { const image = document.createElement("img"); image.setAttribute("data-resource-src", "second.png"); element.append(image); } }],
    };
    await expect(exportHtml("![first](first.png)", { ...options, limits: { maxAssetBytes: 2, maxTotalAssetBytes: 5 } })).rejects.toThrow("total asset budget");
    const result = await exportHtml("![first](first.png)", { ...options, limits: { maxAssetBytes: 2, maxTotalAssetBytes: 6 } });
    expect(result.html).toContain("data:font/woff2;base64,AQI=");
  });

  it("counts standalone stylesheet and inline data resources instead of bypassing total limits", async () => {
    await expect(exportHtml("body", {
      styles: ["@font-face{font-family:a;src:url(a.woff2)}@font-face{font-family:b;src:url(b.woff2)}"],
      assetProvider: { read: async () => ({ bytes: new Uint8Array([1, 2]), mimeType: "font/woff2" }) },
      limits: { maxAssetBytes: 2, maxTotalAssetBytes: 3 },
    })).rejects.toThrow("total asset budget");
    await expect(exportHtml("body", {
      styles: ['@font-face{font-family:a;src:url("data:font/woff2;base64,AQIDBA==")}'],
      limits: { maxAssetBytes: 3 },
    })).rejects.toThrow("bytes");
  });

  it("does not reread or recount the same image across Markdown, DOM and CSS phases", async () => {
    const read = vi.fn(async () => ({ bytes: new Uint8Array([1, 2]), mimeType: "image/png" }));
    const result = await exportHtml("![first](shared.png)", {
      document, assetProvider: { read }, limits: { maxAssetBytes: 2, maxTotalAssetBytes: 2 },
      styles: ["article{background:url(shared.png)}"],
      extensions: [{ render(element) { const image = document.createElement("img"); image.setAttribute("data-resource-src", "shared.png"); element.append(image); } }],
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.html.match(/data:image\/png;base64,AQI=/g)).toHaveLength(3);
  });

  it("preserves a processor-owned image node and its event handler while authorizing its source", async () => {
    let image: HTMLImageElement | undefined;
    const clicked = vi.fn(), cleaned = vi.fn();
    const handle = renderDocument("body", {
      document, assetProvider: { read: async () => ({ bytes: new Uint8Array([1]), mimeType: "image/png" }) },
      extensions: [{ render(element, context) {
        image = document.createElement("img");
        image.setAttribute("data-resource-src", "owned.png"); image.addEventListener("click", clicked);
        element.append(image);
        context.addCleanup(() => { image?.removeEventListener("click", clicked); cleaned(); });
      } }],
    });
    handles.push(handle);
    await handle.ready;
    expect(handle.element.querySelector("img")).toBe(image);
    expect(image?.ownerDocument).toBe(document);
    image?.click(); expect(clicked).toHaveBeenCalledTimes(1);
    await handle.dispose(); image?.click();
    expect(clicked).toHaveBeenCalledTimes(1); expect(cleaned).toHaveBeenCalledTimes(1);
  });

  it("applies the same asset policy to styles inserted by renderDocument itself", async () => {
    const handle = renderDocument("body", { document, styles: ["article{background:url(image.png)}"], assetProvider: {
      read: async () => ({ bytes: new Uint8Array([1]), mimeType: "image/png" }),
    } });
    handles.push(handle);
    await handle.ready;
    expect(handle.element.querySelector("style")?.textContent).toContain("data:image/png;base64,AQ==");
    expect(handle.element.querySelector("style")?.textContent).not.toContain("image.png");
  });

  it("sanitizes SVG resources regardless of MIME casing", async () => {
    const result = await exportHtml("![svg](drawing.svg)", { assetProvider: { read: async () => ({
      bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>unsafe()</script><path d="M0 0L1 1" fill="url(https://example.invalid/paint)"/></svg>'),
      mimeType: "IMAGE/SVG+XML",
    }) } });
    const encoded = /data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/i.exec(result.html)?.[1];
    expect(encoded).toBeTruthy();
    expect(atob(encoded ?? "")).not.toContain("script");
    expect(atob(encoded ?? "")).not.toContain("https:");
    expect(atob(encoded ?? "")).toContain("<path");
  });

  it("drains and awaits cleanup registered reentrantly during disposal", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const order: string[] = [];
    const handle = renderDocument("body", { document, extensions: [{ render(_element, context) {
      context.addCleanup(() => {
        order.push("outer");
        context.addCleanup(async () => { order.push("inner-start"); await gate; order.push("inner-end"); });
      });
    } }] });
    handles.push(handle);
    await handle.ready;
    let disposed = false;
    const disposing = handle.dispose().then(() => { disposed = true; });
    await vi.waitFor(() => expect(order).toContain("inner-start"));
    expect(disposed).toBe(false);
    release(); await disposing;
    expect(order).toEqual(["outer", "inner-start", "inner-end"]);
  });
});
