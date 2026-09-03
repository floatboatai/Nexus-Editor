import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { forceStopSmokeClients, freePort, runProductUi, stopSmokeClients } from "./electron-collaboration-smoke-ui.mjs";
import { createTestTlsProxy } from "./electron-collaboration-smoke-tls.mjs";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const fixture = path.join(appDir, "test/fixtures/electron-collaboration-smoke-main.cjs");
const timeoutMs = Number(process.env.NEXUS_ELECTRON_COLLABORATION_SMOKE_TIMEOUT_MS ?? 120000);
const suite = process.env.NEXUS_ELECTRON_COLLABORATION_SMOKE_SUITE ?? "all";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const probeRuns = new Set();
let interrupted = false;
let cleanupResources = async () => {};
let suiteTimer;
const cancellation = new AbortController();

function forceStopProbes() {
  for (const run of probeRuns) run.kill(true);
}

async function stopProbes() {
  const results = await Promise.allSettled([...probeRuns].map((run) => run.cleanup()));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "Network probe cleanup failed");
}

function interrupt(exitCode, reason) {
  if (interrupted) { forceStopProbes(); forceStopSmokeClients(); return; }
  interrupted = true;
  cancellation.abort();
  clearTimeout(suiteTimer);
  const forcedExit = setTimeout(() => {
    forceStopProbes(); forceStopSmokeClients();
    process.stderr.write("Collaboration smoke cleanup exceeded its deadline; only recorded test process groups were forced to stop.\n");
    setTimeout(() => process.exit(exitCode), 1000);
  }, 8000);
  void cleanupResources().then(() => {
    process.stdout.write(`${JSON.stringify({ ok: false, smoke: "electron-collaboration", interrupted: reason,
      cleanup: "complete" })}\n`);
  }).catch((error) => {
    process.stdout.write(`${JSON.stringify({ ok: false, smoke: "electron-collaboration", interrupted: reason,
      cleanupError: String(error) })}\n`);
  }).finally(() => { clearTimeout(forcedExit); process.exit(exitCode); });
}
const onSigint = () => interrupt(130, "SIGINT");
const onSigterm = () => interrupt(143, "SIGTERM");
process.once("SIGINT", onSigint);
process.once("SIGTERM", onSigterm);

