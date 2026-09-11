import { describe, expect, it, vi } from "vitest";
import { convertHtml } from "@floatboat/nexus-document/html";
import { convertCsv } from "@floatboat/nexus-document/csv";
import { createConversionAssetProvider } from "@floatboat/nexus-document";
import { rewriteAssetReferences } from "@floatboat/nexus-document/assets";
import { exportHtml } from "@floatboat/nexus-document/export-html";
import { createGfmRenderExtension } from "../src/gfm";
import { png } from "./fixtures";

describe("portable document conversion", () => {
  it("converts semantic HTML while removing active markup without fetching remote images", async () => {
    const read = vi.fn(async () => null);
    const result = await convertHtml('<base href="file:///private/"><script>alert(1)</script><h1 onclick="alert(2)">Title</h1><p><strong>Bold</strong> <a href="javascript:alert(3)">safe text</a></p><img src="https://example.invalid/track.png">', { assetProvider: { read } });
    expect(result.markdown).toContain("# Title");
    expect(result.markdown).toContain("**Bold**");
    expect(result.markdown).not.toMatch(/script|javascript:|onclick|file:/);
    expect(read).not.toHaveBeenCalled();
    expect(result.assetPlan[0].resource).toBeNull();
    expect(result.diagnostics.map((item) => item.code)).toContain("asset-unavailable");
  });

  it("shares imported image bytes with preview/export and rewrites only actual attachment links", async () => {
    const read = vi.fn(async () => ({ bytes: png, mimeType: "image/png" }));
    const result = await convertHtml('<p>Imported</p><img src="images/p.png" alt="pixel"><img src="images/p.png" alt="again">', { assetProvider: { read }, sourcePath: "source/page.html", documentId: "import-1" });
    expect(read).toHaveBeenCalledOnce();
    expect(result.assetPlan).toHaveLength(1);
    const provider = createConversionAssetProvider(result);
    const asset = await provider.read(result.assetPlan[0].source);
    expect(asset?.bytes).toEqual(png);
    const artifact = await exportHtml(result.markdown, { assetProvider: provider });
    expect(artifact.html).toContain("data:image/png;base64,");
    expect(artifact.html).not.toMatch(/nexus-asset:|images\/p.png/);
    expect(artifact.bytes.byteLength).toBe(new TextEncoder().encode(artifact.html).byteLength);
    const source = result.assetPlan[0].source;
    const written = rewriteAssetReferences(`${result.markdown}\n\`${source}\``, { [source]: "attachments/p.png" });
    expect(written).toContain("attachments/p.png");
    expect(written).toContain(`\`${source}\``);
    expect(() => rewriteAssetReferences(result.markdown, {})).toThrow("Every logical attachment");
  });

  it("extracts data images and rejects unsafe target mappings", async () => {
    const result = await convertHtml('<img src="data:image/png;base64,AQID">');
    expect(result.assetPlan[0].resource?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(() => rewriteAssetReferences(result.markdown, { [result.assetPlan[0].source]: "/outside.png" })).toThrow("relative committed destination");
  });

  it("handles quoted CSV, pipes, multiline cells and uneven rows without numeric coercion", async () => {
    const result = await convertCsv('Name,Value\n"a,b","line1\nline2"\n"a|b",001,extra');
    expect(result.markdown).toContain("a,b");
    expect(result.markdown).toContain("a\\|b");
    expect(result.markdown).toContain("001");
    expect(result.markdown).toContain("<br>");
    expect(result.markdown).toContain("extra");
    const artifact = await exportHtml(result.markdown, { extensions: [createGfmRenderExtension()] });
    expect(artifact.html).toContain("<table>");
    expect(artifact.html).toContain("<br>");
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports generated CSV headers and explicit delimiter", async () => {
    const result = await convertCsv("a;b\nc;d", { delimiter: ";", header: "generate" });
    expect(result.markdown).toContain("Column 1");
    expect(result.markdown).toContain("a");
    await expect(convertCsv('"unclosed')).rejects.toThrow();
    await expect(convertCsv("a,b\nc,d", { limits: { maxNodes: 3 } })).rejects.toThrow("cell budget");
  });

  it("honors source/asset/output limits and aborts an unresolved resource callback", async () => {
    await expect(convertHtml("too large", { limits: { maxInputBytes: 2 } })).rejects.toThrow("HTML input");
    await expect(convertHtml('<img src="data:image/png;base64,AQID">', { limits: { maxAssetBytes: 2 } })).rejects.toThrow("Inline image");
    const controller = new AbortController();
    const result = convertHtml('<img src="pending.png">', { signal: controller.signal, assetProvider: { read: () => new Promise(() => undefined) } });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });
});
