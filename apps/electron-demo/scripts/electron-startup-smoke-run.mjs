import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { rm, stat } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.dirname(scriptsDir);
const mainEntry = path.join(appDir, "dist-electron", "main.js");
const preloadEntry = path.join(appDir, "dist-electron", "preload.js");
const workerEntry = path.join(appDir, "dist-electron", "collab-store-worker.js");
const rendererEntry = path.join(appDir, "dist", "index.html");
const rendererUrl = "nexus-app://editor/index.html";
const timeoutMs = Number.parseInt(
  process.env.NEXUS_ELECTRON_STARTUP_SMOKE_TIMEOUT_MS ?? "15000",
  10,
);
const require = createRequire(import.meta.url);
const activeRuns = new Set();
const maxLogBytes = 64 * 1024;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requireArtifacts() {
  for (const file of [mainEntry, preloadEntry, workerEntry, rendererEntry]) {
    try {
      const metadata = await stat(file);
      if (!metadata.isFile()) throw new Error("not a file");
    } catch {
      throw new Error(`Electron startup smoke requires a fresh build artifact: ${file}`);
    }
  }
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not reserve a CDP loopback port")));
        return;
      }
      server.close((cause) => {
        if (cause) reject(cause);
        else resolve(address.port);
      });
    });
  });
}

function readJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 500 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(new Error(`CDP returned HTTP ${response.statusCode ?? "unknown"}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (cause) {
          reject(cause);
        }
      });
    });
    request.once("timeout", () => request.destroy(new Error("CDP request timed out")));
    request.once("error", reject);
  });
}

async function waitForPage(port, run) {
  const deadline = Date.now() + timeoutMs;
  let lastFailure;
  while (Date.now() < deadline) {
    const { child } = run;
    if (!child) throw new Error("Electron launch did not return a child process");
    if (run.launchError) {
      throw new Error(`Electron failed to launch: ${run.launchError.message}`, {
        cause: run.launchError,
      });
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Electron exited before exposing its renderer (code=${child.exitCode}, signal=${child.signalCode})`,
      );
    }
    try {
      const targets = await readJson(`http://127.0.0.1:${port}/json/list`);
      const page = Array.isArray(targets)
        ? targets.find((target) =>
          target?.type === "page"
          && target?.title === "Nexus Editor Demo"
          && typeof target?.webSocketDebuggerUrl === "string")
        : undefined;
      if (page) return page;
    } catch (cause) {
      lastFailure = cause;
    }
    await delay(50);
  }
  throw new Error("Electron did not expose its renderer over CDP", { cause: lastFailure });
}

function evaluate(webSocketUrl, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("CDP evaluation timed out"));
    }, timeoutMs);
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Could not connect to the Electron renderer over CDP"));
    }, { once: true });
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true,
        },
      }));
    }, { once: true });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) {
        reject(new Error(`CDP evaluation failed: ${message.error.message}`));
        return;
      }
      const exception = message.result?.exceptionDetails;
      if (exception) {
        reject(new Error(
          exception.exception?.description
            ?? exception.text
            ?? "Electron renderer evaluation threw",
        ));
        return;
      }
      resolve(message.result?.result?.value);
    });
  });
}

function terminateProcessTree(child, force = false) {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync(
      "taskkill",
      ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])],
      { stdio: "ignore" },
    );
    return;
  }
  const signal = force ? "SIGKILL" : "SIGTERM";
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function ensureExited(child, closePromise) {
  if (child.exitCode === null && child.signalCode === null) {
    terminateProcessTree(child);
  }
  const stopped = await Promise.race([
    closePromise.then(() => true),
    delay(2_000).then(() => false),
  ]);
  if (!stopped) {
    terminateProcessTree(child, true);
    const forced = await Promise.race([
      closePromise.then(() => true),
      delay(1_000).then(() => false),
    ]);
    if (!forced) throw new Error("Electron process tree did not exit after SIGKILL");
  }
}

function appendLogTail(previous, chunk) {
  const combined = previous + chunk;
  return combined.length <= maxLogBytes
    ? combined
    : combined.slice(combined.length - maxLogBytes);
}

async function cleanupRun(run) {
  if (!run.cleanupPromise) {
    run.cleanupPromise = (async () => {
      const failures = [];
      if (run.child && run.closePromise) {
        try {
          await ensureExited(run.child, run.closePromise);
        } catch (cause) {
          failures.push(cause);
        }
      }
      try {
        await rm(run.userDataDir, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
      } catch (cause) {
        failures.push(cause);
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "Electron startup smoke run cleanup failed");
      }
    })();
  }
  try {
    await run.cleanupPromise;
  } finally {
    activeRuns.delete(run);
  }
}

