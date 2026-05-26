# CAL-AGENT Embedded Panel POC Implementation Plan

> **For agentic workers:** REQUIRED: Use the `subagent-driven-development` agent (recommended) or `executing-plans` agent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a development-only CAL-AGENT side panel to the Electron demo that auto-starts the external web app from the main process, shows startup and failure states in the renderer, embeds the existing CAL-AGENT UI when reachable, and keeps the editor usable if CAL-AGENT fails.

**Architecture:** Keep the process boundary explicit. A new main-process manager owns `npm run web:dev`, readiness polling, retry, duplicate-start suppression, and shutdown cleanup. A narrow preload bridge exposes status and actions to a new right-side renderer panel that renders `starting`, `ready`, and `error` states and embeds `http://127.0.0.1:3000` via `iframe` unless the manual smoke test proves embedding is blocked.

**Tech Stack:** TypeScript, Electron 35, Vite renderer, plain DOM UI modules, Vitest, Node `child_process`, Electron IPC

---

## File Structure

- Create: `apps/electron-demo/electron/cal-agent-types.ts`
  Responsibility: shared status payloads, manager state, and bridge-facing TypeScript types for CAL-AGENT.
- Create: `apps/electron-demo/electron/cal-agent-config.ts`
  Responsibility: development-only constants for repo path, target URL, command, and startup timeout so the fixed local path stays in one place.
- Create: `apps/electron-demo/electron/cal-agent-manager.ts`
  Responsibility: own child-process spawn, health polling, state transitions, duplicate-start suppression, retry, observer notifications, and cleanup.
- Create: `apps/electron-demo/electron/cal-agent-preload.ts`
  Responsibility: build the renderer-safe bridge over `ipcRenderer` and isolate preload logic from `preload.ts` side effects.
- Create: `apps/electron-demo/electron/cal-agent-main-ipc.ts`
  Responsibility: register CAL-AGENT IPC handlers and status broadcasts against `ipcMain`, `BrowserWindow`, and `shell` without bloating `electron/main.ts` further.
- Modify: `apps/electron-demo/electron/main.ts`
  Responsibility: instantiate the CAL-AGENT manager at app startup, register IPC, start the manager after `app.whenReady()`, and dispose it during shutdown.
- Modify: `apps/electron-demo/electron/preload.ts`
  Responsibility: expose `window.nexusDemo.calAgent` next to the existing vault and file bridge.
- Modify: `apps/electron-demo/src/renderer/bridge.d.ts`
  Responsibility: type the new bridge surface in the renderer.
- Create: `apps/electron-demo/src/renderer/cal-agent-panel.ts`
  Responsibility: render the right-side panel shell, status indicator, `Retry`, `Open in Browser`, and embedded `iframe`.
- Create: `apps/electron-demo/src/renderer/cal-agent-controller.ts`
  Responsibility: bind the panel to the preload bridge, request initial status, subscribe to updates, and keep the panel non-blocking.
- Modify: `apps/electron-demo/src/renderer/app.ts`
  Responsibility: mount the new panel into the existing `main-area`, add a toolbar toggle, and boot CAL-AGENT asynchronously so editor startup still completes.
- Modify: `apps/electron-demo/src/renderer/style.css`
  Responsibility: add layout and panel styles only where shared CSS is better than inline styles.
- Create: `apps/electron-demo/test/cal-agent-manager.test.ts`
  Responsibility: focused manager-state regressions for ready, timeout, duplicate start, retry, and cleanup.
- Create: `apps/electron-demo/test/cal-agent-preload.test.ts`
  Responsibility: bridge contract tests for IPC names, status payload flow, and unsubscribe behavior.
- Create: `apps/electron-demo/test/cal-agent-panel.test.ts`
  Responsibility: jsdom coverage for renderer state rendering and action wiring.
- Create: `apps/electron-demo/test/cal-agent-main-ipc.test.ts`
  Responsibility: validate IPC registration and external-browser action without needing to boot Electron.

## Delivery Sequence

1. Build the main-process manager first so process ownership, timeout behavior, and retry semantics are stable before wiring UI.
2. Expose the preload bridge second so renderer work can proceed against a typed contract instead of raw IPC strings.
3. Build the renderer panel and controller third so UI states can be verified in jsdom before touching the app shell.
4. Wire Electron main and renderer boot fourth, then do an early smoke test immediately.
5. Use the smoke result as the CSP checkpoint: if the `iframe` renders, continue to manual validation and cleanup checks; if it is blocked, stop and switch to the fallback branch described in the risk section instead of pushing deeper into the wrong approach.

