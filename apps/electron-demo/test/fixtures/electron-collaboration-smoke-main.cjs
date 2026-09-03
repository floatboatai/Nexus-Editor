/* Test-only host: loads the real built app, never an alternate renderer. */
const assert = require("node:assert/strict");
const path = require("node:path");
const { readFileSync } = require("node:fs");
const { X509Certificate } = require("node:crypto");
const { app, BrowserWindow, dialog } = require("electron");

const appDir = path.resolve(__dirname, "../..");
const serverUrl = process.env.NEXUS_COLLAB_SMOKE_URL;
const mode = process.env.NEXUS_COLLAB_SMOKE_MODE;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (process.env.NEXUS_COLLAB_SMOKE_CA) {
  const authority = new X509Certificate(readFileSync(process.env.NEXUS_COLLAB_SMOKE_CA));
  assert(authority.ca && authority.verify(authority.publicKey), "Test CA must be self-signed CA");
  app.on("session-created", (session) => {
    session.setCertificateVerifyProc((request, callback) => {
      try {
        const leaf = new X509Certificate(request.certificate.data);
        const now = Date.now();
        const trustedTestLeaf = request.hostname === "127.0.0.1"
          && leaf.checkIP(request.hostname) === request.hostname
          && !leaf.ca && leaf.keyUsage?.includes("1.3.6.1.5.5.7.3.1")
          && leaf.checkIssued(authority) && leaf.verify(authority.publicKey)
          && Date.parse(leaf.validFrom) <= now && now < Date.parse(leaf.validTo)
          && Date.parse(authority.validFrom) <= now && now < Date.parse(authority.validTo);
        callback(trustedTestLeaf ? 0 : -3);
      } catch { callback(-3); }
    });
  });
}

async function waitForReady(window) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const state = await window.webContents.executeJavaScript(
        'document.querySelector("#app")?.dataset.nexusStartupState');
      if (state === "ready") return;
      if (state === "failed") throw new Error("Production renderer startup failed");
    } catch (error) {
      if (String(error).includes("startup failed")) throw error;
    }
    await delay(50);
  }
  throw new Error("Production renderer did not become ready");
}

async function probe(window, targetUrl = serverUrl) {
  return window.webContents.executeJavaScript(`(async () => {
    const violations = [];
    const listener = (event) => violations.push({
      effectiveDirective: event.effectiveDirective,
      disposition: event.disposition,
      blockedURI: event.blockedURI,
    });
    document.addEventListener("securitypolicyviolation", listener);
    const outcome = await new Promise((resolve) => {
      const socket = new WebSocket(${JSON.stringify(targetUrl)});
      const timer = setTimeout(() => { socket.close(); resolve("timeout"); }, 3000);
      socket.onopen = () => { clearTimeout(timer); socket.close(); resolve("open"); };
      socket.onerror = () => { clearTimeout(timer); resolve("error"); };
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    document.removeEventListener("securitypolicyviolation", listener);
    return { url: location.href, hostMode: window.nexusHost?.mode, outcome, violations };
  })()`);
}

let production;
async function main() {
  if (process.env.NEXUS_COLLAB_SMOKE_VAULT) {
    // The native directory picker is the only mocked product dependency.
    // Files, IPC authorization, sessions and collaboration run unchanged.
    dialog.showOpenDialog = async () => ({ canceled: false,
      filePaths: [process.env.NEXUS_COLLAB_SMOKE_VAULT] });
  }
  // Requiring the production entry preserves its real sessions, preload, CSP and startup.
  production = require(path.join(appDir, "dist-electron/main.js"));
  await app.whenReady();
  const deadline = Date.now() + 15000;
  while (!BrowserWindow.getAllWindows().length && Date.now() < deadline) await delay(25);
  const window = BrowserWindow.getAllWindows()[0];
  assert(window, "Production main must create a BrowserWindow");
  await waitForReady(window);
  if (process.env.NEXUS_COLLAB_SMOKE_INTERACTIVE === "1") return { mode, interactive: true };
  const network = await probe(window);
  assert.equal(network.hostMode, mode);
  assert.equal(network.outcome, process.env.NEXUS_COLLAB_SMOKE_EXPECT_NETWORK ?? "open", JSON.stringify(network));
  assert.deepEqual(network.violations, [], "Configured live WebSocket must not violate CSP");
  let untrusted;
  if ((process.env.NEXUS_COLLAB_SMOKE_EXPECT_NETWORK ?? "open") === "open") {
    untrusted = await probe(window, "wss://nexus-untrusted.invalid");
    assert.equal(untrusted.outcome, "error", "Unconfigured origins must not connect");
    assert(untrusted.violations.some((violation) => violation.effectiveDirective === "connect-src"
      && violation.disposition === "enforce" && violation.blockedURI.startsWith("wss://nexus-untrusted.invalid")),
    "Missing enforcing CSP for an unconfigured server");
  }
  return { mode, network, untrusted };
}

main().then((result) => {
  process.stdout.write(`NEXUS_COLLAB_SMOKE=${JSON.stringify({ ok: true, ...result })}\n`);
  if (!result.interactive) app.quit();
}).catch((error) => {
  process.stdout.write(`NEXUS_COLLAB_SMOKE=${JSON.stringify({ ok: false, mode,
    error: error.message, stack: error.stack })}\n`);
  app.exit(1);
});
