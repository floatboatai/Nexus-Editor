import { app, BrowserWindow, ipcMain, shell } from "electron";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type CalAgentPanelStatus = "idle" | "starting" | "ready" | "error";

export interface CalAgentStatusPayload {
  status: CalAgentPanelStatus;
  url: string;
  message?: string;
}

export interface CalAgentController {
  start(): Promise<CalAgentStatusPayload>;
  retry(): Promise<CalAgentStatusPayload>;
  getStatus(): CalAgentStatusPayload;
  openExternal(): Promise<void>;
  dispose(): void;
}

interface CalAgentControllerOptions {
  getWindow: () => BrowserWindow | null;
}

const CAL_AGENT_ROOT = process.env.CAL_AGENT_ROOT ?? "/Users/wangqiao/workspace/CAL-AGENT";
const CAL_AGENT_URL = process.env.CAL_AGENT_URL ?? "http://127.0.0.1:3000";
const STARTUP_TIMEOUT_MS = 30_000;
const PROBE_INTERVAL_MS = 1_000;
const PROBE_TIMEOUT_MS = 2_000;

function getPort(url: string): number {
  const parsed = new URL(url);
  if (parsed.port) return Number(parsed.port);
  return parsed.protocol === "https:" ? 443 : 80;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeUrl(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function killExistingListener(url: string): Promise<void> {
  const port = getPort(url);
  const result = spawnSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf-8" });
  if (result.error || result.status !== 0) return;

  const pids = result.stdout
    .split(/\s+/)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* noop */
    }
  }
}

function formatStartError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createCalAgentController(options: CalAgentControllerOptions): CalAgentController {
  let processHandle: ChildProcessWithoutNullStreams | null = null;
  let launchToken = 0;
  let disposed = false;
  let stopRequested = false;
  let status: CalAgentStatusPayload = {
    status: "idle",
    url: CAL_AGENT_URL,
  };

  function broadcast(next: CalAgentStatusPayload): void {
    status = next;
    const win = options.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("cal-agent:status-changed", next);
    }
  }

  function ensureRootExists(): void {
    if (!existsSync(CAL_AGENT_ROOT)) {
      throw new Error(`CAL-AGENT root not found: ${CAL_AGENT_ROOT}`);
    }
  }

  function clearProcess(proc: ChildProcessWithoutNullStreams): void {
    if (processHandle === proc) {
      processHandle = null;
    }
  }

  function attachProcessHandlers(proc: ChildProcessWithoutNullStreams, token: number): void {
    proc.once("error", (error) => {
      clearProcess(proc);
      if (disposed || token !== launchToken || stopRequested) return;
      broadcast({
        status: "error",
        url: CAL_AGENT_URL,
        message: `Failed to start CAL-AGENT: ${formatStartError(error)}`,
      });
    });

    proc.once("exit", (code, signal) => {
      clearProcess(proc);
      if (disposed || stopRequested) return;
      if (token !== launchToken) return;
      broadcast({
        status: "error",
        url: CAL_AGENT_URL,
        message: `CAL-AGENT exited early${code !== null ? ` with code ${code}` : signal ? ` (${signal})` : ""}`,
      });
    });
  }

  async function stopProcess(): Promise<void> {
    const proc = processHandle;
    if (!proc) return;

    stopRequested = true;
    processHandle = null;

    if (proc.exitCode !== null || proc.signalCode !== null) {
      stopRequested = false;
      return;
    }

    await new Promise<void>((resolve) => {
      const finish = () => {
        proc.off("exit", finish);
        proc.off("close", finish);
        proc.off("error", finish);
        stopRequested = false;
        resolve();
      };

      proc.once("exit", finish);
      proc.once("close", finish);
      proc.once("error", finish);

      try {
        proc.kill();
      } catch {
        finish();
        return;
      }

      setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) {
          try {
            proc.kill("SIGKILL");
          } catch {
            /* noop */
          }
        }
      }, 2_000);
    });
  }

  async function launchProcess(): Promise<CalAgentStatusPayload> {
    if (disposed) return status;

    await stopProcess();
    ensureRootExists();
    await killExistingListener(CAL_AGENT_URL);

    const token = ++launchToken;
    broadcast({
      status: "starting",
      url: CAL_AGENT_URL,
      message: "Starting CAL-AGENT workbench...",
    });

    const proc = spawn("npm", ["run", "web:dev"], {
      cwd: CAL_AGENT_ROOT,
      env: {
        ...process.env,
        CAL_AGENT_ROOT,
        CAL_AGENT_URL,
      },
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    processHandle = proc;
    attachProcessHandlers(proc, token);

    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (!disposed && token === launchToken) {
      if (!processHandle) {
        return status;
      }

      if (await probeUrl(CAL_AGENT_URL, PROBE_TIMEOUT_MS)) {
        const ready = {
          status: "ready" as const,
          url: CAL_AGENT_URL,
          message: "CAL-AGENT is ready",
        };
        broadcast(ready);
        return ready;
      }

      if (Date.now() >= deadline) {
        broadcast({
          status: "error",
          url: CAL_AGENT_URL,
          message: `CAL-AGENT did not become ready within ${Math.round(STARTUP_TIMEOUT_MS / 1000)}s`,
        });
        await stopProcess();
        return status;
      }

      await delay(PROBE_INTERVAL_MS);
    }

    return status;
  }

  ipcMain.handle("cal-agent:get-status", async () => status);
  ipcMain.handle("cal-agent:start", async () => launchProcess());
  ipcMain.handle("cal-agent:retry", async () => launchProcess());
  ipcMain.handle("cal-agent:open-external", async () => {
    await shell.openExternal(CAL_AGENT_URL);
  });

  return {
    async start() {
      if (status.status === "starting" || status.status === "ready") {
        return status;
      }
      return launchProcess();
    },
    async retry() {
      return launchProcess();
    },
    getStatus() {
      return status;
    },
    async openExternal() {
      await shell.openExternal(CAL_AGENT_URL);
    },
    dispose() {
      disposed = true;
      stopRequested = true;
      const proc = processHandle;
      processHandle = null;
      if (proc) {
        try {
          proc.kill();
        } catch {
          /* noop */
        }
      }
    },
  };
}