### Task 1: Build the CAL-AGENT manager core

**Purpose:** Lock down the high-risk behavior first: process ownership, readiness polling, timeout, duplicate-start suppression, retry, and shutdown cleanup.

**Files:**
- Create: `apps/electron-demo/electron/cal-agent-types.ts`
- Create: `apps/electron-demo/electron/cal-agent-config.ts`
- Create: `apps/electron-demo/electron/cal-agent-manager.ts`
- Test: `apps/electron-demo/test/cal-agent-manager.test.ts`

- [ ] **Step 1: Write the failing manager regression tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCalAgentManager } from "../electron/cal-agent-manager";

function createFakeChild() {
  const listeners = new Map<string, Function[]>();
  return {
    pid: 4321,
    once(event: string, cb: Function) {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      for (const cb of listeners.get(event) ?? []) cb(...args);
    },
    kill: vi.fn(() => true)
  };
}

describe("createCalAgentManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("transitions from starting to ready after the health probe succeeds", async () => {
    const child = createFakeChild();
    const spawn = vi.fn(() => child as any);
    const probe = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const manager = createCalAgentManager({
      spawn,
      probeUrl: probe,
      pollIntervalMs: 100,
      startupTimeoutMs: 1_000,
      command: "npm",
      args: ["run", "web:dev"],
      cwd: "/Users/wangqiao/workspace/CAL-AGENT",
      url: "http://127.0.0.1:3000"
    });

    const startPromise = manager.start();
    await vi.advanceTimersByTimeAsync(200);
    await expect(startPromise).resolves.toMatchObject({ status: "ready" });
    expect(manager.getStatus().status).toBe("ready");
  });

  it("does not spawn a second child while already starting", async () => {
    const child = createFakeChild();
    const manager = createCalAgentManager({
      spawn: vi.fn(() => child as any),
      probeUrl: vi.fn(() => new Promise<boolean>(() => {})),
      pollIntervalMs: 100,
      startupTimeoutMs: 5_000,
      command: "npm",
      args: ["run", "web:dev"],
      cwd: "/Users/wangqiao/workspace/CAL-AGENT",
      url: "http://127.0.0.1:3000"
    });

    void manager.start();
    void manager.start();

    expect(manager.dependencies.spawn).toHaveBeenCalledTimes(1);
  });

  it("moves to error on startup timeout and allows retry", async () => {
    const firstChild = createFakeChild();
    const secondChild = createFakeChild();
    const spawn = vi.fn()
      .mockReturnValueOnce(firstChild as any)
      .mockReturnValueOnce(secondChild as any);
    const probe = vi.fn().mockResolvedValue(false);

    const manager = createCalAgentManager({
      spawn,
      probeUrl: probe,
      pollIntervalMs: 100,
      startupTimeoutMs: 300,
      command: "npm",
      args: ["run", "web:dev"],
      cwd: "/Users/wangqiao/workspace/CAL-AGENT",
      url: "http://127.0.0.1:3000"
    });

    const first = manager.start();
    await vi.advanceTimersByTimeAsync(400);
    await expect(first).resolves.toMatchObject({ status: "error" });

    probe.mockResolvedValueOnce(true);
    const retry = manager.retry();
    await vi.advanceTimersByTimeAsync(100);
    await expect(retry).resolves.toMatchObject({ status: "ready" });
  });
});
```

- [ ] **Step 2: Run the focused manager test to verify it fails**

Run: `pnpm --dir apps/electron-demo test -- test/cal-agent-manager.test.ts`
Expected: FAIL because the manager module and shared CAL-AGENT types do not exist yet.

- [ ] **Step 3: Implement the minimal manager, shared types, and config constants**

```ts
// apps/electron-demo/electron/cal-agent-types.ts
export type CalAgentPanelStatus = "idle" | "starting" | "ready" | "error";

export interface CalAgentStatusPayload {
  status: CalAgentPanelStatus;
  url: string;
  message?: string;
}

