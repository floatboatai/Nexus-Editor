import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const activeClients = new Set();
let stopping = false;

export function forceStopSmokeClients() {
  stopping = true;
  for (const client of activeClients) client.forceTerminate();
}

export async function stopSmokeClients() {
  stopping = true;
  const results = await Promise.allSettled([...activeClients].map((client) => client.close()));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "Client cancellation cleanup failed");
}

export async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function targets(port, resource = "list") {
  return new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${port}/json/${resource}`, { timeout: 1000 }, (response) => {
      let body = "";
      response.on("data", (data) => { body += data; });
      response.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("CDP target lookup timed out")));
  });
}

function command(url, method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => { socket.close(); reject(new Error(`CDP ${method} timed out`)); }, 15000);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method, params }));
    socket.onerror = () => { clearTimeout(timer); reject(new Error("CDP connection failed")); };
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer); socket.close();
      if (message.error || message.result?.exceptionDetails) {
        reject(new Error(message.error?.message ?? message.result.exceptionDetails.exception?.description
          ?? message.result.exceptionDetails.text));
      } else resolve(message.result);
    };
  });
}

export async function startClient({ name, directory, vault, serverUrl, extraEnv = {}, extraArgs = [] }) {
  assert(!stopping, "Collaboration smoke was cancelled");
  const port = await freePort();
  const electron = require("electron");
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${directory}`, ...extraArgs,
    path.join(appDir, "test/fixtures/electron-collaboration-smoke-main.cjs")];
  if (process.platform === "linux") args.unshift("--no-sandbox");
  let executable = electron;
  if (process.platform === "linux" && !process.env.DISPLAY) {
    const found = spawnSync("which", ["xvfb-run"], { encoding: "utf8" });
    assert.equal(found.status, 0, "Linux smoke needs DISPLAY or xvfb-run");
    executable = found.stdout.trim(); args.unshift("-a", electron);
  }
  const env = { ...process.env, ...extraEnv, NEXUS_PLUGIN_PLATFORM: "1",
    NEXUS_COLLAB_SERVERS: serverUrl, NEXUS_COLLAB_SMOKE_MODE: "runtime",
    NEXUS_COLLAB_SMOKE_INTERACTIVE: "1", NEXUS_COLLAB_SMOKE_VAULT: vault };
  delete env.VITE_DEV_SERVER_URL; delete env.VITE_NEXUS_PLUGIN_PLATFORM; delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  const child = spawn(executable, args, { cwd: appDir, env, detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"] });
  if (process.env.NEXUS_ELECTRON_COLLABORATION_SMOKE_TRACE_LIFECYCLE === "1") {
    process.stderr.write(`NEXUS_COLLAB_SMOKE_CHILD=${JSON.stringify({ pid: child.pid, name })}\n`);
  }
  let logs = "";
  child.stdout.on("data", (data) => { logs = (logs + data).slice(-32000); });
  child.stderr.on("data", (data) => { logs = (logs + data).slice(-32000); });
  let processClosed = false;
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject); child.once("close", (code) => { processClosed = true; resolve(code); });
  });
  let page;
  let closePromise;
  const client = {
    name,
    forceTerminate() {
      if (child.pid === undefined || processClosed) return;
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
      else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    },
    async evaluate(expression) {
      return (await command(page.webSocketDebuggerUrl, "Runtime.evaluate", {
        expression, awaitPromise: true, returnByValue: true,
      })).result?.value;
    },
    async input(text) { await command(page.webSocketDebuggerUrl, "Input.insertText", { text }); },
    async key(key, modifiers = 0, code = key) {
      const windowsVirtualKeyCode = { End: 35, Home: 36, z: 90 }[key] ?? 0;
      const event = { key, code, modifiers, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
      await command(page.webSocketDebuggerUrl, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...event });
      await command(page.webSocketDebuggerUrl, "Input.dispatchKeyEvent", { type: "keyUp", ...event });
    },
    async crashRenderer() {
      // Resolve the isolated test browser's one renderer before terminating it.
      // No product hook, synthetic lifecycle event, or broad process-name kill.
      const browser = await targets(port, "version");
      const info = await command(browser.webSocketDebuggerUrl, "SystemInfo.getProcessInfo");
      const renderers = info.processInfo.filter((entry) => entry.type === "renderer");
      assert.equal(renderers.length, 1, "Crash test must resolve exactly one renderer in this isolated instance");
      const rendererPid = renderers[0].id;
      assert(Number.isSafeInteger(rendererPid) && rendererPid > 0 && rendererPid !== process.pid);
      process.kill(rendererPid, "SIGKILL");
      const stopped = await Promise.race([exited.then(() => true), delay(5000).then(() => false)]);
      assert(stopped, `${name}: Host did not release the terminated renderer; ${logs.split(/\r?\n/u).slice(-8).join("\n")}`);
    },
    close() {
      if (!closePromise) closePromise = (async () => {
        try {
          if (processClosed) return;
          // Close the real product window first so renderer/utility drains run.
          if (page) {
            await Promise.race([command(page.webSocketDebuggerUrl, "Page.close").catch(() => {}), delay(1000)]);
          } else if (child.pid !== undefined) {
            if (process.platform === "win32") child.kill();
            else { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill(); } }
          }
          const stopped = await Promise.race([exited.then(() => true), delay(5000).then(() => false)]);
          if (!stopped) {
            client.forceTerminate();
            const forced = await Promise.race([exited.then(() => true), delay(1000).then(() => false)]);
            if (!forced) throw new Error(`${name} did not exit after forced test-process cleanup`);
            throw new Error(`${name} failed graceful product shutdown`);
          }
        } finally {
          if (processClosed) activeClients.delete(client);
        }
      })();
      return closePromise;
    },
  };
  activeClients.add(client);
  try {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      assert(!stopping, "Collaboration smoke was cancelled");
      if (child.exitCode !== null) throw new Error(`${name} exited before startup`);
      try { page = (await targets(port)).find((target) => target.type === "page"
        && target.title === "Nexus Editor Demo"); } catch {}
      if (page) {
        try { if (await client.evaluate('document.querySelector("#app")?.dataset.nexusStartupState === "ready"')) return client; }
        catch {}
      }
      await delay(50);
    }
    throw new Error(`${name} renderer startup timed out`);
  } catch (error) {
    await client.close().catch(() => {});
    throw Object.assign(error, { details: { logs: logs.split(/\r?\n/u).slice(-15) } });
  }
}

