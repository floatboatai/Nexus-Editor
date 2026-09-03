import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("./run-with-credentials.mjs", import.meta.url));

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "nexus-collab-deployment-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const credentials = join(directory, "credentials");
  await mkdir(credentials, { mode: 0o700 });
  const secret = randomBytes(32).toString("base64url");
  await writeFile(join(credentials, "auth-secret"), secret, { mode: 0o600, flag: "wx" });
  const env = {
    PATH: process.env.PATH,
    CREDENTIALS_DIRECTORY: credentials,
    NEXUS_COLLAB_STORAGE_DIR: join(directory, "state"),
    NEXUS_COLLAB_ADDRESS: "127.0.0.1",
    NEXUS_COLLAB_PORT: "0",
    NEXUS_COLLAB_INVITATION_ORIGINS: "",
  };
  return { env, secret };
}

function run(t, env, args) {
  const child = spawn(process.execPath, [runner, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const closed = once(child, "close");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed;
  });
  return { child, closed, stdout: () => stdout, stderr: () => stderr };
}

test("missing protected credential fails without printing its path or fallback secret", { timeout: 10_000 }, async (t) => {
  const { env, secret } = await fixture(t);
  env.CREDENTIALS_DIRECTORY = join(env.CREDENTIALS_DIRECTORY, "private-missing-path");
  env.NEXUS_COLLAB_AUTH_SECRET = secret;
  const execution = run(t, env, ["serve"]);
  assert.equal((await execution.closed)[0], 1);
  assert.equal(execution.stdout(), "");
  assert.equal(execution.stderr(), "Nexus deployment startup failed: check credential and release installation.\n");
});

test("separate CLI invocations retain the same file-backed signing identity", { timeout: 10_000 }, async (t) => {
  const { env, secret } = await fixture(t);
  for (let index = 0; index < 2; index += 1) {
    const execution = run(t, env, ["issue-token", "--document", "deployment-test", "--user", "alice", "--role", "editor", "--ttl", "300"]);
    assert.equal((await execution.closed)[0], 0);
    const { token } = JSON.parse(execution.stdout());
    const [header, payload, signature] = token.split(".");
    assert.equal(signature, createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url"));
    assert.equal(JSON.parse(Buffer.from(payload, "base64url")).doc, "deployment-test");
    assert.equal(execution.stderr().includes(secret), false);
  }
});

test("built CLI serves loopback, rejects public null Origin, and handles SIGTERM in place", { timeout: 15_000 }, async (t) => {
  const { env, secret } = await fixture(t);
  const execution = run(t, env, ["serve"]);
  const address = await new Promise((resolve, reject) => {
    const check = () => {
      const match = execution.stdout().match(/listening at ws:\/\/127\.0\.0\.1:(\d+)/);
      if (match) resolve(`http://127.0.0.1:${match[1]}`);
    };
    execution.child.stdout.on("data", check);
    execution.child.once("error", reject);
    execution.child.once("exit", () => reject(new Error("Server exited before listening")));
    check();
  });
  const health = await fetch(`${address}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });
  const rejected = await fetch(`${address}/v1/invitations`, { method: "POST", headers: { Origin: "null" } });
  assert.equal(rejected.status, 403);
  assert.deepEqual(await rejected.json(), { error: "origin-not-allowed" });
  const unauthenticated = await fetch(`${address}/v1/invitations`, { method: "POST" });
  assert.equal(unauthenticated.status, 401);
  execution.child.kill("SIGTERM");
  assert.deepEqual(await execution.closed, [0, null]);
  assert.equal(execution.stdout().includes(secret), false);
  assert.equal(execution.stderr().includes(secret), false);
});
