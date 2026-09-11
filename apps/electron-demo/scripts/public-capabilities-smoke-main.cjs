const assert = require("node:assert/strict");
const { readFile, readdir } = require("node:fs/promises");
const path = require("node:path");
const { app, BrowserWindow, dialog } = require("electron");

const root = process.env.NEXUS_PUBLIC_SMOKE_ROOT;
const mode = process.env.NEXUS_PUBLIC_SMOKE_MODE;
if (!root || !["legacy", "runtime", "public"].includes(mode)) throw new Error("Missing isolated smoke configuration");
app.setPath("userData", path.join(root, mode));
app.setPath("sessionData", path.join(root, mode));
const openPaths = [];
const savePaths = [];
dialog.showOpenDialog = async () => {
  assert.ok(openPaths.length, "Unexpected native open dialog");
  return { canceled: false, filePaths: [openPaths.shift()] };
};
dialog.showSaveDialog = async () => {
  assert.ok(savePaths.length, "Unexpected native save dialog");
  return { canceled: false, filePath: savePaths.shift() };
};
const errors = [];
app.on("web-contents-created", (_event, contents) => {
  contents.on("console-message", (_event, level, message) => {
    if (level >= 3) errors.push(message);
  });
});
require(path.join(root, "app/dist-electron/main.js"));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 10_000) {
  const end = Date.now() + timeout;
  do { if (await check()) return; await sleep(30); } while (Date.now() < end);
  const controls = window && !window.isDestroyed()
    ? await window.webContents.executeJavaScript("[...document.querySelectorAll('button')].map((button) => ({label: button.getAttribute('aria-label'), disabled: button.disabled}))", true)
    : [];
  throw new Error(`Timed out: ${label}; status: ${window && !window.isDestroyed() ? await status() : "closed"}; content: ${window && !window.isDestroyed() ? await content() : "closed"}; controls: ${JSON.stringify(controls)}; renderer errors: ${errors.join("; ")}`);
}
let window;
function run(fn, ...args) {
  return window.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
}
function control(label, value) {
  return run((label, value) => {
    const root = document.querySelector(".public-capabilities-launcher") ?? document;
    const node = [...root.querySelectorAll("[aria-label]")].find((node) => node.getAttribute("aria-label") === label);
    if (!node) throw new Error(`Missing ${label}`);
    if (value !== undefined && value !== null) {
      if (node.type === "checkbox") node.checked = value;
      else node.value = value;
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    } else node.click();
  }, label, value);
}
function content() {
  // Read the real view for assertions only; edits below use native input events.
  return run(() => document.querySelector(".public-capabilities-launcher .cm-content")?.cmTile?.root?.view?.state.doc.toString() ?? "");
}
function status() {
  return run(() => document.querySelector(".public-capabilities-launcher [role=status]")?.textContent ?? "");
}
async function replaceDocument(value) {
  await run(() => {
    const view = document.querySelector(".public-capabilities-launcher .cm-content").cmTile.root.view;
    view.focus();
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  });
  await window.webContents.insertText(value);
  await waitFor(async () => await content() === value, "native text input");
}
async function importFile(name, expected) {
  openPaths.push(path.join(root, name));
  await control("导入 HTML/CSV/DOCX/PDF");
  await waitFor(async () => (await content()).includes(expected), `import ${name}`, 20_000);
  assert.match(await status(), /新的未保存/);
}

