const { app, BrowserWindow, Menu, session } = require("electron");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = process.env.NEXUS_CORE_SMOKE_ROOT;
const url = process.env.NEXUS_CORE_SMOKE_URL;
if (!root || !url) throw new Error("Missing isolated smoke configuration");
app.setPath("userData", path.join(root, "user-data"));
app.setPath("sessionData", path.join(root, "session-data"));
let window;
let finished = false;
const reports = [];
const plan = [];
const selectedCases = new Set((process.env.NEXUS_CORE_SMOKE_CASES ?? "").split(",").filter(Boolean));
let sent = [];
const deadline = setTimeout(() => finish({ ok: false, error: "Core interaction smoke timed out", reports }), 50_000);
function finish(result) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  console.log(JSON.stringify({ smoke: "core-native-interactions", source: process.env.NEXUS_CORE_SMOKE_REF, ...result }));
  if (window && !window.isDestroyed()) window.destroy();
  app.exit(result.ok ? 0 : 1);
}
const pause = (duration = 60) => new Promise((resolve) => setTimeout(resolve, duration));
const invoke = (name, ...args) => window.webContents.executeJavaScript(`window.coreInteractionSmoke[${JSON.stringify(name)}](...${JSON.stringify(args)})`);
function send(input) {
  sent.push({ time: Date.now(), ...input });
  window.webContents.sendInputEvent(input);
}
async function waitFor(check, message) {
  const end = Date.now() + 2500;
  let state;
  do {
    state = await invoke("state");
    if (check(state)) return state;
    await pause(40);
  } while (Date.now() < end);
  throw new Error(`${message}: ${JSON.stringify(state)}`);
}
async function click(point) {
  window.focus();
  send({ type: "mouseMove", ...point });
  await pause(30);
  await invoke("validatePoint", point);
  send({ type: "mouseDown", button: "left", modifiers: ["leftButtonDown"], clickCount: 1, ...point });
  await pause(30);
  await invoke("validateMouseButtons", "mousedown", 1);
  send({ type: "mouseUp", button: "left", clickCount: 1, ...point });
  await pause();
}
async function drag(from, to) {
  window.focus();
  send({ type: "mouseMove", ...from });
  await pause(30);
  await invoke("validatePoint", from);
  send({ type: "mouseDown", button: "left", modifiers: ["leftButtonDown"], clickCount: 1, ...from });
  await pause(20);
  await invoke("validateMouseButtons", "mousedown", 1);
  for (let step = 1; step <= 8; step += 1) {
    send({ type: "mouseMove", button: "left", modifiers: ["leftButtonDown"],
      x: Math.round(from.x + (to.x - from.x) * step / 8), y: Math.round(from.y + (to.y - from.y) * step / 8) });
    await pause(30);
  }
  send({ type: "mouseUp", button: "left", clickCount: 1, ...to });
  await pause(100);
}
async function press(keyCode) {
  send({ type: "keyDown", keyCode });
  send({ type: "keyUp", keyCode });
  await pause();
}
async function runCase(name, run) {
  if (!selectedCases.size || selectedCases.has(name)) plan.push({ name, run });
}
const table = "Before table\n\n| A | B | C |\n| --- | --- | --- |\n| one | two | three |\n| four | five | six |\n\nAfter table";
const assetTable = "Before table\n\n| A | B |\n| --- | --- |\n| 1 | old |\n\nAfter table";

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  session.defaultSession.webRequest.onBeforeRequest((request, callback) => callback({
    cancel: !request.url.startsWith(url) && !request.url.startsWith("data:") && !request.url.startsWith("blob:"),
  }));
  window = new BrowserWindow({ width: 880, height: 680, show: true, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
  } });
  window.webContents.on("console-message", (details) => {
    if (details.level === "warning" || details.level === "error") console.error(`[core interaction renderer] ${details.message}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => finish({ ok: false, error: `Renderer exited: ${details.reason}`, reports }));
  await window.loadURL(url);
  app.focus({ steal: true });
  window.focus();
  window.webContents.focus();
  await pause(200);
  await window.webContents.executeJavaScript("new Promise((resolve, reject) => { const end = Date.now() + 5000; const check = () => window.coreInteractionSmoke ? resolve() : Date.now() > end ? reject(new Error('Renderer did not initialize')) : setTimeout(check, 20); check(); })");
  if (process.env.NEXUS_CORE_SMOKE_TABLE_ONLY !== "1") {
    await runCase("managed-document-drop-position", async () => {
      await invoke("reset", "abcd", false);
      await invoke("selectDocument", 4);
      const coordinate = await invoke("positionPoint", 1);
      assert.equal(coordinate.position, 1);
      send({ type: "mouseMove", x: coordinate.x, y: coordinate.y });
      const transferred = await invoke("drop", { x: coordinate.x, y: coordinate.y });
      assert.equal(transferred.prevented, true);
      await invoke("selectDocument", 0);
      await invoke("releaseUploads");
      await waitFor((state) => state.events.at(-1)?.status === "inserted", "Drop did not finish");
      assert.equal((await invoke("state")).markdown, "a![a.png](_assets/a.png)bcd");
      assert.equal(await invoke("undo"), true);
      assert.equal((await invoke("state")).markdown, "abcd");
    });
    await runCase("managed-table-paste-continuation-blur-undo", async () => {
      await invoke("reset", assetTable);
      await click(await invoke("point", ".nexus-cell", 3));
      await invoke("cellCaret", 3, 1);
      assert.equal((await invoke("paste")).prevented, true);
      await invoke("releaseUploads");
      await waitFor((state) => state.events.at(-1)?.status === "inserted", "Table upload did not finish");
      await window.webContents.insertText(" continued");
      await click(await invoke("point", "#outside"));
      await waitFor((state) => state.markdown.includes("o![a.png](_assets/a.png) continuedld"), "Native continuation was not committed");
      assert.equal(await invoke("undo"), true);
      assert.match((await invoke("state")).markdown, /o!\[a\.png\]\(_assets\/a\.png\)ld/);
      assert.equal(await invoke("undo"), true);
      assert.equal((await invoke("state")).markdown, assetTable);
    });
    await runCase("rejected-restore-keeps-native-cell-session", async () => {
      await invoke("reset", assetTable);
      await click(await invoke("point", ".nexus-cell", 3));
      await invoke("selectCellText", 3);
      await window.webContents.insertText("pending");
      await pause();
      assert.equal((await invoke("rejectedRestore")).status, "transaction-rejected");
      assert.equal((await invoke("state")).active, "nexus-cell");
      await window.webContents.insertText(" continued");
      await click(await invoke("point", "#outside"));
      await waitFor((state) => state.markdown.includes("pending continued"), "Rejected restore lost subsequent native input");
    });
    await runCase("filtered-table-upload-position-continuation-snapshot-undo", async () => {
      await invoke("reset", assetTable);
      await click(await invoke("point", ".nexus-cell", 3));
      await invoke("cellCaret", 3, 1);
      await invoke("normalizeUpload", true);
      assert.equal((await invoke("paste")).prevented, true);
      await invoke("releaseUploads");
      await waitFor((state) => state.events.at(-1)?.status === "inserted", "Normalized upload did not finish");
      const committed = (await invoke("state")).markdown;
      assert.match(committed, /Inserted prefix/);
      assert.match(committed, /https:\/\/example.invalid\/a.png/);
      assert.equal((await invoke("state")).active, "nexus-cell");
      await window.webContents.insertText(" continued");
      assert.match((await invoke("capture")).markdown, /o!\[a\.png\]\(https:\/\/example.invalid\/a.png\) continuedld/);
      await click(await invoke("point", "#outside"));
      await waitFor((state) => state.markdown.includes(" continuedld"), "Filtered upload lost continuation on blur");
      assert.equal(await invoke("undo"), true);
      assert.equal((await invoke("state")).markdown, committed);
      assert.equal(await invoke("undo"), true);
      assert.equal((await invoke("state")).markdown, assetTable);
    });
    await runCase("filtered-strict-flush-keeps-native-cell-session", async () => {
      await invoke("reset", assetTable);
      await click(await invoke("point", ".nexus-cell", 3));
      await invoke("selectCellText", 3);
      await window.webContents.insertText("pending");
      await pause();
      assert.equal((await invoke("normalizedRestore")).status, "conflict");
      assert.equal((await invoke("state")).active, "nexus-cell");
      assert.match((await invoke("capture")).markdown, /normalized/);
      await window.webContents.insertText(" continued");
      await click(await invoke("point", "#outside"));
      await waitFor((state) => state.markdown.includes("normalized continued"), "Normalized strict flush lost continuation");
      assert.equal(await invoke("undo"), true);
      assert.equal((await invoke("capture")).markdown, (await invoke("state")).markdown);
    });
    await runCase("filtered-table-structure-retires-old-cell", async () => {
      await invoke("reset", assetTable);
      await click(await invoke("point", ".nexus-cell", 3));
      await invoke("cellCaret", 3, 1);
      await invoke("normalizeUpload", false, true);
      assert.equal((await invoke("paste")).prevented, true);
      await invoke("releaseUploads");
      const result = await waitFor((state) => state.events.at(-1)?.status === "inserted", "Structural filter did not finish");
      assert.equal(result.cells.length, 0);
      assert.equal(result.diagnostics.interactionActive, false);
      assert.match((await invoke("capture")).markdown, /Filter replaced the table with text/);
      assert.equal(await invoke("undo"), true);
      assert.equal((await invoke("state")).markdown, assetTable);
    });
  }
  await runCase("table-click-to-edit", async () => {
    await invoke("reset", table);
    await click(await invoke("point", ".nexus-cell", 3));
    await invoke("selectCellText", 3);
    await window.webContents.insertText("edited");
    await click(await invoke("point", "#outside"));
    await waitFor((state) => state.markdown.includes("edited"), "Click editing did not commit");
  });
  await runCase("table-drag-range-and-outside-deselect", async () => {
    await invoke("reset", table);
    await drag(await invoke("point", ".nexus-cell", 3), await invoke("point", ".nexus-cell", 7));
    assert.equal((await invoke("state")).selected, 4);
    await pause(120);
    assert.equal((await invoke("state")).selected, 4);
    await click(await invoke("point", "#outside"));
    assert.equal((await invoke("state")).selected, 0);
  });
  await runCase("table-grip-column-and-delete", async () => {
    await invoke("reset", table);
    await click(await invoke("point", ".nexus-col-grip", 1));
    assert.equal((await invoke("state")).selected, 3);
    await press("Delete");
    await waitFor((state) => state.headers.join(",") === "A,C", "Column deletion did not update the visible table");
  });
  await runCase("table-grip-reorder-after-active-edit", async () => {
    await invoke("reset", table);
    await click(await invoke("point", ".nexus-cell", 3));
    await invoke("selectCellText", 3);
    await window.webContents.insertText("edited");
    await drag(await invoke("point", ".nexus-col-grip", 0), await invoke("point", ".nexus-col-grip", 2));
    await waitFor((state) => state.headers.join(",") === "B,C,A", "Column reorder did not update the visible table");
    assert.match((await invoke("state")).markdown, /\| two \| three \| edited \|/);
    assert.equal(await invoke("undo"), true);
    assert.equal((await invoke("state")).markdown, table);
  });
  await runCase("table-range-delete-visible-content", async () => {
    await invoke("reset", table);
    await drag(await invoke("point", ".nexus-cell", 3), await invoke("point", ".nexus-cell", 7));
    await press("Delete");
    await waitFor((state) => !state.markdown.includes("one") && !state.markdown.includes("five"), "Range deletion did not edit Markdown");
    const state = await invoke("state");
    assert.deepEqual(state.body.map((value) => value.trim()), ["", "", "three", "", "", "six"]);
  });
  if (!plan.length) throw new Error("No smoke cases selected");
  for (let round = 1; round <= Number(process.env.NEXUS_CORE_SMOKE_REPEATS ?? 1); round += 1) {
    for (const { name, run } of plan) {
      console.log(`[core interaction smoke] ${name} (round ${round})`);
      sent = [];
      try { await run(); reports.push({ name, round, ok: true }); }
      catch (error) { reports.push({ name, round, ok: false, error: error.message, sent, state: await invoke("state").catch(() => null) }); }
    }
  }
  await invoke("destroy");
  finish({ ok: reports.every((result) => result.ok), reports });
}).catch((error) => finish({ ok: false, error: error.message, reports }));
