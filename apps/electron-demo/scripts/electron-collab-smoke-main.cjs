const { app, BrowserWindow } = require("electron");
const path = require("node:path");

const timeoutMs = Number.parseInt(process.env.NEXUS_ELECTRON_SMOKE_TIMEOUT_MS ?? "20000", 10);
const htmlPath = path.resolve(__dirname, "electron-collab-smoke.html");
let finished = false;

function emit(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function check(value, message) {
  if (!value) throw new Error(message);
}

function fail(error) {
  if (finished) return;
  finished = true;
  emit({
    ok: false,
    smoke: "electron-yjs-collaboration",
    error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) },
  });
  app.exit(1);
}

async function execute(window, expression) {
  return window.webContents.executeJavaScript(expression, true);
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 40));
}

async function run() {
  const options = {
    show: false,
    width: 620,
    height: 420,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  };
  const primary = new BrowserWindow(options);
  const secondary = new BrowserWindow(options);
  await Promise.all([primary.loadFile(htmlPath), secondary.loadFile(htmlPath)]);
  check(await execute(primary, "Boolean(window.__nexusCollabSmoke)"), "Primary renderer did not initialize");
  check(await execute(secondary, "Boolean(window.__nexusCollabSmoke)"), "Secondary renderer did not initialize");

  const primaryInitial = await execute(primary, "window.__nexusCollabSmoke.prepare('primary')");
  const initialUpdate = await execute(primary, "window.__nexusCollabSmoke.stateUpdate()");
  const secondaryInitial = await execute(
    secondary,
    `window.__nexusCollabSmoke.prepare('secondary', ${JSON.stringify(initialUpdate)})`,
  );
  check(primaryInitial.markdown === secondaryInitial.markdown, "Initial shared markdown differs");

  const relayAwareness = async (source, target) => {
    const updates = await execute(source, "window.__nexusCollabSmoke.drainAwarenessUpdates()");
    if (updates.length > 0) {
      await execute(target, `window.__nexusCollabSmoke.applyAwarenessUpdates(${JSON.stringify(updates)})`);
    }
  };
  await relayAwareness(primary, secondary);
  await relayAwareness(secondary, primary);
  await execute(primary, "window.__nexusCollabSmoke.select(2, 8)");
  await relayAwareness(primary, secondary);
  await settle();
  const presence = await execute(secondary, "window.__nexusCollabSmoke.snapshot()");
  check(presence.remoteCarets === 1, "Secondary window did not render the remote caret");
  check(presence.remoteSelections === 1, "Secondary window did not render the remote selection");
  check(presence.labels.includes("Alice"), "Secondary window did not render the remote user label");

  await execute(primary, "window.__nexusCollabSmoke.edit(0, 0, 'Primary: ')");
  const primaryUpdates = await execute(primary, "window.__nexusCollabSmoke.drainDocumentUpdates()");
  await execute(secondary, `window.__nexusCollabSmoke.applyDocumentUpdates(${JSON.stringify(primaryUpdates)})`);
  await settle();
  const visibleSync = await execute(secondary, "window.__nexusCollabSmoke.snapshot()");
  check(visibleSync.markdown.startsWith("Primary: "), "Remote Markdown did not synchronize visibly");
  check(visibleSync.visibleText.includes("Primary:"), "Remote edit was not painted in the second BrowserWindow");

  // Simulate both windows editing while disconnected, then reconnect with reversed and duplicated delivery.
  await execute(primary, "window.__nexusCollabSmoke.edit(0, 0, 'A|')");
  await execute(secondary, "window.__nexusCollabSmoke.edit(0, 0, 'B|')");
  const disconnected = await Promise.all([
    execute(primary, "window.__nexusCollabSmoke.snapshot()"),
    execute(secondary, "window.__nexusCollabSmoke.snapshot()"),
  ]);
  check(disconnected[0].markdown !== disconnected[1].markdown, "Disconnect simulation did not diverge locally");
  const queuedA = await execute(primary, "window.__nexusCollabSmoke.drainDocumentUpdates()");
  const queuedB = await execute(secondary, "window.__nexusCollabSmoke.drainDocumentUpdates()");
  queuedA.reverse();
  queuedB.reverse();
  await execute(primary, `window.__nexusCollabSmoke.applyDocumentUpdates(${JSON.stringify([...queuedB, ...queuedB])})`);
  await execute(secondary, `window.__nexusCollabSmoke.applyDocumentUpdates(${JSON.stringify([...queuedA, ...queuedA])})`);
  await settle();

  const converged = await Promise.all([
    execute(primary, "window.__nexusCollabSmoke.snapshot()"),
    execute(secondary, "window.__nexusCollabSmoke.snapshot()"),
  ]);
  check(converged[0].markdown === converged[1].markdown, "Reconnected editors did not converge byte-for-byte");
  check(converged[0].markdown === converged[0].sharedMarkdown, "Primary editor and Y.Text differ");
  check(converged[1].markdown === converged[1].sharedMarkdown, "Secondary editor and Y.Text differ");

  const cleanup = await Promise.all([
    execute(primary, "window.__nexusCollabSmoke.cleanup()"),
    execute(secondary, "window.__nexusCollabSmoke.cleanup()"),
  ]);
  check(cleanup.every((item) => item.editorRemoved && item.collaborationDomRemoved), "Collaboration cleanup left DOM behind");
  primary.destroy();
  secondary.destroy();
  await settle();
  check(BrowserWindow.getAllWindows().length === 0, "Electron collaboration windows did not close");

  finished = true;
  emit({
    ok: true,
    smoke: "electron-yjs-collaboration",
    electron: process.versions.electron,
    initial: { primary: primaryInitial, secondary: secondaryInitial },
    presence,
    visibleSync,
    disconnected,
    converged,
    cleanup,
  });
  app.exit(0);
}

const timer = setTimeout(() => fail(new Error(`Electron collaboration smoke timed out after ${timeoutMs}ms`)), timeoutMs);
timer.unref();
app.whenReady().then(run).catch(fail);
app.on("window-all-closed", (event) => {
  if (!finished) event.preventDefault();
});
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);