async function waitFor(client, expression, description, milliseconds = 15000) {
  const deadline = Date.now() + milliseconds;
  let actual;
  while (Date.now() < deadline) {
    assert(!stopping, "Collaboration smoke was cancelled");
    actual = await client.evaluate(expression);
    if (actual) return actual;
    await delay(75);
  }
  const state = await client.evaluate(`({ text: document.querySelector(".cm-content")?.innerText,
    status: [...document.querySelectorAll(".nexus-collaboration__status-grid dt")]
      .map((node) => [node.textContent, node.nextElementSibling?.textContent]),
    notices: [...document.querySelectorAll(".nexus-collaboration__body [role=alert], .nexus-collaboration__warning")]
      .map((node) => node.textContent),
    panel: document.querySelector(".nexus-collaboration")?.innerText?.slice(0, 2500) })`);
  throw Object.assign(new Error(`${client.name}: ${description}`), { details: state });
}

async function click(client, label) {
  await waitFor(client, `(() => { const button = [...document.querySelectorAll("button")]
    .find((node) => node.textContent.trim() === ${JSON.stringify(label)} && !node.disabled);
    if (!button) return false; button.click(); return true; })()`, `Button unavailable: ${label}`);
}

async function fill(client, fields) {
  await client.evaluate(`(() => { for (const [name, value] of Object.entries(${JSON.stringify(fields)})) {
    const input = document.querySelector('[name="' + name + '"]');
    if (!input) throw new Error("Missing form field " + name);
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  } })()`);
}

async function openFile(client) {
  await click(client, "Vault");
  await waitFor(client, `(() => { const row = [...document.querySelectorAll('[data-kind="file"][data-path]')]
    .find((node) => node.dataset.path.replaceAll('\\\\', '/').endsWith('/shared.md'));
    if (!row) return false; row.click(); return true; })()`, "Temporary Vault file did not appear");
  await click(client, "Collaborate");
  await waitFor(client, 'Boolean(document.querySelector("[name=create-server-url], [name=resume-token]"))',
    "Enrollment UI did not open");
}

const editorText = 'document.querySelector(".editor-container .cm-content")?.innerText';
async function textIs(client, expected) {
  await waitFor(client, `${editorText} === ${JSON.stringify(expected)}`, "Editor did not converge");
}
async function synchronized(client) {
  await waitFor(client, `(() => { const status = Object.fromEntries(
    [...document.querySelectorAll(".nexus-collaboration__status-grid dt")]
      .map((node) => [node.textContent, node.nextElementSibling?.textContent]));
    return status.Network === "online" && status.Authentication === "authenticated"
      && status["Initial sync"] === "synced"; })()`, "Session did not authenticate and synchronize");
}
async function append(client, value) {
  await click(client, "Close panel");
  await client.evaluate('document.querySelector(".editor-container .cm-content").focus()');
  await client.key("End", 2, "End");
  await client.input(value);
  await click(client, "Collaborate");
}