async function runElectron(mode, directory, serverUrl, expectedNetwork = "open") {
  assert(!interrupted, "Collaboration smoke was cancelled");
  const electron = require("electron");
  const args = [`--user-data-dir=${directory}`, fixture];
  if (process.platform === "linux") args.unshift("--no-sandbox");
  let command = electron;
  if (process.platform === "linux" && !process.env.DISPLAY) {
    const xvfb = spawnSync("which", ["xvfb-run"], { encoding: "utf8" });
    assert.equal(xvfb.status, 0, "Linux smoke requires DISPLAY or xvfb-run");
    command = xvfb.stdout.trim();
    args.unshift("-a", electron);
  }
  const env = { ...process.env, NEXUS_COLLAB_SERVERS: serverUrl, NEXUS_COLLAB_SMOKE_URL: serverUrl,
    NEXUS_COLLAB_SMOKE_MODE: mode, NEXUS_COLLAB_SMOKE_EXPECT_NETWORK: expectedNetwork,
    NEXUS_PLUGIN_PLATFORM: mode === "legacy" ? "0" : "1" };
  delete env.VITE_DEV_SERVER_URL;
  delete env.VITE_NEXUS_PLUGIN_PLATFORM;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  delete env.NEXUS_COLLAB_SMOKE_CA;
  delete env.NEXUS_COLLAB_SMOKE_INTERACTIVE;
  const child = spawn(command, args, { cwd: appDir, env, detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"] });
  if (process.env.NEXUS_ELECTRON_COLLABORATION_SMOKE_TRACE_LIFECYCLE === "1") {
    process.stderr.write(`NEXUS_COLLAB_SMOKE_CHILD=${JSON.stringify({ pid: child.pid, name: `${mode}-network-probe` })}\n`);
  }
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-128 * 1024); });
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-16 * 1024); });
  let closed = false;
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => { closed = true; resolve({ code, signal }); });
  });
  let cleanupPromise;
  const run = {
    kill(force) {
      if (closed || child.pid === undefined) return;
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])]);
      } else {
        try { process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM"); }
        catch { child.kill(force ? "SIGKILL" : "SIGTERM"); }
      }
    },
    cleanup() {
      if (!cleanupPromise) cleanupPromise = (async () => {
        try {
          if (closed) return;
          run.kill(false);
          if (!await Promise.race([completion.then(() => true), delay(2000).then(() => false)])) {
            run.kill(true);
            assert(await Promise.race([completion.then(() => true), delay(1000).then(() => false)]),
              "Network probe process group did not exit after forced cleanup");
          }
        } finally { if (closed) probeRuns.delete(run); }
      })();
      return cleanupPromise;
    },
  };
  probeRuns.add(run);
  let timer;
  try {
    const outcome = await Promise.race([completion, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Electron ${mode} collaboration smoke timed out`)), timeoutMs);
    })]);
    const reportLine = stdout.split(/\r?\n/u).find((line) => line.startsWith("NEXUS_COLLAB_SMOKE="));
    const report = reportLine ? JSON.parse(reportLine.slice("NEXUS_COLLAB_SMOKE=".length)) : null;
    if (outcome.code !== 0 || !report?.ok) {
      throw Object.assign(new Error(`Electron ${mode} collaboration smoke failed`), {
        details: { outcome, report, stderr: stderr.split(/\r?\n/u).slice(-12) },
      });
    }
    return report;
  } finally {
    clearTimeout(timer);
    await run.cleanup();
  }
}

async function main() {
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000, "Invalid collaboration smoke timeout");
  assert(["all", "network", "product", "tls"].includes(suite), "Invalid collaboration smoke suite");
  for (const artifact of ["dist/index.html", "dist-electron/main.js", "dist-electron/preload.js",
    "dist-electron/collab-store-worker.js"]) {
    assert((await stat(path.join(appDir, artifact))).isFile(), `Build required: ${artifact}`);
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "nexus-collaboration-smoke-"));
  if (process.env.NEXUS_ELECTRON_COLLABORATION_SMOKE_TRACE_LIFECYCLE === "1") {
    process.stderr.write(`NEXUS_COLLAB_SMOKE_DIRECTORY=${directory}\n`);
  }
  let service;
  let proxy;
  let pendingProxy;
  let cleanupPromise;
  cleanupResources = () => {
    if (!cleanupPromise) cleanupPromise = (async () => {
      const failures = [];
      const stopped = await Promise.allSettled([stopProbes(), stopSmokeClients()]);
      for (const result of stopped) if (result.status === "rejected") failures.push(String(result.reason));
      if (pendingProxy) await pendingProxy.catch(() => {});
      try { await proxy?.close(); } catch (error) { failures.push(String(error)); }
      try { await service?.stop(); } catch (error) { failures.push(String(error)); }
      try { await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
      catch (error) { failures.push(String(error)); }
      assert.equal(failures.length, 0, `Collaboration smoke cleanup failures: ${failures.join("; ")}`);
    })();
    return cleanupPromise;
  };
  try {
    const { createCollaborationServer } = await import(pathToFileURL(
      path.resolve(appDir, "../collab-server/dist/index.js")).href);
    assert(!interrupted, "Collaboration smoke was cancelled");
    service = createCollaborationServer({ address: "127.0.0.1", port: await freePort(),
      storageDirectory: path.join(directory, "server"), authSecret: randomBytes(32) });
    await service.start();
    const serverUrl = service.websocketUrl;
    const reports = [];
    for (const mode of ["legacy", "runtime"]) {
      try { reports.push(await runElectron(mode, path.join(directory, mode), serverUrl)); }
      catch (error) { reports.push({ ok: false, mode, error: error.message, details: error.details }); }
    }
    const ok = reports.every((report) => report.ok);
    const product = ok && (suite === "all" || suite === "product")
      ? await runProductUi({ directory, service, serverUrl }) : undefined;
    let tls;
    if (ok && (suite === "all" || suite === "tls")) {
      const tlsDirectory = path.join(directory, "tls");
      await mkdir(tlsDirectory);
      pendingProxy = createTestTlsProxy(tlsDirectory, serverUrl, { signal: cancellation.signal })
        .then((created) => { proxy = created; return created; });
      await pendingProxy;
      try {
        const chromiumCertificateRejection = await runElectron("runtime",
          path.join(tlsDirectory, "untrusted-profile"), proxy.serverUrl, "error");
        tls = { ...(await runProductUi({ directory: tlsDirectory, service, serverUrl: proxy.serverUrl,
          extended: false, extraEnv: { NODE_EXTRA_CA_CERTS: proxy.ca, NEXUS_COLLAB_SMOKE_CA: proxy.ca } })),
        scope: "local-loopback-TLS-proxy-not-cross-machine-public-deployment", nodeUntrustedCaRejected: true,
        chromiumCertificateRejection };
      } finally { await proxy.close(); proxy = undefined; }
    }
    assert(!interrupted, "Collaboration smoke was cancelled");
    await cleanupResources();
    process.stdout.write(`${JSON.stringify({ ok, smoke: "electron-collaboration", suite, reports, product, tls })}\n`);
    if (!ok) process.exitCode = 1;
  } finally {
    await cleanupResources();
  }
}

if (Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000) suiteTimer = setTimeout(() => interrupt(1, "suite-timeout"), timeoutMs);
await main().catch((error) => {
  if (interrupted) return;
  process.stdout.write(`${JSON.stringify({ ok: false, smoke: "electron-collaboration",
    error: error.message, details: error.details })}\n`);
  process.exitCode = 1;
}).finally(() => {
  clearTimeout(suiteTimer);
  if (!interrupted) { process.off("SIGINT", onSigint); process.off("SIGTERM", onSigterm); }
});