export interface CalAgentManager {
  start(): Promise<CalAgentStatusPayload>;
  retry(): Promise<CalAgentStatusPayload>;
  getStatus(): CalAgentStatusPayload;
  subscribe(listener: (payload: CalAgentStatusPayload) => void): () => void;
  dispose(): void;
}
```

```ts
// apps/electron-demo/electron/cal-agent-config.ts
export const CAL_AGENT_CONFIG = {
  cwd: "/Users/wangqiao/workspace/CAL-AGENT",
  command: "npm",
  args: ["run", "web:dev"],
  url: "http://127.0.0.1:3000",
  pollIntervalMs: 500,
  startupTimeoutMs: 45_000
} as const;
```

```ts
// apps/electron-demo/electron/cal-agent-manager.ts
import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import type { CalAgentManager, CalAgentStatusPayload } from "./cal-agent-types";

export function createCalAgentManager(dependencies = {
  spawn: nodeSpawn,
  probeUrl: async (url: string) => {
    const response = await fetch(url);
    return response.ok;
  },
  ...CAL_AGENT_CONFIG
}) {
  let child: ChildProcessWithoutNullStreams | null = null;
  let inFlightStart: Promise<CalAgentStatusPayload> | null = null;
  let status: CalAgentStatusPayload = { status: "idle", url: dependencies.url };
  const listeners = new Set<(payload: CalAgentStatusPayload) => void>();

  const publish = (next: CalAgentStatusPayload) => {
    status = next;
    for (const listener of listeners) listener(status);
  };

  async function waitUntilReady(): Promise<CalAgentStatusPayload> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < dependencies.startupTimeoutMs) {
      if (await dependencies.probeUrl(dependencies.url)) {
        publish({ status: "ready", url: dependencies.url });
        return status;
      }
      await delay(dependencies.pollIntervalMs);
    }
    publish({ status: "error", url: dependencies.url, message: "CAL-AGENT startup timed out." });
    return status;
  }

  return {
    dependencies,
    getStatus() {
      return status;
    },
    subscribe(listener: (payload: CalAgentStatusPayload) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async start() {
      if (inFlightStart) return inFlightStart;
      if (status.status === "ready") return status;

      publish({ status: "starting", url: dependencies.url, message: "Starting CAL-AGENT…" });
      child = dependencies.spawn(dependencies.command, dependencies.args, {
        cwd: dependencies.cwd,
        env: process.env,
        stdio: "pipe"
      }) as ChildProcessWithoutNullStreams;

      child.once("exit", (code) => {
        if (status.status !== "ready") {
          publish({ status: "error", url: dependencies.url, message: `CAL-AGENT exited early (${code ?? "signal"}).` });
        }
      });

      inFlightStart = waitUntilReady().finally(() => {
        inFlightStart = null;
      });

      return inFlightStart;
    },
    async retry() {
      if (child) child.kill();
      child = null;
      publish({ status: "idle", url: dependencies.url });
      return this.start();
    },
    dispose() {
      if (child) child.kill();
      child = null;
      publish({ status: "idle", url: dependencies.url });
    }
  } satisfies CalAgentManager & { dependencies: typeof dependencies };
}
```

- [ ] **Step 4: Run the focused manager test to verify it passes**

Run: `pnpm --dir apps/electron-demo test -- test/cal-agent-manager.test.ts`
Expected: PASS with manager state transitions, timeout, duplicate-start suppression, and retry behavior covered.

- [ ] **Step 5: Commit the manager slice**

```bash
git add apps/electron-demo/electron/cal-agent-types.ts apps/electron-demo/electron/cal-agent-config.ts apps/electron-demo/electron/cal-agent-manager.ts apps/electron-demo/test/cal-agent-manager.test.ts
git commit -m "feat(electron-demo): add cal-agent manager core"
```

### Task 2: Expose a narrow preload bridge

**Purpose:** Freeze the renderer contract before touching UI so the panel code can consume a typed API instead of inline IPC strings.

**Files:**
- Create: `apps/electron-demo/electron/cal-agent-preload.ts`
- Modify: `apps/electron-demo/electron/preload.ts`
- Modify: `apps/electron-demo/src/renderer/bridge.d.ts`
- Test: `apps/electron-demo/test/cal-agent-preload.test.ts`

- [ ] **Step 1: Write the failing preload bridge tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { createCalAgentBridge } from "../electron/cal-agent-preload";

describe("createCalAgentBridge", () => {
  it("invokes the expected IPC channels", async () => {
    const invoke = vi.fn().mockResolvedValue({ status: "idle", url: "http://127.0.0.1:3000" });
    const on = vi.fn();
    const off = vi.fn();
    const bridge = createCalAgentBridge({ invoke, on, off } as any);

    await bridge.start();
    await bridge.retry();
    await bridge.getStatus();
    await bridge.openExternal();

    expect(invoke).toHaveBeenNthCalledWith(1, "cal-agent:start");
    expect(invoke).toHaveBeenNthCalledWith(2, "cal-agent:retry");
    expect(invoke).toHaveBeenNthCalledWith(3, "cal-agent:get-status");
    expect(invoke).toHaveBeenNthCalledWith(4, "cal-agent:open-external");
  });

  it("returns an unsubscribe function for status changes", () => {
    const on = vi.fn();
    const off = vi.fn();
    const bridge = createCalAgentBridge({ invoke: vi.fn(), on, off } as any);

    const dispose = bridge.onStatusChange(() => undefined);
    dispose();

    expect(on).toHaveBeenCalledWith("cal-agent:status", expect.any(Function));
    expect(off).toHaveBeenCalledWith("cal-agent:status", expect.any(Function));
  });
});
```

