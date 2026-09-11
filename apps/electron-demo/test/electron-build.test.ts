// @vitest-environment node
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsup";
import { expect, it } from "vitest";

const repository = fileURLToPath(new URL("../../..", import.meta.url));

it("bundles the default main process from a clean checkout without library dist", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "nexus-clean-build-"));
  const app = path.join(temporary, "apps/electron-demo");
  try {
    await mkdir(path.join(app, "src"), { recursive: true });
    await cp(path.join(repository, "apps/electron-demo/electron"), path.join(app, "electron"), { recursive: true });
    await cp(path.join(repository, "apps/electron-demo/src/shared"), path.join(app, "src/shared"), { recursive: true });
    for (const filename of ["package.json", "tsconfig.json", "tsup.config.ts"]) {
      await cp(path.join(repository, "apps/electron-demo", filename), path.join(app, filename));
    }
    await cp(path.join(repository, "tsconfig.base.json"), path.join(temporary, "tsconfig.base.json"));
    await symlink(path.join(repository, "node_modules"), path.join(temporary, "node_modules"), "junction");
    await mkdir(path.join(app, "node_modules/@floatboat"), { recursive: true });
    for (const name of ["text-codec", "document-history", "document"]) {
      const source = path.join(repository, "packages", name);
      const target = path.join(temporary, "packages", name);
      await mkdir(target, { recursive: true });
      await cp(path.join(source, "package.json"), path.join(target, "package.json"));
      await cp(path.join(source, "src"), path.join(target, "src"), { recursive: true });
      await symlink(path.join(source, "node_modules"), path.join(target, "node_modules"), "junction");
      await symlink(target, path.join(app, "node_modules/@floatboat", `nexus-${name}`), "junction");
    }
    const output = path.join(temporary, "output");
    await build({
      config: path.join(app, "tsup.config.ts"),
      tsconfig: path.join(app, "tsconfig.json"),
      entry: [path.join(app, "electron/main.ts"), path.join(app, "electron/preload.ts")],
      outDir: output,
      silent: true,
      dts: false,
    });
    const main = await readFile(path.join(output, "main.js"), "utf8");
    expect(main).not.toMatch(/(?:require|import)\(["']@floatboat\//);
    expect(main).toContain("nexus:public-capabilities");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}, 20_000);

it("prepares both browser conversion entries without a prior package build", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "nexus-worker-build-"));
  try {
    const script = path.join(repository, "packages/document/scripts/build-browser-worker.mjs");
    const { buildBrowserWorker } = await import(script);
    await buildBrowserWorker(temporary);
    const factory = await readFile(path.join(temporary, "browser-worker.js"), "utf8");
    const worker = await readFile(path.join(temporary, "worker-browser.js"), "utf8");
    expect(factory).toContain("createBrowserConversionExecutor");
    expect(factory).toMatch(/new URL\(["']\.\/worker-browser\.js["'],\s*import\.meta\.url\)/);
    expect(factory).not.toMatch(/(?:from|import\s*\()\s*["']@floatboat\//);
    expect(worker).toContain("nexus-document-conversion-v1");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}, 20_000);
