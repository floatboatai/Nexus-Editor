import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const appDirectory = path.join(root, "apps/electron-demo");
const require = createRequire(path.join(appDirectory, "package.json"));
const executablePath = require("electron");
const frame = page => page.evaluate(() => new Promise(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
}));
const original = ["First paragraph", "Second paragraph", "Third paragraph"];
const modifier = process.platform === "darwin" ? "Meta" : "Control";

for (const mode of ["legacy", "runtime"]) {
  const directory = await mkdtemp(path.join(tmpdir(), "nexus-block-electron-"));
  const bootstrap = path.join(directory, "bootstrap.cjs");
  await writeFile(bootstrap, [
    "const { app } = require('electron');",
    `app.setPath('userData', ${JSON.stringify(directory)});`,
    `require(${JSON.stringify(path.join(appDirectory, "dist-electron/main.js"))});`,
    "",
  ].join("\n"));
  const application = await electron.launch({
    executablePath,
    args: [bootstrap],
    env: {
      ...process.env,
      NEXUS_PLUGIN_PLATFORM: mode === "runtime" ? "1" : "0",
      VITE_DEV_SERVER_URL: "",
    },
  });
  try {
    const page = await application.firstWindow();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const content = page.locator(".cm-content").first();
    await content.waitFor();
    await page.locator(".nexus-block-drag").waitFor({ state: "attached" });
    // A visible macOS window also receives the user's physical pointer events,
    // which can release capture between Playwright's synthetic pointer events.
    // Isolate this temporary test window while retaining renderer input and rAF.
    await application.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.setBackgroundThrottling(false);
        window.hide();
      }
    });
    await content.click();
    await page.keyboard.press(`${modifier}+A`);
    await page.keyboard.insertText(original.join("\n\n"));
    await frame(page);
    const lines = async () => {
      const values = await page.locator(".cm-content .cm-line").allTextContents();
      return values.map(value => value.trim()).filter(Boolean);
    };
    assert.deepEqual(await lines(), original);
    const firstLine = page.locator(".cm-line").filter({ hasText: "First paragraph" });
    const handle = page.locator(".nexus-block-drag-handle");
    const hoverBlock = async (source = firstLine) => {
      // Deferred vault restoration may reinstall runtime plugins after boot.
      // Wait for the current handle to follow the intended source, not just exist.
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const first = await source.boundingBox();
        assert.ok(first);
        await page.mouse.move(first.x + 70, first.y + first.height / 2);
        await page.mouse.move(first.x + 80, first.y + first.height / 2);
        await frame(page);
        const grip = await handle.boundingBox();
        const current = await source.boundingBox();
        if (grip && current && Math.abs(grip.y - current.y) < 2) return grip;
      }
      assert.fail(`${mode}: handle did not follow the intended source`);
    };
    const grip = await hoverBlock();
    const lastLine = page.locator(".cm-line").filter({ hasText: "Third paragraph" });
    const last = await lastLine.boundingBox();
    assert.ok(last);
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(last.x + 140, last.y + last.height - 2, { steps: 15 });
    await frame(page);
    await page.mouse.up();
    await frame(page);
    assert.deepEqual(await lines(), ["Second paragraph", "Third paragraph", "First paragraph"]);
    await page.keyboard.press(`${modifier}+z`);
    await frame(page);
    assert.deepEqual(await lines(), original);
    const again = await hoverBlock();
    await page.mouse.move(again.x + 12, again.y + 13);
    await page.mouse.down();
    await page.mouse.move(last.x + 140, last.y + last.height - 2, { steps: 10 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.deepEqual(await lines(), original);
    if (process.env.BLOCK_DRAG_SCREENSHOT) {
      await page.screenshot({
        path: process.env.BLOCK_DRAG_SCREENSHOT.replace(/\.png$/, `-${mode}.png`),
      });
    }
    await firstLine.click();
    await page.keyboard.press("Alt+Shift+ArrowDown");
    await frame(page);
    assert.deepEqual(await lines(), ["Second paragraph", "First paragraph", "Third paragraph"]);
    await firstLine.click();
    await page.keyboard.press("Alt+Shift+ArrowUp");
    await frame(page);
    assert.deepEqual(await lines(), original);

    const tableSource = "| A | B |\n| --- | --- |\n| old | value |\n\nTail";
    await firstLine.click();
    await page.keyboard.press(`${modifier}+A`);
    await page.keyboard.insertText(tableSource);
    const table = page.locator(".nexus-table-wrapper");
    const cell = page.locator(".nexus-cell").nth(2);
    await cell.click();
    await cell.fill("编辑已保存");
    const tableGrip = await hoverBlock(table);
    await page.mouse.move(tableGrip.x + tableGrip.width / 2, tableGrip.y + tableGrip.height / 2);
    await page.mouse.down();
    await frame(page);
    const tail = page.locator(".cm-line").filter({ hasText: "Tail" });
    const tailBox = await tail.boundingBox();
    assert.ok(tailBox);
    await page.mouse.move(tailBox.x + 100, tailBox.y + tailBox.height - 2, { steps: 15 });
    await page.mouse.up();
    await frame(page);
    const tableFollowsTail = () => tail.evaluate(element => Boolean(
      element.compareDocumentPosition(document.querySelector(".nexus-table-wrapper")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ));
    assert.equal(await tableFollowsTail(), true, "whole table moves after the paragraph");
    assert.equal(await cell.textContent(), "编辑已保存");
    await page.keyboard.press(`${modifier}+z`);
    await frame(page);
    assert.equal(await tableFollowsTail(), false, "one undo restores table position");
    assert.equal(await cell.textContent(), "编辑已保存", "undoing movement retains the cell edit");
    assert.deepEqual(errors, []);
    console.log(
      `Electron ${mode}: pointer drag, cancellation, default shortcuts, edited-table movement and isolated undo passed.`,
    );
  } finally {
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await application.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}