- [ ] **Step 2: Run the bridge test to verify it fails**

Run: `pnpm --dir apps/electron-demo test -- test/cal-agent-preload.test.ts`
Expected: FAIL because the CAL-AGENT preload factory and renderer bridge typing do not exist yet.

- [ ] **Step 3: Implement the preload bridge and expose it on `window.nexusDemo`**

```ts
// apps/electron-demo/electron/cal-agent-preload.ts
import type { IpcRenderer } from "electron";
import type { CalAgentStatusPayload } from "./cal-agent-types";

export interface CalAgentBridge {
  start(): Promise<CalAgentStatusPayload>;
  retry(): Promise<CalAgentStatusPayload>;
  getStatus(): Promise<CalAgentStatusPayload>;
  openExternal(): Promise<void>;
  onStatusChange(cb: (payload: CalAgentStatusPayload) => void): () => void;
}

export function createCalAgentBridge(ipcRenderer: Pick<IpcRenderer, "invoke" | "on" | "off">): CalAgentBridge {
  return {
    start() {
      return ipcRenderer.invoke("cal-agent:start");
    },
    retry() {
      return ipcRenderer.invoke("cal-agent:retry");
    },
    getStatus() {
      return ipcRenderer.invoke("cal-agent:get-status");
    },
    openExternal() {
      return ipcRenderer.invoke("cal-agent:open-external");
    },
    onStatusChange(cb) {
      const listener = (_event: Electron.IpcRendererEvent, payload: CalAgentStatusPayload) => cb(payload);
      ipcRenderer.on("cal-agent:status", listener);
      return () => ipcRenderer.off("cal-agent:status", listener);
    }
  };
}
```

```ts
// apps/electron-demo/electron/preload.ts
import { createCalAgentBridge } from "./cal-agent-preload";

const bridge: DemoBridge = {
  openFile() {
    return ipcRenderer.invoke("demo:open-file");
  },
  saveFile(path: string, content: string) {
    return ipcRenderer.invoke("demo:save-file", path, content);
  },
  saveFileAs(content: string) {
    return ipcRenderer.invoke("demo:save-file-as", content);
  },
  vault: vaultBridge,
  calAgent: createCalAgentBridge(ipcRenderer)
};
```

```ts
// apps/electron-demo/src/renderer/bridge.d.ts
interface CalAgentStatusPayload {
  status: "idle" | "starting" | "ready" | "error";
  url: string;
  message?: string;
}

interface CalAgentBridge {
  start(): Promise<CalAgentStatusPayload>;
  retry(): Promise<CalAgentStatusPayload>;
  getStatus(): Promise<CalAgentStatusPayload>;
  openExternal(): Promise<void>;
  onStatusChange(cb: (payload: CalAgentStatusPayload) => void): () => void;
}

interface DemoBridge {
  openFile(): Promise<DemoFileHandle | null>;
  saveFile(path: string, content: string): Promise<{ path: string }>;
  saveFileAs(content: string): Promise<{ path: string } | null>;
  vault: VaultBridge;
  calAgent: CalAgentBridge;
}
```

- [ ] **Step 4: Run the bridge test to verify it passes**

Run: `pnpm --dir apps/electron-demo test -- test/cal-agent-preload.test.ts`
Expected: PASS with stable IPC channel names and unsubscribe behavior.

- [ ] **Step 5: Commit the preload slice**

