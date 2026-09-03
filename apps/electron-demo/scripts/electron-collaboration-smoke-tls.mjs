import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** A temporary, single-test CA; never added to OS or global Chromium trust. */
export async function createTestTlsProxy(directory, upstreamUrl, { signal } = {}) {
  const certificateDir = path.join(directory, "test-ca");
  await mkdir(certificateDir);
  const ca = path.join(certificateDir, "ca.pem");
  const caKey = path.join(certificateDir, "ca.key");
  const key = path.join(certificateDir, "server.key");
  const csr = path.join(certificateDir, "server.csr");
  const cert = path.join(certificateDir, "server.pem");
  await execute("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", caKey, "-out", ca, "-subj", "/CN=Nexus isolated smoke CA",
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"], { signal, timeout: 10000 });
  await execute("openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", key,
    "-out", csr, "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "-addext", "basicConstraints=critical,CA:FALSE", "-addext", "extendedKeyUsage=serverAuth",
    "-addext", "keyUsage=critical,digitalSignature,keyEncipherment"], { signal, timeout: 10000 });
  await execute("openssl", ["x509", "-req", "-in", csr, "-CA", ca, "-CAkey", caKey,
    "-CAcreateserial", "-out", cert, "-days", "1", "-copy_extensions", "copy"], { signal, timeout: 10000 });
  const upstream = new URL(upstreamUrl);
  const connections = new Set();
  const proxy = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
    const forwarded = http.request({ hostname: upstream.hostname, port: upstream.port,
      path: request.url, method: request.method, headers: request.headers }, (incoming) => {
      response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response);
    });
    forwarded.on("error", () => response.writeHead(502).end());
    request.pipe(forwarded);
  });
  proxy.on("connection", (socket) => {
    connections.add(socket); socket.on("close", () => connections.delete(socket));
  });
  proxy.on("upgrade", (request, downstream, head) => {
    const upstreamSocket = net.connect(Number(upstream.port), upstream.hostname, () => {
      const headers = Object.entries(request.headers).map(([name, value]) => `${name}: ${value}`).join("\r\n");
      upstreamSocket.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers}\r\n\r\n`);
      if (head.length) upstreamSocket.write(head);
      downstream.pipe(upstreamSocket); upstreamSocket.pipe(downstream);
    });
    upstreamSocket.on("error", () => downstream.destroy());
    downstream.on("error", () => upstreamSocket.destroy());
    downstream.on("close", () => upstreamSocket.destroy());
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject); proxy.listen(0, "127.0.0.1", resolve);
  });
  const httpUrl = `https://127.0.0.1:${proxy.address().port}`;
  const serverUrl = httpUrl.replace("https:", "wss:");
  try {
    // Node starts with only this extra CA; default trust remains enabled.
    const trustedEnv = { ...process.env, NODE_EXTRA_CA_CERTS: ca };
    delete trustedEnv.NODE_TLS_REJECT_UNAUTHORIZED;
    await execute(process.execPath, ["--input-type=module", "-e",
      `const response = await fetch(${JSON.stringify(`${httpUrl}/healthz`)}); if (!response.ok) process.exit(1);`],
    { env: trustedEnv, signal, timeout: 10000 });
    let rejected = false;
    try {
      const env = { ...process.env }; delete env.NODE_EXTRA_CA_CERTS; delete env.NODE_TLS_REJECT_UNAUTHORIZED;
      await execute(process.execPath, ["--input-type=module", "-e",
        `await fetch(${JSON.stringify(`${httpUrl}/healthz`)});`], { env, signal, timeout: 10000 });
    } catch { rejected = true; }
    assert(rejected, "A process without the test CA must reject this TLS endpoint");
  } catch (error) {
    for (const socket of connections) socket.destroy();
    await new Promise((resolve) => proxy.close(resolve));
    throw error;
  }
  let closePromise;
  return { serverUrl, ca, close() {
    if (!closePromise) closePromise = (async () => {
      for (const socket of connections) socket.destroy();
      await new Promise((resolve) => proxy.close(resolve));
    })();
    return closePromise;
  } };
}