async function cleanupActiveRuns() {
  const results = await Promise.allSettled([...activeRuns].map(cleanupRun));
  const failures = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, "Electron startup smoke cleanup failed");
  }
}

function launchElectron(electronPath, args, environment) {
  let executable = electronPath;
  let executableArgs = args;
  if (process.platform === "linux" && !process.env.DISPLAY) {
    const xvfb = spawnSync("which", ["xvfb-run"], { encoding: "utf8" });
    if (xvfb.status !== 0 || !xvfb.stdout.trim()) {
      throw new Error("Linux Electron startup smoke needs DISPLAY or xvfb-run");
    }
    executable = xvfb.stdout.trim();
    executableArgs = ["-a", electronPath, ...args];
  }
  return spawn(executable, executableArgs, {
    cwd: appDir,
    detached: process.platform !== "win32",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function runMode(electronPath, mode) {
  if (signalCleanupStarted) throw new Error("Electron startup smoke was interrupted");
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), `nexus-startup-${mode}-`));
  const run = {
    child: null,
    cleanupPromise: null,
    closePromise: null,
    launchError: null,
    userDataDir,
  };
  activeRuns.add(run);
  let stdout = "";
  let stderr = "";

  try {
    const port = await reserveLoopbackPort();
    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--enable-logging=stderr",
      mainEntry,
    ];
    if (process.platform === "linux") args.unshift("--no-sandbox");
    const environment = {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: "1",
    };
    delete environment.VITE_DEV_SERVER_URL;
    delete environment.NEXUS_PLUGIN_PLATFORM;
    delete environment.VITE_NEXUS_PLUGIN_PLATFORM;
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.NEXUS_COLLAB_SERVERS;
    if (mode === "legacy") environment.NEXUS_PLUGIN_PLATFORM = "0";

    const child = launchElectron(electronPath, args, environment);
    run.child = child;
    run.closePromise = new Promise((resolve) => {
      let settled = false;
      const finish = (outcome) => {
        if (settled) return;
        settled = true;
        resolve(outcome);
      };
      child.once("error", (error) => {
        run.launchError = error;
        finish({ error });
      });
      child.once("close", (code, signal) => finish({ code, signal }));
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = appendLogTail(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = appendLogTail(stderr, chunk); });

    const page = await waitForPage(port, run);
    const state = await evaluate(page.webSocketDebuggerUrl, `
      new Promise((resolve) => {
        const expectedMode = ${JSON.stringify(mode)};
        const deadline = Date.now() + 10000;
        const sample = async () => {
          const app = document.querySelector("#app");
          const startupState = app?.dataset.nexusStartupState ?? null;
          if (startupState === "ready" || startupState === "failed" || Date.now() >= deadline) {
            let bridgeRoundTrip = false;
            let bridgeRoundTripError = null;
            try {
              if (expectedMode === "runtime") {
                const network = await window.nexusCollabNetwork?.getConfiguration();
                if (JSON.stringify(network?.serverUrls) !== JSON.stringify(["ws://127.0.0.1:1234"])) {
                  throw new Error("network-configuration-unavailable");
                }
                const documentId = "startup-smoke-" + crypto.randomUUID();
                const opened = await window.nexusCollabStore?.request({
                  operation: "open",
                  documentId,
                });
                if (!opened?.ok) throw new Error(opened?.error?.code ?? "store-open-failed");
                const loaded = await window.nexusCollabStore.request({
                  operation: "load",
                  leaseId: opened.leaseId,
                });
                const closed = await window.nexusCollabStore.request({
                  operation: "close",
                  leaseId: opened.leaseId,
                });
                bridgeRoundTrip = loaded?.ok === true && closed?.ok === true;
              } else {
                const vaultState = await window.nexusDemo?.vault.getLast();
                bridgeRoundTrip = vaultState?.lastVault === null
                  && Array.isArray(vaultState?.recents)
                  && vaultState.recents.length === 0;
              }
            } catch (error) {
              bridgeRoundTripError = error instanceof Error ? error.message : String(error);
            }
            resolve({
              readyState: document.readyState,
              url: location.href,
              startupState,
              appChildren: app?.childElementCount ?? -1,
              hasStartupFailure: Boolean(document.querySelector("[data-nexus-startup-failure]")),
              hasToolbar: Boolean(document.querySelector(".toolbar")),
              hasMainArea: Boolean(document.querySelector(".main-area")),
              hasEditor: Boolean(document.querySelector(".editor-container .cm-editor")),
              hasStatusLine: Boolean(document.querySelector(".status-line")),
              hasCollaborate: [...document.querySelectorAll("button")]
                .some((button) => button.textContent?.trim() === "Collaborate"),
              hasRuntimeOwner: Boolean(document.querySelector(
                '[data-nexus-ui-owner="electron-host-ui"][data-nexus-product-surface="outline"]',
              )),
              hasWordcountAction: Boolean(document.querySelector(
                '[data-ui-action-id="wordcount:document-stats"]',
              )),
              hostMode: window.nexusHost?.mode ?? null,
              hasHostLifecycle: typeof window.nexusHost?.onShutdown === "function"
                && typeof window.nexusHost?.shutdownComplete === "function",
              hasDemoBridge: Boolean(window.nexusDemo),
              hasPluginBridge: Boolean(window.nexusPlugins),
              hasCollaborationStore: Boolean(window.nexusCollabStore),
              hasCollaborationNetwork: Boolean(window.nexusCollabNetwork),
              bridgeRoundTrip,
              bridgeRoundTripError,
            });
            return;
          }
          setTimeout(() => { void sample(); }, 50);
        };
        void sample();
      })
    `);
    const expected = mode === "runtime"
      ? {
          hostMode: "runtime",
          hasRuntimeOwner: true,
          hasDemoBridge: false,
          hasPluginBridge: true,
          hasCollaborationStore: true,
          hasCollaborationNetwork: true,
        }
      : {
          hostMode: "legacy",
          hasRuntimeOwner: false,
          hasDemoBridge: true,
          hasPluginBridge: false,
          hasCollaborationStore: false,
          hasCollaborationNetwork: false,
        };
    const mounted = state?.readyState === "complete"
      && state?.url === rendererUrl
      && state?.startupState === "ready"
      && state?.appChildren > 0
      && state?.hasStartupFailure === false
      && state?.hasToolbar === true
      && state?.hasMainArea === true
      && state?.hasEditor === true
      && state?.hasStatusLine === true
      && state?.hasCollaborate === true
      && state?.hasHostLifecycle === true
      && state?.bridgeRoundTrip === true;
    const bridgesMatch = Object.entries(expected)
      .every(([key, value]) => state?.[key] === value);
    if (!mounted || !bridgesMatch) {
      const relevantErrors = stderr
        .split(/\r?\n/u)
        .filter((line) => /preload|module not found|renderer failed|error/i.test(line))
        .slice(-12);
      throw Object.assign(new Error(`Electron ${mode} renderer did not start`), {
        details: { state, relevantErrors, stdout: stdout.split(/\r?\n/u).slice(-12) },
      });
    }
    return state;
  } finally {
    await cleanupRun(run);
  }
}