```bash
git add apps/electron-demo/electron/cal-agent-preload.ts apps/electron-demo/electron/preload.ts apps/electron-demo/src/renderer/bridge.d.ts apps/electron-demo/test/cal-agent-preload.test.ts
git commit -m "feat(electron-demo): expose cal-agent preload bridge"
```

### Task 3: Build the renderer panel and controller

**Purpose:** Get the visible panel states working in isolation before wiring them into the full app shell.

**Files:**
- Create: `apps/electron-demo/src/renderer/cal-agent-panel.ts`
- Create: `apps/electron-demo/src/renderer/cal-agent-controller.ts`
- Modify: `apps/electron-demo/src/renderer/style.css`
- Test: `apps/electron-demo/test/cal-agent-panel.test.ts`

- [ ] **Step 1: Write the failing renderer tests for state rendering and action wiring**

```ts
import { describe, expect, it, vi } from "vitest";
import { createCalAgentPanel } from "../src/renderer/cal-agent-panel";
import { createCalAgentController } from "../src/renderer/cal-agent-controller";

describe("createCalAgentPanel", () => {
  it("shows starting and error states without blocking the rest of the DOM", () => {
    const panel = createCalAgentPanel();

    panel.render({ status: "starting", url: "http://127.0.0.1:3000", message: "Starting CAL-AGENT…" });
    expect(panel.element.textContent).toContain("Starting CAL-AGENT");

    panel.render({ status: "error", url: "http://127.0.0.1:3000", message: "Timed out" });
    expect(panel.element.textContent).toContain("Timed out");
    expect(panel.element.querySelector("button[data-action='retry']")).not.toBeNull();
  });

  it("embeds the app with an iframe once ready", () => {
    const panel = createCalAgentPanel();
    panel.render({ status: "ready", url: "http://127.0.0.1:3000" });

    const frame = panel.element.querySelector("iframe[data-cal-agent-frame]") as HTMLIFrameElement | null;
    expect(frame?.src).toBe("http://127.0.0.1:3000/");
  });
});

describe("createCalAgentController", () => {
  it("loads current status, subscribes to updates, and forwards retry/open actions", async () => {
    const panel = createCalAgentPanel();
    const bridge = {
      getStatus: vi.fn().mockResolvedValue({ status: "starting", url: "http://127.0.0.1:3000" }),
      retry: vi.fn().mockResolvedValue({ status: "starting", url: "http://127.0.0.1:3000" }),
      openExternal: vi.fn().mockResolvedValue(undefined),
      onStatusChange: vi.fn((cb) => {
        cb({ status: "ready", url: "http://127.0.0.1:3000" });
        return () => undefined;
      })
    };

    const controller = createCalAgentController({ panel, bridge: bridge as any });
    await controller.boot();

    expect(panel.element.textContent).toContain("Ready");

    (panel.element.querySelector("button[data-action='retry']") as HTMLButtonElement).click();
    (panel.element.querySelector("button[data-action='open-external']") as HTMLButtonElement).click();

    expect(bridge.retry).toHaveBeenCalled();
    expect(bridge.openExternal).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the renderer test to verify it fails**

Run: `pnpm --dir apps/electron-demo test -- test/cal-agent-panel.test.ts`
Expected: FAIL because the panel and controller modules do not exist yet.

- [ ] **Step 3: Implement the panel, controller, and panel-specific styles**

```ts
// apps/electron-demo/src/renderer/cal-agent-panel.ts
interface CalAgentPanel {
  element: HTMLElement;
  render(payload: CalAgentStatusPayload): void;
  onRetry(cb: () => void): void;
  onOpenExternal(cb: () => void): void;
}

