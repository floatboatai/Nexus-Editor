import { build } from "tsup";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { buildBrowserWorker } from "./build-browser-worker.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repo = path.resolve(packageRoot, "../..");
const require = createRequire(path.join(repo, "apps/electron-demo/package.json"));
const root = await mkdtemp(path.join(tmpdir(), "nexus-document-browser-"));
let server;
let child;
try {
  await Promise.all([mkdir(path.join(root, "user-data")), mkdir(path.join(root, "session-data"))]);
  await build({
    config: false, dts: false, silent: true,
    entry: { renderer: path.join(packageRoot, "scripts/browser-renderer.ts") },
    outDir: root,
    format: ["esm"], platform: "browser", target: "chrome134", splitting: true,
    noExternal: [/.*/], tsconfig: path.join(repo, "tsconfig.base.json"),
    esbuildOptions(options) { options.logLevel = "error"; },
  });
  await buildBrowserWorker(root);
  await copyFile(path.join(packageRoot, "scripts/browser-main.cjs"), path.join(root, "main.cjs"));
  await writeFile(path.join(root, "index.html"), '<!doctype html><meta charset="utf-8"><title>Isolated document conversion smoke</title><script type="module" src="./renderer.js"></script>');
  server = createServer(async (request, response) => {
    const name = request.url === "/" ? "index.html" : request.url?.slice(1);
    if (!name || !/^[a-z0-9._-]+$/i.test(name)) { response.writeHead(404).end(); return; }
    try {
      const bytes = await readFile(path.join(root, name));
      response.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : "text/html");
      response.end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Cannot bind smoke server");
  child = spawn(require("electron"), [path.join(root, "main.cjs")], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, NEXUS_DOCUMENT_SMOKE_ROOT: root, NEXUS_DOCUMENT_SMOKE_URL: `http://127.0.0.1:${address.port}/` },
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 50_000);
  try {
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    if (code !== 0) process.exitCode = 1;
  } finally { clearTimeout(timeout); }
} finally {
  if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