export async function runProductUi({ directory, service, serverUrl, extraEnv = {}, extended = true }) {
  const checks = [];
  const clients = new Set();
  let primaryFailure;
  const documentId = `browser-smoke-${crypto.randomUUID()}`;
  const vaultA = path.join(directory, "vault-a");
  const vaultB = path.join(directory, "vault-b");
  await Promise.all([mkdir(vaultA), mkdir(vaultB)]);
  await Promise.all([writeFile(path.join(vaultA, "shared.md"), "Shared seed"),
    writeFile(path.join(vaultB, "shared.md"), "Shared seed")]);
  const start = async (name, vault, profile) => {
    const client = await startClient({ name, vault, directory: path.join(directory, profile), serverUrl, extraEnv });
    clients.add(client); return client;
  };
  try {
    const alice = await start("Alice", vaultA, "profile-a");
    let bob = await start("Bob", vaultB, "profile-b");
    await Promise.all([openFile(alice), openFile(bob)]);
    const owner = await service.tokens.issue({ documentId, userId: "alice", role: "editor", lifetimeSeconds: 1800 });
    await fill(alice, { "create-server-url": serverUrl, "create-document-id": documentId,
      "create-user-id": "alice", "create-display-name": "Alice", "create-token": owner.token });
    await click(alice, "Create and attach");
    await synchronized(alice);
    await click(alice, "Create editor invite");
    const invitation = await waitFor(alice,
      `document.querySelector('textarea[aria-label="Invitation capability"]')?.value`, "Invitation broker failed");
    const envelope = JSON.parse(invitation);
    await fill(bob, { "join-invitation": invitation, "join-display-name": "Bob" });
    await click(bob, "Validate and join");
    await synchronized(bob);
    await Promise.all([textIs(alice, "Shared seed"), textIs(bob, "Shared seed")]);
    checks.push("create-invite-join-real-network");

    await append(alice, " A");
    await textIs(bob, "Shared seed A");
    await append(bob, " B");
    await textIs(alice, "Shared seed A B");
    await click(alice, "Close panel");
    await alice.evaluate('document.querySelector(".editor-container .cm-content").focus()');
    await alice.key("z", 2, "KeyZ");
    await click(alice, "Collaborate");
    await Promise.all([textIs(alice, "Shared seed B"), textIs(bob, "Shared seed B")]);
    checks.push("two-renderer-convergence-independent-undo");
    await waitFor(alice, 'document.querySelector(".nexus-collaboration").innerText.includes("Bob · online")',
      "Remote presence was not visible");
    await waitFor(bob, 'document.querySelector(".nexus-collaboration").innerText.includes("Alice · online")',
      "Reciprocal presence was not visible");
    checks.push("bidirectional-presence");
    if (!extended) return { checks, clients: 2, independentRendererProcesses: true, independentReplicaStores: true };

    await service.waitForPersistence(documentId, 10000);
    await service.stop();
    await waitFor(bob, `!([...document.querySelectorAll(".nexus-collaboration__status-grid dt")]
      .find((node) => node.textContent === "Network")?.nextElementSibling?.textContent === "online")`,
    "Disconnect was not visible");
    await append(bob, " offline");
    await textIs(bob, "Shared seed B offline");
    await waitFor(bob, `([...document.querySelectorAll(".nexus-collaboration__status-grid dt")]
      .find((node) => node.textContent === "Local replica")?.nextElementSibling?.textContent) === "clean"`,
    "Offline edit was not locally durable");
    await bob.close(); clients.delete(bob);
    bob = await start("Bob reopened", vaultB, "profile-b");
    await openFile(bob);
    await fill(bob, { "resume-user-id": envelope.userId, "resume-display-name": "Bob", "resume-token": envelope.token });
    await click(bob, "Resume");
    await waitFor(bob, `Boolean(document.querySelector(".nexus-collaboration__status-grid"))`,
      "Resumed local replica was not opened");
    const reconcile = await bob.evaluate(`([...document.querySelectorAll("button")]
      .find((node) => node.textContent.trim() === "Use synchronized shared content"))` + " !== undefined");
    if (reconcile) await click(bob, "Use synchronized shared content");
    await textIs(bob, "Shared seed B offline");
    await service.start();
    await Promise.all([synchronized(alice), synchronized(bob)]);
    await textIs(alice, "Shared seed B offline");
    checks.push("offline-edit-process-close-reopen-durable-recovery-server-restart");

    await service.stop();
    await waitFor(bob, `([...document.querySelectorAll(".nexus-collaboration__status-grid dt")]
      .find((node) => node.textContent === "Network")?.nextElementSibling?.textContent) === "offline"`,
    "Renderer crash test requires an offline session");
    await append(bob, " crash");
    await waitFor(bob, `([...document.querySelectorAll(".nexus-collaboration__status-grid dt")]
      .find((node) => node.textContent === "Local replica")?.nextElementSibling?.textContent) === "clean"`,
    "Crash edit was not durably saved");
    await bob.crashRenderer(); clients.delete(bob);
    bob = await start("Bob after renderer crash", vaultB, "profile-b");
    await openFile(bob);
    await fill(bob, { "resume-user-id": envelope.userId, "resume-display-name": "Bob", "resume-token": envelope.token });
    await click(bob, "Resume");
    await waitFor(bob, `(() => {
      if (${editorText} === "Shared seed B offline crash") return true;
      const button = [...document.querySelectorAll("button")].find((node) =>
        node.textContent.trim() === "Use synchronized shared content" && !node.disabled);
      if (button) button.click(); return false;
    })()`, "Durable replica did not survive actual renderer process crash");
    await service.start();
    await Promise.all([synchronized(alice), synchronized(bob)]);
    await textIs(alice, "Shared seed B offline crash");
    checks.push("actual-renderer-crash-durable-reopen-resynchronization");

    await bob.close(); clients.delete(bob);
    const vaultReader = path.join(directory, "vault-reader");
    await mkdir(vaultReader);
    await writeFile(path.join(vaultReader, "shared.md"), "Shared seed B offline crash");
    const reader = await start("Reader", vaultReader, "profile-reader");
    await openFile(reader);
    await click(alice, "Create reader invite");
    const readerInvitation = await waitFor(alice,
      `document.querySelector('textarea[aria-label="Invitation capability"]')?.value`, "Reader invitation broker failed");
    const readerEnvelope = JSON.parse(readerInvitation);
    await fill(reader, { "join-invitation": readerInvitation, "join-display-name": "Reader" });
    await click(reader, "Validate and join");
    await synchronized(reader);
    await append(reader, " FORBIDDEN");
    await Promise.all([textIs(reader, "Shared seed B offline crash"), textIs(alice, "Shared seed B offline crash")]);
    const access = await reader.evaluate(`([...document.querySelectorAll(".nexus-collaboration__status-grid dt")]
      .find((node) => node.textContent === "Access")?.nextElementSibling?.textContent)`);
    assert.equal(access, "reader / read only", "Reader must not obtain write access");
    checks.push("reader-invitation-read-only-keyboard-denial");

    // A reader cannot import external disk content into the shared document:
    // this creates a deterministic conflict without timing a debounce race.
    await writeFile(path.join(vaultReader, "shared.md"), "External disk change");
    await waitFor(reader, 'document.querySelector(".nexus-collaboration").innerText.includes("Markdown file conflict")',
      "External read-only file conflict was not surfaced");
    await click(reader, "Keep shared");
    await waitFor(reader, '!document.querySelector(".nexus-collaboration").innerText.includes("Markdown file conflict")',
      "File conflict did not resolve");
    assert.equal(await readFile(path.join(vaultReader, "shared.md"), "utf8"), "Shared seed B offline crash");
    checks.push("external-file-conflict-explicit-recovery");

    const claims = await service.tokens.verify(readerEnvelope.token, documentId);
    await service.revokeToken(claims.tokenId, claims.expiresAt);
    await waitFor(reader, 'Boolean(document.querySelector("[name=reauth-token]"))', "Revocation did not require reauthentication");
    const short = await service.tokens.issue({ documentId, userId: readerEnvelope.userId, role: "reader", lifetimeSeconds: 4 });
    await fill(reader, { "reauth-user-id": readerEnvelope.userId, "reauth-token": short.token });
    await click(reader, "Reauthenticate");
    await synchronized(reader);
    await waitFor(reader, `([...document.querySelectorAll(".nexus-collaboration__status-grid dt")]
      .find((node) => node.textContent === "Authentication")?.nextElementSibling?.textContent) === "expired"`,
    "Real token expiry was not surfaced");
    const replacement = await service.tokens.issue({ documentId, userId: readerEnvelope.userId, role: "reader", lifetimeSeconds: 300 });
    await fill(reader, { "reauth-user-id": readerEnvelope.userId, "reauth-token": replacement.token });
    await click(reader, "Reauthenticate");
    await synchronized(reader);
    await append(alice, " renewed");
    await textIs(reader, "Shared seed B offline crash renewed");
    checks.push("token-revocation-expiry-reauthentication-resynchronization");
    return { checks, clients: 2, independentRendererProcesses: true, independentReplicaStores: true };
  } catch (error) {
    primaryFailure = error;
    error.details = { completedChecks: checks, ...error.details }; throw error;
  } finally {
    const results = await Promise.allSettled([...clients].map((client) => client.close()));
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) {
      if (primaryFailure) primaryFailure.details.cleanupFailures = failures.map((result) => String(result.reason));
      else throw Object.assign(new AggregateError(failures.map((result) => result.reason), "Product clients failed cleanup"),
        { details: { failures: failures.map((result) => String(result.reason)), completedChecks: checks } });
    }
  }
}