export function createCalAgentPanel(): CalAgentPanel {
  const panel = document.createElement("aside");
  panel.className = "cal-agent-panel";

  const header = document.createElement("div");
  header.className = "cal-agent-panel__header";
  header.innerHTML = `
    <div class="cal-agent-panel__title">Calendar Agent</div>
    <div class="cal-agent-panel__status" data-cal-agent-status>Idle</div>
    <button type="button" data-action="retry">Retry</button>
    <button type="button" data-action="open-external">Open in Browser</button>
  `;

  const body = document.createElement("div");
  body.className = "cal-agent-panel__body";
  panel.append(header, body);

  return {
    element: panel,
    render(payload) {
      const statusEl = header.querySelector("[data-cal-agent-status]") as HTMLElement;
      statusEl.textContent = payload.status === "ready" ? "Ready" : payload.status;

      if (payload.status === "ready") {
        body.innerHTML = `<iframe data-cal-agent-frame src="${payload.url}" title="Calendar Agent"></iframe>`;
        return;
      }

      body.innerHTML = `<div class="cal-agent-panel__message">${payload.message ?? "Waiting for CAL-AGENT…"}</div>`;
    },
    onRetry(cb) {
      header.querySelector("[data-action='retry']")?.addEventListener("click", cb);
    },
    onOpenExternal(cb) {
      header.querySelector("[data-action='open-external']")?.addEventListener("click", cb);
    }
  };
}
```

```ts
// apps/electron-demo/src/renderer/cal-agent-controller.ts
export function createCalAgentController({ panel, bridge }: { panel: CalAgentPanel; bridge: CalAgentBridge }) {
  let disposeStatus: (() => void) | null = null;

  panel.onRetry(() => {
    void bridge.retry();
  });

  panel.onOpenExternal(() => {
    void bridge.openExternal();
  });

  return {
    async boot() {
      panel.render(await bridge.getStatus());
      disposeStatus = bridge.onStatusChange((payload) => panel.render(payload));
    },
    destroy() {
      disposeStatus?.();
      disposeStatus = null;
    }
  };
}
```

```css
/* apps/electron-demo/src/renderer/style.css */
.cal-agent-panel {
  width: 320px;
  flex-shrink: 0;
  border-left: 1px solid #eee;
  background: #fff;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.cal-agent-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #eee;
}

.cal-agent-panel__title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.cal-agent-panel__body {
  flex: 1;
  min-height: 0;
}

.cal-agent-panel__body iframe {
  width: 100%;
  height: 100%;
  border: 0;
}
```

- [ ] **Step 4: Run the renderer test to verify it passes**

Run: `pnpm --dir apps/electron-demo test -- test/cal-agent-panel.test.ts`
Expected: PASS with `starting`, `ready`, and `error` rendering plus `Retry` and `Open in Browser` action wiring covered.

- [ ] **Step 5: Commit the renderer panel slice**

```bash
git add apps/electron-demo/src/renderer/cal-agent-panel.ts apps/electron-demo/src/renderer/cal-agent-controller.ts apps/electron-demo/src/renderer/style.css apps/electron-demo/test/cal-agent-panel.test.ts
git commit -m "feat(electron-demo): add cal-agent renderer panel"
```

### Task 4: Register main-process IPC and lifecycle wiring

**Purpose:** Connect the tested manager to Electron without turning `electron/main.ts` into a second monolith.

**Files:**
- Create: `apps/electron-demo/electron/cal-agent-main-ipc.ts`
- Modify: `apps/electron-demo/electron/main.ts`
- Test: `apps/electron-demo/test/cal-agent-main-ipc.test.ts`

- [ ] **Step 1: Write the failing IPC wiring tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { registerCalAgentMainIpc } from "../electron/cal-agent-main-ipc";

describe("registerCalAgentMainIpc", () => {
  it("registers start, retry, get-status, and open-external handlers", () => {
    const handle = vi.fn();
    const manager = {
      start: vi.fn(),
      retry: vi.fn(),
      getStatus: vi.fn(),
      subscribe: vi.fn(() => () => undefined)
    };

    registerCalAgentMainIpc({
      ipcMain: { handle } as any,
      shell: { openExternal: vi.fn() } as any,
      manager,
      getWindow: () => ({ webContents: { send: vi.fn() } }) as any
    });

    expect(handle).toHaveBeenCalledWith("cal-agent:start", expect.any(Function));
    expect(handle).toHaveBeenCalledWith("cal-agent:retry", expect.any(Function));
    expect(handle).toHaveBeenCalledWith("cal-agent:get-status", expect.any(Function));
    expect(handle).toHaveBeenCalledWith("cal-agent:open-external", expect.any(Function));
  });

  it("opens the current CAL-AGENT URL in the external browser", async () => {
    const handlers = new Map<string, Function>();
    const shell = { openExternal: vi.fn().mockResolvedValue(undefined) };
    const manager = {
      start: vi.fn(),
      retry: vi.fn(),
      getStatus: vi.fn(() => ({ status: "ready", url: "http://127.0.0.1:3000" })),
      subscribe: vi.fn(() => () => undefined)
    };

    registerCalAgentMainIpc({
      ipcMain: { handle: (channel: string, fn: Function) => handlers.set(channel, fn) } as any,
      shell: shell as any,
      manager,
      getWindow: () => null
    });

    await handlers.get("cal-agent:open-external")?.();
    expect(shell.openExternal).toHaveBeenCalledWith("http://127.0.0.1:3000");
  });
});
```

