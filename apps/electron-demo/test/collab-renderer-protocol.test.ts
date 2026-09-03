// @vitest-environment node
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRendererProtocolHandler } from "../electron/collab-renderer-protocol";

describe("trusted built renderer protocol", () => {
  it("serves only confined static dist files with the supplied enforced policy", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "nexus-renderer-protocol-"));
    const root = path.join(fixture, "dist");
    await mkdir(path.join(root, "assets"), { recursive: true });
    await writeFile(path.join(root, "index.html"), "<main>Editor</main>");
    await writeFile(path.join(root, "assets", "app.js"), "export const ready=true;");
    await writeFile(path.join(fixture, "private.txt"), "not renderer content");
    await symlink(path.join(fixture, "private.txt"), path.join(root, "leak.txt"));
    const serve = createRendererProtocolHandler(root, "default-src 'self'; connect-src wss://collab.example.test;");
    const page = await serve(new Request("nexus-app://editor/index.html"));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("connect-src wss://collab.example.test;");
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await page.text()).toBe("<main>Editor</main>");
    expect((await serve(new Request("nexus-app://editor/assets/app.js"))).headers.get("content-type")).toContain("javascript");
    for (const url of [
      "nexus-app://other/index.html", "nexus-app://editor:99/index.html",
      "nexus-app://editor/%2e%2e%2fprivate.txt", "nexus-app://editor/assets%5c..%5cprivate.txt",
      "nexus-app://editor/leak.txt", "nexus-app://editor/assets/", "nexus-app://editor/index.html?redirect=https://attacker.test",
    ]) expect((await serve(new Request(url))).status).toBe(404);
    expect((await serve(new Request("nexus-app://editor/index.html", { method: "POST" }))).status).toBe(404);
  });
});
