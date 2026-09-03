import http from "node:http";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function probeRenderer(url, requestTimeoutMs) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { agent: false }, (response) => {
      response.resume();
      if ((response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 400) {
        resolve();
      } else {
        reject(new Error("Renderer development server returned a non-success response"));
      }
    });
    request.setTimeout(requestTimeoutMs, () => {
      request.destroy(new Error("Renderer development server probe timed out"));
    });
    request.once("error", reject);
  });
}

function parseLoopbackRendererUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Renderer development server must use loopback HTTP");
  }
  const loopback = url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "[::1]";
  if (
    url.protocol !== "http:"
    || !loopback
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new TypeError("Renderer development server must use loopback HTTP");
  }
  return url;
}

export async function waitForRendererDevServer(value, options = {}) {
  const url = parseLoopbackRendererUrl(value);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 100;
  const requestTimeoutMs = options.requestTimeoutMs ?? 500;
  const probe = options.probe ?? probeRenderer;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Renderer readiness timeout must be a positive safe integer");
  }
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new RangeError("Renderer readiness interval must be a positive safe integer");
  }
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new RangeError("Renderer probe timeout must be a positive safe integer");
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await probe(url, requestTimeoutMs);
      return;
    } catch {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await delay(Math.min(intervalMs, remaining));
    }
  }
  throw new Error(
    `Renderer development server did not become ready within ${timeoutMs} ms`,
  );
}