- [ ] **Step 2: Run the IPC test to verify it fails**

Run: `pnpm --dir apps/electron-demo test -- test/cal-agent-main-ipc.test.ts`
Expected: FAIL because the IPC registration helper does not exist yet.

- [ ] **Step 3: Implement IPC registration and wire it into `electron/main.ts`**

```ts
// apps/electron-demo/electron/cal-agent-main-ipc.ts
import type { IpcMain, BrowserWindow, Shell } from "electron";
import type { CalAgentManager } from "./cal-agent-types";

export function registerCalAgentMainIpc({
  ipcMain,
  shell,
  manager,
  getWindow
}: {
  ipcMain: Pick<IpcMain, "handle">;
  shell: Pick<Shell, "openExternal">;
  manager: CalAgentManager;
  getWindow: () => BrowserWindow | null;
}) {
  manager.subscribe((payload) => {
    getWindow()?.webContents.send("cal-agent:status", payload);
  });

  ipcMain.handle("cal-agent:start", () => manager.start());
  ipcMain.handle("cal-agent:retry", () => manager.retry());
  ipcMain.handle("cal-agent:get-status", () => manager.getStatus());
  ipcMain.handle("cal-agent:open-external", async () => {
    await shell.openExternal(manager.getStatus().url);
  });
}
```

```ts
// apps/electron-demo/electron/main.ts
import { createCalAgentManager } from "./cal-agent-manager";
import { registerCalAgentMainIpc } from "./cal-agent-main-ipc";

let calAgentManager: ReturnType<typeof createCalAgentManager> | null = null;

app.whenReady().then(() => {
  calAgentManager = createCalAgentManager();
  registerCalAgentMainIpc({
    ipcMain,
    shell,
    manager: calAgentManager,
    getWindow: () => mainWindow
  });

  createWindow();
  void calAgentManager.start();
});

app.on("before-quit", () => {
  calAgentManager?.dispose();
});
```

- [ ] **Step 4: Run the IPC test to verify it passes**

Run: `pnpm --dir apps/electron-demo test -- test/cal-agent-main-ipc.test.ts`
Expected: PASS with handler registration and external-browser behavior covered.

- [ ] **Step 5: Commit the main-process wiring slice**

```bash
git add apps/electron-demo/electron/cal-agent-main-ipc.ts apps/electron-demo/electron/main.ts apps/electron-demo/test/cal-agent-main-ipc.test.ts
git commit -m "feat(electron-demo): wire cal-agent ipc in main process"
```

### Task 5: Mount the panel in the app shell and run the smoke checkpoints

**Purpose:** Integrate the panel into the existing plain-DOM layout with the smallest possible renderer-surface change, then validate the real startup path before spending time on polish.

**Files:**
- Modify: `apps/electron-demo/src/renderer/app.ts`
- Modify: `apps/electron-demo/src/renderer/style.css`
- Reuse: `apps/electron-demo/src/renderer/cal-agent-panel.ts`
- Reuse: `apps/electron-demo/src/renderer/cal-agent-controller.ts`

- [ ] **Step 1: Mount the CAL-AGENT panel and toolbar toggle in `app.ts`**

```ts
// apps/electron-demo/src/renderer/app.ts
import { createCalAgentPanel } from "./cal-agent-panel";
import { createCalAgentController } from "./cal-agent-controller";

let calAgentController: ReturnType<typeof createCalAgentController>;

function toggleCalAgent(): void {
  togglePanel(document.querySelector(".cal-agent-panel") as HTMLElement);
}

function createAppToolbar(): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";

  const calAgentBtn = document.createElement("button");
  calAgentBtn.textContent = "\uD83D\uDCC5";
  calAgentBtn.title = "Toggle Calendar Agent panel";
  calAgentBtn.addEventListener("click", toggleCalAgent);

  toolbar.append(
    vaultBtn,
    openBtn,
    saveBtn,
    saveAsBtn,
    spacer,
    vaultToggleBtn,
    outlineBtn,
    backlinksBtn,
    calAgentBtn,
    searchBtn,
    settingsBtn
  );

  return toolbar;
}

function boot(): void {
  // existing setup omitted
  const calAgentPanel = createCalAgentPanel();
  calAgentController = createCalAgentController({
    panel: calAgentPanel,
    bridge: window.nexusDemo.calAgent
  });

  mainArea.append(vault.element, editorColumn, outline.element, backlinks.element, calAgentPanel.element);

  void calAgentController.boot();
}
```

