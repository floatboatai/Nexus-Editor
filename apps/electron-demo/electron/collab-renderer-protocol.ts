import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const BUILT_RENDERER_URL = "nexus-app://editor/index.html";

function staticContentType(filename: string): string {
  switch (path.extname(filename).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": case ".mjs": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json";
    case ".wasm": return "application/wasm";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".avif": return "image/avif";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    case ".ttf": return "font/ttf";
    default: return "application/octet-stream";
  }
}

/** A standard, secure application origin, never a general filesystem or URL proxy. */
export function createRendererProtocolHandler(distRoot: string, policy: string): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const url = new URL(request.url);
      if (request.method !== "GET" || url.protocol !== "nexus-app:" || url.host !== "editor"
        || url.username || url.password || url.search || url.hash) throw new TypeError();
      const pathname = decodeURIComponent(url.pathname);
      if (!pathname.startsWith("/") || /[\\\u0000-\u001f\u007f]/u.test(pathname)
        || pathname.split("/").some((segment) => segment === "." || segment === "..")) throw new TypeError();
      const root = await realpath(distRoot);
      const filename = await realpath(path.join(root, pathname.slice(1)));
      const relative = path.relative(root, filename);
      if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)
        || !(await stat(filename)).isFile()) throw new TypeError();
      return new Response(new Uint8Array(await readFile(filename)), {
        headers: {
          "content-type": staticContentType(filename),
          "content-security-policy": policy,
          "x-content-type-options": "nosniff",
          "cache-control": "no-store",
        },
      });
    } catch {
      return new Response("Not found", { status: 404, headers: { "content-security-policy": "default-src 'none'" } });
    }
  };
}
