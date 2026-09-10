const { app, BrowserWindow, session } = require("electron");
const path = require("node:path");
const root = process.env.NEXUS_DOCUMENT_SMOKE_ROOT;
const url = process.env.NEXUS_DOCUMENT_SMOKE_URL;
if (!root || !url) throw new Error("Missing isolated browser smoke configuration");
app.setPath("userData", path.join(root, "user-data"));
app.setPath("sessionData", path.join(root, "session-data"));
let window;
const timer = setTimeout(() => finish({ ok: false, error: "Browser smoke timed out" }), 45_000);
let finished = false;
function finish(result) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  process.stdout.write(`${JSON.stringify({ smoke: "document-browser-conversion", ...result })}\n`);
  if (window && !window.isDestroyed()) window.destroy();
  app.exit(result.ok ? 0 : 1);
}
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((request, callback) => callback({ cancel: !request.url.startsWith(url) && !request.url.startsWith("data:") }));
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  await window.loadURL(url);
  finish(await window.webContents.executeJavaScript("window.documentSmoke"));
}).catch((error) => finish({ ok: false, error: error.message }));