- [ ] **Step 2: Run a narrow build check before the first manual smoke**

Run: `pnpm --dir apps/electron-demo build`
Expected: PASS with Electron entrypoints, preload bridge, and renderer modules type-checking and bundling together.

- [ ] **Step 3: Run the ready-path smoke test immediately after wiring**

Run: `pnpm --dir apps/electron-demo dev`
Expected: the Electron demo opens, the editor remains interactive during startup, the new right-side `Calendar Agent` panel shows `starting`, then switches to `ready`, and the embedded CAL-AGENT page appears in the panel.

- [ ] **Step 4: Run the failure and retry smoke test before any extra polish**

Run: close the Electron app, temporarily break the CAL-AGENT command in `apps/electron-demo/electron/cal-agent-config.ts`, restart `pnpm --dir apps/electron-demo dev`, confirm the panel shows `error`, click `Retry`, restore the correct command, and confirm the panel reaches `ready`.
Expected: the editor remains usable in both failure and recovery paths, and `Retry` reuses the main-process manager instead of requiring a full Electron restart.

- [ ] **Step 5: Run the external-browser and shutdown cleanup smoke test, then commit**

Run: with the app in `ready`, click `Open in Browser`, confirm `http://127.0.0.1:3000` opens externally, then quit Electron and run `lsof -iTCP:3000 -sTCP:LISTEN`.
Expected: the browser opens the same URL and the port is no longer owned by the CAL-AGENT child that Nexus launched.

```bash
git add apps/electron-demo/src/renderer/app.ts apps/electron-demo/src/renderer/style.css
git commit -m "feat(electron-demo): mount cal-agent panel in app shell"
```

## Risk List And Mitigation Checkpoints

- `iframe` embedding blocked by CAL-AGENT response headers or CSP.
  Mitigation checkpoint: Task 5 Step 3 is the explicit go or no-go decision point. If the panel stays blank, shows frame-denial errors, or never fires a successful load while the URL works in the external browser, stop and switch to a `WebContentsView` fallback branch instead of polishing the `iframe` path.

- Next.js dev startup is slow or flaky on first launch.
  Mitigation checkpoint: keep the panel on `starting` with a finite timeout from `apps/electron-demo/electron/cal-agent-config.ts`; do not block renderer boot on startup completion.

- Duplicate CAL-AGENT processes during repeated retries or app reloads.
  Mitigation checkpoint: Task 1 tests lock duplicate-start suppression and Task 4 binds cleanup to `before-quit`; do not wire renderer-side spawning at any point.

- Main-process changes accidentally destabilize the editor demo.
  Mitigation checkpoint: after Task 4 and again after Task 5, run the existing Electron demo test suite and a manual edit-open-save smoke so vault browsing, outline, and backlinks still work.

## Focused Validation Matrix

- Automated: `pnpm --dir apps/electron-demo test -- test/cal-agent-manager.test.ts`
- Automated: `pnpm --dir apps/electron-demo test -- test/cal-agent-preload.test.ts`
- Automated: `pnpm --dir apps/electron-demo test -- test/cal-agent-panel.test.ts`
- Automated: `pnpm --dir apps/electron-demo test -- test/cal-agent-main-ipc.test.ts`
- Automated: `pnpm --dir apps/electron-demo build`
- Manual: cold start to `ready`
- Manual: forced failure to `error`
- Manual: retry from `error` to `ready`
- Manual: `Open in Browser`
- Manual: quit app and confirm child cleanup
- Manual: confirm editor still opens, edits, saves, and navigates vault files while CAL-AGENT is starting or failed

## Fallback Branch If Embedding Is Blocked

Do not start this branch unless Task 5 Step 3 proves `iframe` embedding is blocked.

1. Replace renderer `iframe` embedding with a main-process-owned `WebContentsView` attached to the right side of the Electron window.
2. Keep the same preload contract and renderer status UI so only the view-hosting layer changes.
3. Add one focused smoke test: start the app, confirm CAL-AGENT appears in the right-side host region, and confirm hiding the panel detaches or obscures the view cleanly.

Plan complete and saved to `docs/superpowers/plans/2026-05-27-cal-agent-embedded-panel-poc.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using the `executing-plans` agent, batch execution with checkpoints

**Which approach?**