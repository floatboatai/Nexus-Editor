# CAL-AGENT Embedded Panel Design

**Date:** 2026-05-27

**Scope:** `apps/electron-demo`

## Context

`Nexus-Editor` already has a working Electron demo with a desktop shell, a plain-DOM renderer, and multiple side panels around the editor surface. `CAL-AGENT` is a separate Node 20 monorepo with a Next.js web app that acts as a calendar-driven workbench and assistant.

The immediate goal is not deep workflow integration. The goal is to embed the existing `CAL-AGENT` web UI into the Nexus Electron demo so the editor can host a right-side, always-available workbench panel. This should give the user continuous visibility into time-driven work without blocking editing workflows.

The first iteration is a development-mode proof of concept. Nexus should launch the CAL-AGENT web app automatically, wait for it to become reachable, and render it inside a right-side panel. The editor and CAL-AGENT do not exchange business data in this phase.

## Goals

- Add a right-side persistent panel to the Electron demo for CAL-AGENT
- Launch the CAL-AGENT web app automatically from Nexus on app startup
- Use the existing CAL-AGENT web UI instead of rebuilding it in Nexus
- Show clear panel states for startup, ready, and failure
- Allow retrying launch after failure
- Allow opening the embedded CAL-AGENT page in the system browser
- Keep the editor usable even when CAL-AGENT is unavailable

## Non-Goals

- No editor-content sync into CAL-AGENT
- No task creation, approval, or notification actions initiated from Nexus
- No shared authentication or session bridge between the two apps
- No packaging-grade process management in this phase
- No rewrite of the CAL-AGENT UI into native Nexus renderer components
- No attempt to normalize package management across the two repositories

## Recommended Approach

Use a host-managed embedding model:

1. The Nexus Electron main process owns CAL-AGENT process lifecycle.
2. The Nexus preload layer exposes a narrow process/status bridge.
3. The Nexus renderer adds a right-side panel dedicated to CAL-AGENT.
4. The panel embeds the running CAL-AGENT web app by URL.
5. No business-level data exchange is enabled in phase 1.

This keeps the two systems independent while still producing a coherent desktop experience.

## Architecture

The proof of concept is split into four modules.

### 1. Electron main-process manager

Located in `apps/electron-demo/electron/main.ts`.

Responsibilities:

- spawn the CAL-AGENT web app using `npm run web:dev`
- set the working directory to `/Users/wangqiao/workspace/CAL-AGENT`
- track child-process lifecycle and exit reasons
- run URL health checks until the web app is reachable
- expose IPC handlers for start, status, retry, and browser-open actions
- kill the child process when Nexus exits

The main process is the only place that may manage the child process. The renderer must not spawn or own the web server directly.

### 2. Preload bridge

Located in `apps/electron-demo/electron/preload.ts`.

Responsibilities:

- expose a minimal, desktop-safe API to renderer code
- provide current panel/process status
- allow the renderer to request retry/start actions
- allow the renderer to open the target URL in the external browser
- broadcast status changes from the main process to the renderer

Suggested bridge shape:

```ts
type CalAgentPanelStatus = "idle" | "starting" | "ready" | "error";

interface CalAgentStatusPayload {
  status: CalAgentPanelStatus;
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
```

### 3. Renderer panel

Located near `apps/electron-demo/src/renderer/app.ts`, preferably as a dedicated panel module.

Responsibilities:

- render a persistent right-side panel
- show the current connection state
- embed the CAL-AGENT UI when ready
- expose `Retry` and `Open in Browser` actions
- allow the panel to be hidden without disabling the editor

The panel should reuse the same layout philosophy already used by vault, outline, and backlinks side surfaces in the Electron demo.

### 4. Health-check controller

Implemented in the main process.

Responsibilities:

- poll the target URL after spawn
- treat HTTP reachability as readiness
- enforce a startup timeout window
- update status to `ready` on success
- update status to `error` on timeout or process exit

For the proof of concept, a simple polling loop is sufficient.

## Runtime Flow

The proof-of-concept runtime flow is:

1. User launches the Nexus Electron demo.
2. The Electron main process initializes the CAL-AGENT panel controller.
3. Nexus attempts to spawn the CAL-AGENT web app with `npm run web:dev`.
4. The renderer shows the right-side panel in `starting` state.
5. The main process polls the configured local URL until reachable.
6. When reachable, the renderer switches the panel to `ready` and embeds the page.
7. If startup fails, times out, or exits early, the panel switches to `error`.
8. The user can click `Retry` to re-run the startup path.
9. The user can click `Open in Browser` to open the same URL externally.
10. When Nexus exits, it shuts down the child process it launched.

## User Experience

The CAL-AGENT panel should be intentionally simple.

Required states:

- `starting`: panel title and loading message
- `ready`: embedded CAL-AGENT page visible
- `error`: concise failure message plus `Retry`

Required controls:

- panel title, for example `Calendar Agent`
- status indicator
- `Retry` button
- `Open in Browser` button
- existing or new panel visibility toggle in the Nexus toolbar

The editor must remain fully usable while the panel is starting, unavailable, or hidden.

## Technical Constraints

- Nexus uses `pnpm`; CAL-AGENT uses `npm`
- Both projects currently run on Node `20.20.2`
- CAL-AGENT `npm run gate` is not fully green today, but that does not block this proof of concept
- The proof of concept depends only on `npm run web:dev` being launchable
- The embedded page target for this proof of concept is the local development URL `http://127.0.0.1:3000`

The process boundary is deliberate. It prevents bundling Prisma, Next.js, and CAL-AGENT workspace concerns into the Nexus renderer or Electron build pipeline.

## Error Handling

Error behavior should stay explicit and local to the panel.

- Child-process spawn failure: panel enters `error` with a short actionable message
- Startup timeout: panel enters `error` and offers retry
- Early process exit: panel enters `error`
- Embedded page unavailable after previous success: panel returns to `error`
- Browser-open failure: keep panel state unchanged and surface a short message if practical

The editor itself must not fail closed when the panel fails.

## Testing Strategy

The proof of concept should favor a narrow validation surface.

### Manual validation

Manually verify these flows:

1. Cold start: Nexus launches, panel reaches `ready`
2. Failure path: invalid command or unreachable URL leads to `error`
3. Retry path: user can retry after failure
4. Browser path: `Open in Browser` opens the same URL externally
5. Exit path: closing Nexus cleans up the spawned CAL-AGENT process

### Automated coverage

Add focused tests only for the new Nexus-side logic:

- process/status state transitions
- timeout behavior
- duplicate-start suppression
- retry after failure

No end-to-end automation is required in this phase.

## Acceptance Criteria

The proof of concept is complete when all of the following are true:

1. Launching the Nexus Electron demo automatically attempts to start CAL-AGENT
2. A persistent right-side panel exists for CAL-AGENT
3. The panel visibly transitions through `starting`, `ready`, and `error` states as appropriate
4. When CAL-AGENT becomes reachable, the panel embeds its existing web UI
5. When startup fails, the user can retry from the panel
6. The user can open the same CAL-AGENT page in the external browser
7. Closing Nexus cleans up the CAL-AGENT child process started by Nexus
8. CAL-AGENT failure does not break document open, edit, save, vault browsing, outline, or backlinks in the editor

## Risks And Trade-offs

- Embedding via `iframe` may be blocked by response headers or CSP.
  Mitigation: treat Electron `BrowserView` or `WebContentsView` as the fallback if direct embedding is blocked.

- Next.js development startup time may be slow on first run.
  Mitigation: keep a visible `starting` state and a generous but finite timeout.

- Child-process cleanup can be error-prone during development restarts.
  Mitigation: centralize process ownership in the Electron main process and always bind cleanup to app exit.

- The fixed local repository path is acceptable for the proof of concept but not portable.
  Mitigation: keep the path in one configuration constant so a later settings-based override stays cheap.

## Delivery Scope For The 2-Day POC

In scope:

- automatic `npm run web:dev` startup from Nexus
- local health check and status updates
- right-side embedded CAL-AGENT panel
- retry action
- external browser action
- shutdown cleanup

Out of scope:

- deep editor-to-agent integration
- shared data model or task synchronization
- authentication/session bridging
- packaged distribution support
- production-grade resilience features
