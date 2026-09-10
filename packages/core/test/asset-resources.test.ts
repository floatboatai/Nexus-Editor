import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, loadAssetImage, releaseAssetResources, type AssetResource, type EditorAPI } from "../src/index";

const editors: EditorAPI[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("authorized image resources", () => {
  it("loads through the provider and revokes only its own object URL", async () => {
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const image = document.createElement("img");
    const read = vi.fn(async () => ({ bytes: new Uint8Array([1]), mimeType: "image/png" }));
    const handle = loadAssetImage(image, "https://example.invalid/private.png", { read });
    expect(image.hasAttribute("src")).toBe(false);
    expect(await handle.ready).toBe("loaded");
    expect(read).toHaveBeenCalledWith("https://example.invalid/private.png", expect.objectContaining({ signal: expect.any(AbortSignal), maxBytes: 10485760 }));
    expect(image.getAttribute("src")).toBe("blob:test");
    releaseAssetResources(image);
    handle.dispose();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("does not assign late resources after disposal or fall back to their remote address", async () => {
    let finish: (value: AssetResource) => void = () => { throw new Error("Uninitialized fixture"); };
    const pending = new Promise<AssetResource>((resolve) => { finish = resolve; });
    const image = document.createElement("img");
    const handle = loadAssetImage(image, "https://example.invalid/private.png", { read: () => pending });
    handle.dispose();
    finish({ bytes: new Uint8Array([1]), mimeType: "image/png" });
    expect(await handle.ready).toBe("cancelled");
    expect(image.hasAttribute("src")).toBe(false);
  });

  it("reports provider errors and invalid media without automatic fetching", async () => {
    const image = document.createElement("img");
    const invalid = loadAssetImage(image, "image", { read: async () => ({ bytes: new Uint8Array([1]), mimeType: "text/html" }) });
    expect(await invalid.ready).toBe("unavailable");
    const failed = loadAssetImage(image, "image", { read: async () => { throw new Error("denied"); } });
    expect(await failed.ready).toBe("failed");
    expect(image.hasAttribute("src")).toBe(false);
    failed.dispose();
  });

  it("settles cancellation even when a provider ignores its signal", async () => {
    const image = document.createElement("img");
    const handle = loadAssetImage(image, "image", { read: () => new Promise(() => undefined) });
    handle.dispose();
    await expect(handle.ready).resolves.toBe("cancelled");
  });

  it("does not let an older handle dispose a replacement resource", async () => {
    let count = 0;
    vi.stubGlobal("URL", { createObjectURL: () => `blob:${++count}`, revokeObjectURL: vi.fn() });
    const provider = { read: async () => ({ bytes: new Uint8Array([1]), mimeType: "image/png" }) };
    const image = document.createElement("img");
    const first = loadAssetImage(image, "first", provider);
    await first.ready;
    const second = loadAssetImage(image, "second", provider);
    await second.ready;
    first.dispose();
    expect(image.getAttribute("src")).toBe("blob:2");
    second.dispose();
  });

  it("invalidates image resources when a different document has identical Markdown", async () => {
    let count = 0;
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: () => `blob:${++count}`, revokeObjectURL });
    const read = vi.fn(async () => ({ bytes: new Uint8Array([1]), mimeType: "image/png" }));
    const container = document.createElement("div");
    document.body.append(container);
    const markdown = "![image](shared-name.png)\n\nend";
    const editor = createEditor({ container, initialValue: markdown, livePreview: { assetProvider: { read } } });
    editors.push(editor);
    await vi.waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toMatch(/^blob:/));
    const first = container.querySelector("img")?.getAttribute("src");
    const requests = read.mock.calls.length;
    editor.setDocument(markdown, { silent: true });
    await vi.waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(requests));
    await vi.waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).not.toBe(first));
    expect(revokeObjectURL).toHaveBeenCalledWith(first);
  });
});
