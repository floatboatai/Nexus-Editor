export type CalAgentPanelStatus = "idle" | "starting" | "ready" | "error";

export interface CalAgentStatusPayload {
  status: CalAgentPanelStatus;
  url: string;
  message?: string;
}

export interface CalAgentManagerOptions {
  spawn: (command: string, args: string[], options: { cwd: string; shell?: boolean }) => {
    once(event: string, cb: (...args: any[]) => void): unknown;
    kill(signal?: string): unknown;
    exitCode?: number | null;
    signalCode?: string | null;
  };
  probeUrl: (url: string) => Promise<boolean>;
  pollIntervalMs: number;
  startupTimeoutMs: number;
  command: string;
  args: string[];
  cwd: string;
  url: string;
}

interface LaunchState {
  token: number;
  promise: Promise<CalAgentStatusPayload>;
  resolve: (payload: CalAgentStatusPayload) => void;
  settled: boolean;
  cancel: () => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDeferredLaunch(): LaunchState {
  let resolve!: (payload: CalAgentStatusPayload) => void;
  const promise = new Promise<CalAgentStatusPayload>((next) => {
    resolve = next;
  });
  return {
    token: 0,
    promise,
    resolve,
    settled: false,
    cancel() {
      /* replaced per-launch */
    },
  };
}

export function createCalAgentManager(options: CalAgentManagerOptions) {
  let child: ReturnType<CalAgentManagerOptions["spawn"]> | null = null;
  let currentStatus: CalAgentStatusPayload = {
    status: "idle",
    url: options.url,
  };
  let activeLaunch: LaunchState | null = null;
  let launchToken = 0;

  function setStatus(next: CalAgentStatusPayload): void {
    currentStatus = next;
  }

  function finishLaunch(next: CalAgentStatusPayload): CalAgentStatusPayload {
    setStatus(next);
    if (activeLaunch && !activeLaunch.settled) {
      activeLaunch.settled = true;
      activeLaunch.resolve(next);
    }
    activeLaunch = null;
    return next;
  }

  function startLaunchToken(): LaunchState {
    const launch = createDeferredLaunch();
    launch.token = ++launchToken;
    let cancelResolve: (() => void) | null = null;
    const cancelPromise = new Promise<void>((resolve) => {
      cancelResolve = resolve;
    });
    launch.cancel = () => {
      cancelResolve?.();
    };
    activeLaunch = launch;
    return launch;
  }

  async function stopChild(): Promise<void> {
    const proc = child;
    child = null;
    if (!proc) return;

    try {
      proc.kill();
    } catch {
      return;
    }

    if (proc.exitCode !== null || proc.signalCode !== null) {
      return;
    }

    await new Promise<void>((resolve) => {
      const done = () => resolve();
      proc.once("exit", done);
      proc.once("close", done);
      proc.once("error", done);
      setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* noop */
        }
      }, 2_000);
    });
  }

  async function launch(restart = false): Promise<CalAgentStatusPayload> {
    if (!restart) {
      if (currentStatus.status === "ready" && child) {
        return currentStatus;
      }
      if (currentStatus.status === "starting" && activeLaunch) {
        return activeLaunch.promise;
      }
    }

    if (restart) {
      activeLaunch?.cancel();
      await stopChild();
    }

    if (!restart && child) {
      await stopChild();
    }

    const launchState = startLaunchToken();
    const childProcess = options.spawn(options.command, options.args, {
      cwd: options.cwd,
      shell: process.platform === "win32",
    });
    child = childProcess;
    setStatus({
      status: "starting",
      url: options.url,
      message: "Starting CAL-AGENT workbench...",
    });

    childProcess.once("exit", (code, signal) => {
      if (launchState.settled) return;
      launchState.cancel();
      child = null;
      finishLaunch({
        status: "error",
        url: options.url,
        message: `CAL-AGENT exited early${code !== null ? ` with code ${code}` : signal ? ` (${signal})` : ""}`,
      });
    });

    childProcess.once("error", (error) => {
      if (launchState.settled) return;
      launchState.cancel();
      child = null;
      finishLaunch({
        status: "error",
        url: options.url,
        message: error instanceof Error ? error.message : String(error),
      });
    });

    const deadline = Date.now() + options.startupTimeoutMs;
    while (launchState.token === launchToken && !launchState.settled) {
      const probeResult = await Promise.race([
        options.probeUrl(options.url).then((ok) => (ok ? "ready" : "not-ready") as const),
        new Promise<"cancelled">((resolve) => {
          const cancel = launchState.cancel;
          launchState.cancel = () => {
            cancel();
            resolve("cancelled");
          };
        }),
      ]);

      if (probeResult === "cancelled") {
        return currentStatus;
      }

      if (probeResult === "ready") {
        return finishLaunch({
          status: "ready",
          url: options.url,
          message: "CAL-AGENT is ready",
        });
      }

      if (Date.now() >= deadline) {
        finishLaunch({
          status: "error",
          url: options.url,
          message: `CAL-AGENT did not become ready within ${Math.round(options.startupTimeoutMs / 1000)}s`,
        });
        await stopChild();
        return currentStatus;
      }

      const waitResult = await Promise.race([
        delay(options.pollIntervalMs).then(() => "tick" as const),
        new Promise<"cancelled">((resolve) => {
          const cancel = launchState.cancel;
          launchState.cancel = () => {
            cancel();
            resolve("cancelled");
          };
        }),
      ]);

      if (waitResult === "cancelled") {
        return currentStatus;
      }
    }

    return currentStatus;
  }

  return {
    start() {
      return launch(false);
    },
    retry() {
      return launch(true);
    },
    getStatus() {
      return currentStatus;
    },
  };
}