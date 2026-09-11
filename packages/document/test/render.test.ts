import { afterEach, describe, expect, it, vi } from "vitest";
import type { Root } from "mdast";
import { renderDocument } from "@floatboat/nexus-document/render";
import { exportHtml } from "@floatboat/nexus-document/export-html";
import { createGfmRenderExtension } from "../src/gfm";
import { createMathRenderExtension } from "../src/math";
import { createMermaidRenderExtension } from "../src/mermaid";
import { createRuntimeRenderExtension } from "../src/runtime";
import { MarkdownPostProcessorRegistry } from "@floatboat/nexus-plugin-runtime";
import { NexusComponent, type ComponentId, type PluginId } from "@floatboat/nexus-plugin-api";
import type { DocumentRenderHandle } from "../src/types";
import { png } from "./fixtures";

const handles: DocumentRenderHandle[] = [];
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.dispose()));
  document.body.replaceChildren();
});

describe("complete headless document rendering", () => {
  it("renders a whole document with opt-in GFM, no editor viewport and no default styles", async () => {
    const markdown = Array.from({ length: 250 }, (_, index) => `Paragraph ${index}`).join("\n\n") + "\n\n| A | B |\n|---|---|\n| one | two |\n\n- [x] complete";
    const handle = renderDocument(markdown, { document, extensions: [createGfmRenderExtension()] });
    handles.push(handle);
    await handle.ready;
    expect(handle.element.textContent).toContain("Paragraph 249");
    expect(handle.element.querySelectorAll("table")).toHaveLength(1);
    expect(handle.element.querySelector("input")?.disabled).toBe(true);
    expect(handle.element.querySelector("style")).toBeNull();
    expect(document.querySelector(".cm-editor")).toBeNull();
    expect(handle.element.isConnected).toBe(false);
  });

  it("owns every DOM node in the explicitly supplied iframe Document", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const owner = frame.contentDocument;
    if (!owner) throw new Error("Missing iframe Document");
    const handle = renderDocument("# Inside", { document: owner });
    handles.push(handle);
    await handle.ready;
    expect(handle.element.ownerDocument).toBe(owner);
    expect(handle.element.querySelector("h1")?.ownerDocument).toBe(owner);
    expect(document.querySelector("article")).toBeNull();
  });

  it("does not rerun remark transforms or mutate the provided snapshot AST", async () => {
    const transform = vi.fn((tree: Root) => tree);
    const tree: Root = { type: "root", children: [{ type: "heading", depth: 1, children: [{ type: "text", value: "Transformed" }] }] };
    const before = structuredClone(tree);
    const result = await exportHtml({ markdown: "# Original", renderAst: tree }, { extensions: [{ remarkPlugins: [() => transform] }] });
    expect(result.html).toContain("Transformed");
    expect(transform).not.toHaveBeenCalled();
    expect(tree).toEqual(before);
  });

  it("exports self-contained images, escapes title and strips local/temporary link targets", async () => {
    const assetProvider = { read: vi.fn(async () => ({ bytes: png, mimeType: "image/png" })) };
    const result = await exportHtml('# Intro\n\n[[elsewhere|Alias]] [[#Intro]] [local](file:///secret.md) ![pixel](asset.png)', { title: "<unsafe>", assetProvider });
    expect(result.html).toContain("data:image/png;base64,");
    expect(result.html).toContain("&lt;unsafe&gt;");
    expect(result.html).toContain('href="#intro"');
    expect(result.html).toContain("Alias");
    expect(result.html).not.toMatch(/file:|nexus-asset:|data-source|data-wikilink/);
    expect(result.html).toContain("Content-Security-Policy");
  });

  it("sanitizes raw HTML, malicious AST properties and SVG external resources", async () => {
    const raw = '<script>bad()</script>\n\n# safe';
    expect((await exportHtml(raw)).html).not.toContain("bad()");
    const result = await exportHtml("![svg](drawing.svg)", { assetProvider: { read: async () => ({
      mimeType: "image/svg+xml",
      bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script><image href="https://example.invalid/leak"/><path d="M0 0L1 1"/></svg>'),
    }) } });
    const encoded = /data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/.exec(result.html)?.[1];
    expect(encoded).toBeTruthy();
    expect(atob(encoded ?? "")).not.toMatch(/script|https:|bad/);
  });

  it("reports missing images or rejects in strict mode without calling remote providers", async () => {
    const read = vi.fn(async () => null);
    const result = await exportHtml("![remote](https://example.invalid/p.png)", { assetProvider: { read } });
    expect(result.html).toContain("Image unavailable: remote");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "asset-unavailable" }));
    expect(read).not.toHaveBeenCalled();
    await expect(exportHtml("![missing](missing.png)", { strictAssets: true })).rejects.toThrow("unavailable");
  });

  it("embeds authorized font bytes and enforces the final encoded output budget", async () => {
    const options = {
      styles: ['@font-face{font-family:sample;src:url("font.woff2")}'],
      assetProvider: { read: async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "font/woff2" }) },
    };
    const output = await exportHtml("text", options);
    expect(output.html).toContain("data:font/woff2;base64,AQID");
    await expect(exportHtml("text", { ...options, limits: { maxOutputBytes: 100 } })).rejects.toThrow("Offline HTML");
    await expect(exportHtml("text", { styles: ['@import "https://example.invalid/a.css"'] })).rejects.toThrow("imports");
  });

  it("renders MathML without implicitly loading styles or external fonts", async () => {
    const result = await exportHtml("Inline $x^2$\n\n$$\na+b\n$$", { extensions: [createMathRenderExtension()] });
    expect(result.html).toContain("<math");
    expect(result.html).toContain("<msup>");
    expect(result.html).not.toContain("@font-face");
    expect(result.html).not.toContain("<script");
  });

  it("provides an optional cancellable Mermaid renderer with source fallback", async () => {
    const render = vi.fn(async (_source: string, target: HTMLElement) => {
      expect(target.ownerDocument).toBe(document);
      return '<svg xmlns="http://www.w3.org/2000/svg"><style>.box{fill:red}</style><path class="box" d="M0 0L10 10"/></svg>';
    });
    const result = await exportHtml("```mermaid\ngraph TD;A-->B\n```", { document, extensions: [createMermaidRenderExtension({ render })] });
    expect(render).toHaveBeenCalledOnce();
    expect(result.html).toContain("<svg");
    expect(result.html).toContain("fill:red");
    expect(document.querySelector('div[style*="-100000px"]')).toBeNull();
    const failed = await exportHtml("```mermaid\nbroken\n```", { document, extensions: [createMermaidRenderExtension({ render: async () => { throw new Error("invalid"); } })] });
    expect(failed.html).toContain("broken");
    expect(failed.diagnostics).toHaveLength(1);
  });

  it("awaits runtime child cleanup instead of creating another processor registry", async () => {
    const registry = new MarkdownPostProcessorRegistry();
    const owner = { pluginId: "document-test" as PluginId, componentId: "document-test/root" as ComponentId };
    let released = false;
    class Child extends NexusComponent {
      override async onunload() { await Promise.resolve(); released = true; }
    }
    const registered = registry.registerPostProcessor(owner, async (element, context) => {
      await context.addChild(new Child());
      element.querySelector("h1")?.append(" processed");
    });
    if (!registered.ok) throw new Error("Registration failed");
    await registered.registration.activate?.();
    const handle = renderDocument("# Heading", { document, extensions: [createRuntimeRenderExtension(registry)] });
    handles.push(handle);
    await handle.ready;
    expect(handle.element.textContent).toContain("processed");
    await handle.dispose();
    expect(released).toBe(true);
    await registry.dispose();
  });

  it("cancels blocked rendering and isolates cleanup from other documents", async () => {
    const released: string[] = [];
    const live = renderDocument("# other", { document });
    handles.push(live);
    await live.ready;
    document.body.append(live.element);
    const controller = new AbortController();
    const blocked = renderDocument("# pending", { document, signal: controller.signal, extensions: [{
      render(_element, context) { context.addCleanup(async () => { released.push(context.documentId); }); return new Promise(() => undefined); },
    }], documentId: "pending" });
    handles.push(blocked);
    await vi.waitFor(() => expect(blocked.element.textContent).toContain("pending"));
    controller.abort();
    await expect(blocked.ready).rejects.toMatchObject({ name: "AbortError" });
    await blocked.dispose();
    expect(released).toEqual(["pending"]);
    expect(live.element.isConnected).toBe(true);
  });
});