async function main() {
  await app.whenReady();
  await waitFor(() => (window = BrowserWindow.getAllWindows()[0]), "main window");
  await waitFor(() => run(() => Boolean(document.querySelector(".cm-content"))), "editor startup");
  await run(() => { window.confirm = () => true; });
  if (mode === "legacy") {
    assert.equal(await run(() => typeof window.nexusPublicCapabilities), "undefined");
    for (const [title, selector] of [["Toggle outline", ".nexus-outline-panel"], ["Toggle backlinks panel", ".backlinks-panel"]]) {
      const visible = () => run((selector) => Boolean(document.querySelector(selector)?.getBoundingClientRect().width), selector);
      const initial = await visible();
      for (const expected of [!initial, initial]) {
        await run((title) => document.querySelector(`[title="${title}"]`).click(), title);
        await waitFor(async () => await visible() === expected, `${mode} toggle ${title}`);
      }
    }
    console.log(JSON.stringify({ smoke: "production-public-capabilities", mode, ok: true, panelsToggle: true }));
    return;
  }
  await waitFor(() => run(() => Boolean(document.querySelector(".public-capabilities-launcher .cm-content"))), "capabilities panel");
  assert.equal(await run(() => Boolean(window.nexusPublicCapabilities)), true);
  assert.equal(await run(() => Boolean(document.querySelector(".public-capabilities-launcher .cm-search"))), false);
  openPaths.push(path.join(root, "encoded.md"));
  await control("打开 Markdown");
  await waitFor(async () => (await status()).includes("需要明确选择编码"), "encoding candidates");
  assert.equal(await run(() => document.querySelector('[aria-label="文本编码"]').value), "");
  await control("文本编码", "gbk"); await control("确认读取编码");
  await waitFor(async () => (await content()).includes("中文初始内容"), "GBK decode");
  await control("显式启用保存历史", true);
  await waitFor(async () => (await status()).includes("内容版本"), "history enabled");
  const edited = "# Edited\n\n中文 second version\n";
  await replaceDocument(edited);
  await control("文本编码", "utf-16le"); await control("BOM", true); await control("换行", "crlf");
  await control("保存");
  await waitFor(async () => (await status()).startsWith("已保存"), "encoded save");
  const bytes = await readFile(path.join(root, "encoded.md"));
  assert.deepEqual([...bytes.subarray(0, 2)], [255, 254]);
  assert.equal(bytes.subarray(2).toString("utf16le"), edited.replace(/\n/g, "\r\n"));
  await run(() => { const versions = document.querySelector('[aria-label="内容版本"]'); if (versions.options.length < 2) throw new Error("Missing saved history"); versions.selectedIndex = versions.options.length - 1; });
  await control("比较版本");
  await waitFor(async () => (await status()).includes("处差异"), "line diff");
  await control("恢复到缓冲区");
  await waitFor(async () => (await status()).includes("恢复：applied") || (await content()).includes("中文初始内容"), "buffer-only restoration");
  assert.match(await content(), /中文初始内容/);
  assert.deepEqual(await readFile(path.join(root, "encoded.md")), bytes);
  assert.equal(await run(() => document.querySelector('[aria-label="文本编码"]').value), "utf-16le");
  await run(() => document.querySelector(".public-capabilities-launcher .cm-content").focus());
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Z", modifiers: [process.platform === "darwin" ? "meta" : "control"] });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Z" });
  await waitFor(async () => await content() === edited, "one undo restore");
  console.log("Production codec/history checks passed");

  await replaceDocument("#  Images  \n\n$x^2$\n\n");
  const png = [...await readFile(path.join(root, "pixel.png"))];
  await run((bytes) => {
    const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], "pixel.png", { type: "image/png" }));
    document.querySelector(".public-capabilities-launcher .cm-content").dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  }, png);
  await waitFor(async () => (await content()).includes("nexus-asset:"), "managed image paste");
  await control("保存");
  await waitFor(async () => (await content()).includes("_assets/"), "asset-first Markdown save");
  assert.ok((await content()).startsWith("#  Images  \n"), "Asset rewrite changed unrelated source spacing");
  assert.equal((await readdir(path.join(root, "_assets"))).length, 1);
  savePaths.push(path.join(root, "offline.html"));
  await control("离线 HTML");
  await waitFor(async () => (await status()).includes("已导出"), "offline export", 20_000);
  const html = await readFile(path.join(root, "offline.html"), "utf8");
  assert.match(html, /data:image\/png;base64/); assert.match(html, /katex/);
  assert.doesNotMatch(html, /(?:src|href)="(?:blob:|nexus-asset:|_assets\/)/);
  console.log("Production images/offline HTML checks passed");

  await importFile("sample.csv", "中文");
  await importFile("sample.docx", "中文 DOCX");
  savePaths.push(path.join(root, "converted.md"));
  await control("保存");
  await waitFor(async () => (await status()).startsWith("已保存"), "converted document save");
  assert.match(await readFile(path.join(root, "converted.md"), "utf8"), /_assets\//);
  await importFile("sample.pdf", "Production PDF text");
  openPaths.push(path.join(root, "sample.html"), root);
  await control("导入 HTML/CSV/DOCX/PDF");
  await waitFor(async () => (await content()).includes("HTML import"), "authorized HTML import");
  assert.match(await content(), /nexus-asset:/);
  console.log("Production HTML/CSV/DOCX/PDF imports passed");

  openPaths.push(path.join(root, "vault")); await control("选择 Vault");
  await waitFor(async () => (await status()).includes("已授权 Vault"), "Vault grant");
  await control("查找内容", "needle"); await control("跨文档搜索");
  await waitFor(() => run(() => document.querySelectorAll('.public-capabilities-launcher [aria-label="跨文档搜索结果"] button').length === 2), "workspace Worker search");
  await control("模糊查找文件", "a"); await control("Vault 文档", "A.md"); await control("打开所选文档");
  await waitFor(async () => (await content()).includes("needle alpha"), "fuzzy file navigation");
  await control("文内查找");
  await waitFor(() => run(() => document.querySelector(".public-capabilities-launcher")?.textContent.includes("文内：ready · 1 个结果") && document.querySelectorAll(".public-capabilities-launcher .cm-searchMatch").length === 1), "headless search");
  await control("替换内容", "replaced"); await control("全部替换");
  await waitFor(async () => (await content()).includes("replaced alpha"), "headless replace");
  assert.equal(openPaths.length + savePaths.length, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ smoke: "production-public-capabilities", mode, ok: true, encoding: true, history: true,
    assetSave: true, offlineHtml: true, imports: ["html", "csv", "docx", "pdf"], workerSearch: true, headlessReplace: true }));
}
main().then(() => { for (const win of BrowserWindow.getAllWindows()) win.destroy(); app.exit(0); }, (error) => {
  console.error(error); console.error("Renderer errors:", errors); app.exit(1);
});
