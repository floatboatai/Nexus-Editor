const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { readFile, mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const html = `<!doctype html><meta charset="utf-8"><script>
window.searchSmoke = (async () => {
  const { SearchController } = await import('/workspace.js');
  const { createBrowserSearchExecutor } = await import('/browser-worker.js');
  let content = '😀 needle needle';
  let version = '1';
  const controller = new SearchController({
    executor: createBrowserSearchExecutor(),
    source: {
      list: async () => [{ id: 'a', path: 'A.md', version }],
      read: async () => ({ content, version }),
    },
  });
  const report = {};
  try {
    await controller.search({ text: 'needle' });
    report.hits = controller.getState().hits.length;
    report.offset = controller.getState().hits[0].from;
    content = 'a'.repeat(48) + '!';
    version = '2';
    await controller.search({ text: '^(a+)+$', regex: true });
    report.timeout = controller.getState().error?.code;
    await controller.search({ text: '!' });
    report.recovered = controller.getState().hits.length;
    const pending = controller.search({ text: '^(a+)+$', regex: true });
    setTimeout(() => controller.cancel(), 30);
    await pending;
    report.cancelled = controller.getState().status;
  } finally { await controller.destroy(); }
  return report;
})();
</script>`;

async function main() {
  const temporary = await mkdtemp(path.join(tmpdir(), "nexus-search-browser-"));
  app.setPath("userData", temporary);
  let window;
  let timeout;
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname === "/") {
        response.setHeader("Content-Type", "text/html");
        response.end(html);
      } else if (/^\/[a-zA-Z0-9-]+\.js$/.test(pathname)) {
        response.setHeader("Content-Type", "text/javascript");
        response.end(await readFile(path.join(__dirname, "../dist", pathname.slice(1))));
      } else { response.writeHead(404); response.end(); }
    } catch { response.writeHead(404); response.end(); }
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    await app.whenReady();
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const address = server.address();
    await window.loadURL(`http://127.0.0.1:${address.port}/`);
    const report = await Promise.race([
      window.webContents.executeJavaScript("window.searchSmoke"),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Browser search smoke timed out")), 15000); }),
    ]);
    assert.deepEqual(report, { hits: 2, offset: 3, timeout: "timeout", recovered: 1, cancelled: "idle" });
    console.log("Real browser worker checks passed", JSON.stringify(report));
  } finally {
    clearTimeout(timeout);
    window?.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(temporary, { recursive: true, force: true });
  }
}
main().then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