async function main() {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000) {
    throw new Error("NEXUS_ELECTRON_STARTUP_SMOKE_TIMEOUT_MS must be at least 1000");
  }
  await requireArtifacts();
  const electronPath = require("electron");
  if (typeof electronPath !== "string") throw new Error("Electron executable was not resolved");
  const modes = [];
  for (const mode of ["legacy", "runtime"]) {
    modes.push({ mode, state: await runMode(electronPath, mode) });
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    smoke: "electron-renderer-startup",
    modes,
  })}\n`);
}

let signalCleanupStarted = false;
const signalHandlers = new Map();
for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  const handler = () => {
    if (signalCleanupStarted) {
      process.exit(exitCode);
      return;
    }
    signalCleanupStarted = true;
    void cleanupActiveRuns()
      .catch((cause) => {
        process.stderr.write(`Electron startup smoke cleanup failed: ${String(cause)}\n`);
      })
      .finally(() => process.exit(exitCode));
  };
  signalHandlers.set(signal, handler);
  process.once(signal, handler);
}

function removeSignalHandlers() {
  for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  signalHandlers.clear();
}

void main().then(removeSignalHandlers).catch(async (cause) => {
  let cleanupFailure;
  try {
    await cleanupActiveRuns();
  } catch (error) {
    cleanupFailure = error;
  }
  removeSignalHandlers();
  process.stdout.write(`${JSON.stringify({
    ok: false,
    smoke: "electron-renderer-startup",
    error: {
      message: cause instanceof Error ? cause.message : String(cause),
      details: cause?.details,
      cleanup: cleanupFailure instanceof Error ? cleanupFailure.message : undefined,
    },
  })}\n`);
  process.exitCode = 1;
});
