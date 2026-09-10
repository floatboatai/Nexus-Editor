import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "tsup";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const repo = path.resolve(appRoot, "../..");
const require = createRequire(path.join(appRoot, "package.json"));
const temporary = await mkdtemp(path.join(tmpdir(), "nexus-public-demo-smoke-"));
try {
  // Exercise the same dist-only layout used by electron-builder, without a
  // workspace node_modules directory masking missing packaged dependencies.
  await cp(path.join(appRoot, "dist"), path.join(temporary, "app/dist"), { recursive: true });
  await cp(path.join(appRoot, "dist-electron"), path.join(temporary, "app/dist-electron"), { recursive: true });
  await build({ config: false, entry: [path.join(repo, "packages/document/test/fixtures.ts")],
    outDir: path.join(temporary, "fixtures"), format: "cjs", platform: "node", noExternal: [/.*/], silent: true });
  const { docxFixture, pdfFixture, png } = require(path.join(temporary, "fixtures/fixtures.js"));
  const { encodeDocumentText } = await import(pathToFileURL(path.join(repo, "packages/text-codec/dist/index.js")));
  const { legacyTextCodec } = await import(pathToFileURL(path.join(repo, "packages/text-codec/dist/legacy.js")));
  await mkdir(path.join(temporary, "vault"));
  await Promise.all([
    writeFile(path.join(temporary, "encoded.md"), encodeDocumentText("# 原文\n\n中文初始内容\n", { encoding: "gbk", eol: "crlf", legacyCodec: legacyTextCodec })),
    writeFile(path.join(temporary, "sample.docx"), docxFixture()),
    writeFile(path.join(temporary, "sample.pdf"), pdfFixture(["Production PDF text"])),
    writeFile(path.join(temporary, "sample.csv"), "name,value\n中文,2\n"),
    writeFile(path.join(temporary, "sample.html"), '<h1>HTML import</h1><img src="pixel.png">'),
    writeFile(path.join(temporary, "pixel.png"), png),
    writeFile(path.join(temporary, "vault/A.md"), "# Alpha\n\nneedle alpha\n"),
    writeFile(path.join(temporary, "vault/B.md"), "# Beta\n\nneedle beta\n"),
  ]);
  for (const mode of ["legacy", "runtime"]) {
    const profile = path.join(temporary, mode);
    await mkdir(profile);
    const child = spawn(require("electron"), [path.join(appRoot, "scripts/public-capabilities-smoke-main.cjs")], {
      stdio: "inherit",
      env: { ...process.env, NEXUS_PUBLIC_SMOKE_ROOT: temporary, NEXUS_PUBLIC_SMOKE_MODE: mode,
        NEXUS_PLUGIN_PLATFORM: mode === "legacy" ? "0" : "1",
        VITE_NEXUS_PLUGIN_PLATFORM: mode === "legacy" ? "0" : "1",
        VITE_DEV_SERVER_URL: "" },
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 55_000);
    try {
      const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
      if (code !== 0) throw new Error(`${mode} production demo smoke failed (${code})`);
    } finally { clearTimeout(timeout); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
