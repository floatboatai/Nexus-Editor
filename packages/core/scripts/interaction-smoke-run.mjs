// Run with Node 22. Optional: --baseline=af58999 --table-only compares existing table behavior.
// All bundles, Electron state and fixtures live in a task-owned temporary directory.
import { build } from "tsup";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repository = path.resolve(packageRoot, "../..");
const require = createRequire(path.join(repository, "apps/electron-demo/package.json"));
const baseline = process.argv.find((value) => value.startsWith("--baseline="))?.slice("--baseline=".length);
const tableOnly = process.argv.includes("--table-only");
const cases = process.argv.find((value) => value.startsWith("--cases="))?.slice("--cases=".length) ?? "";
const repeats = Number(process.argv.find((value) => value.startsWith("--repeat="))?.slice("--repeat=".length) ?? 1);
if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 10) throw new Error("--repeat must be between 1 and 10");
const directory = await mkdtemp(path.join(tmpdir(), "nexus-core-interaction-"));
let server;
let child;
try {
  console.log("[core interaction smoke] Building isolated renderer");
  await Promise.all([mkdir(path.join(directory, "user-data")), mkdir(path.join(directory, "session-data"))]);
  await build({
    config: false, dts: false, silent: true,
    entry: { renderer: path.join(packageRoot, "scripts/interaction-smoke-renderer.ts") },
    outDir: directory,
    format: ["esm"], platform: "browser", target: "chrome134", splitting: true,
    outExtension: () => ({ js: ".js" }),
    noExternal: [/.*/], tsconfig: path.join(repository, "tsconfig.base.json"),
    esbuildPlugins: baseline ? [{
      name: "read-only-core-baseline",
      setup(builder) {
        builder.onLoad({ filter: /packages\/core\/src\/.*\.ts$/ }, ({ path: filename }) => {
          const relative = path.relative(repository, filename).split(path.sep).join("/");
          const contents = execFileSync("git", ["show", `${baseline}:${relative}`], {
            cwd: repository, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
          });
          return { contents, loader: "ts", resolveDir: path.dirname(filename) };
        });
      },
    }] : [],
  });
  await readFile(path.join(directory, "renderer.js"));
  await copyFile(path.join(packageRoot, "scripts/interaction-smoke-main.cjs"), path.join(directory, "main.cjs"));
  await writeFile(path.join(directory, "index.html"), `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src blob: data:; connect-src 'self'; base-uri 'none'; form-action 'none'"><title>Isolated core interaction smoke</title><script type="module" src="./renderer.js"></script>`);
  server = createServer(async (request, response) => {
    const name = request.url === "/" ? "index.html" : request.url?.slice(1);
    if (!name || !/^[a-z0-9._-]+$/i.test(name)) { response.writeHead(404).end(); return; }
    try {
      response.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : "text/html");
      response.end(await readFile(path.join(directory, name)));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Cannot bind the isolated smoke server");
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  console.log("[core interaction smoke] Launching isolated Electron window");
  child = spawn(require("electron"), [path.join(directory, "main.cjs")], {
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...environment,
      NEXUS_CORE_SMOKE_ROOT: directory,
      NEXUS_CORE_SMOKE_URL: `http://127.0.0.1:${address.port}/`,
      NEXUS_CORE_SMOKE_REF: baseline ?? "worktree",
      NEXUS_CORE_SMOKE_TABLE_ONLY: tableOnly ? "1" : "0",
      NEXUS_CORE_SMOKE_CASES: cases,
      NEXUS_CORE_SMOKE_REPEATS: String(repeats),
    },
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 55_000);
  try {
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    if (code !== 0) process.exitCode = 1;
  } finally { clearTimeout(timeout); }
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
