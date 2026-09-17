import assert from "node:assert/strict";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.BLOCK_DRAG_URL ?? "http://127.0.0.1:5178";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
let assertions = 0;
const expected = async value => {
  assert.equal(await page.evaluate(() => window.fixture.editor.getDocument()), value);
  assertions++;
};
const pauseFrames = () => page.evaluate(() => new Promise(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
}));
const load = async source => {
  await page.evaluate(value => window.fixture.load(value), source);
  await page.evaluate(() => { window.fixture.view.scrollDOM.scrollTop = 0; });
  await pauseFrames();
};
const hoverBlock = async position => {
  const point = await page.evaluate(position => {
    const view = window.fixture.view;
    const block = view.lineBlockAt(position);
    const rect = view.contentDOM.getBoundingClientRect();
    return {
      x: rect.left + 90,
      y: view.documentTop + block.top * view.scaleY + 10,
    };
  }, position);
  await page.mouse.move(point.x, point.y);
  await pauseFrames();
};
const handle = async position => {
  await hoverBlock(position);
  const box = await page.locator(".nexus-block-drag-handle").boundingBox();
  assert.ok(box, "hover exposes block handle");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const dragToEnd = async (position = 0, cancel = false, beforeRelease) => {
  const grip = await handle(position);
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await pauseFrames();
  const destination = await page.evaluate(() => {
    const view = window.fixture.view;
    const rect = view.scrollDOM.getBoundingClientRect();
    const last = view.lineBlockAt(view.state.doc.length);
    return {
      x: rect.left + 160,
      y: Math.min(rect.bottom - 8, view.documentTop + last.bottom * view.scaleY + 5),
    };
  });
  await page.mouse.move(destination.x, destination.y, { steps: 12 });
  await pauseFrames();
  if (beforeRelease) await beforeRelease();
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
  await pauseFrames();
};

const dragToStart = async position => {
  const grip = await handle(position);
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await pauseFrames();
  const destination = await page.evaluate(() => {
    const view = window.fixture.view;
    return {
      x: view.scrollDOM.getBoundingClientRect().left + 150,
      y: view.documentTop + 2,
    };
  });
  await page.mouse.move(destination.x, destination.y, { steps: 12 });
  await page.mouse.up();
  await pauseFrames();
};

const pixel = "data:image/png;base64,"
  + "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPZkAAAAASUVORK5CYII=";
const blocks = [
  "First paragraph",
  "# Heading",
  "> Quote\n> second line",
  "- First\n- Second\n  - Nested",
  "```js\nconst n = 1;\n```",
  "    code",
  "---",
  "| A | B |\n| --- | --- |\n| one | two |",
  `Image ![pixel](${pixel})`,
];

try {
  for (const preview of [false, true]) {
    await page.goto(`${origin}/packages/plugin-block-drag/test/browser/index.html?preview=${preview}`);
    await page.waitForFunction(() => window.fixture);
    for (const block of blocks) {
      const source = `${block}\n\nTail`;
      await load(source);
      await dragToEnd();
      await expected(`Tail\n\n${block}`);
      await page.evaluate(() => window.fixture.editor.undo());
      await expected(source);
      await page.evaluate(() => window.fixture.editor.redo());
      await expected(`Tail\n\n${block}`);
      await dragToStart(6);
      await expected(source);
    }
    await load("First\n\nSecond\n\nThird");
    await dragToEnd(0, true);
    await expected("First\n\nSecond\n\nThird");
    for (const zoom of [0.75, 1.5]) {
      await page.evaluate(zoom => {
        document.querySelector("#editor").style.zoom = String(zoom);
      }, zoom);
      await load("First\n\nSecond");
      await dragToEnd();
      await expected("Second\n\nFirst");
    }
    await page.evaluate(() => { document.querySelector("#editor").style.zoom = "1"; });
    await load("First\n\nSecond\n\nThird");
    await handle(0);
    await page.locator(".nexus-block-drag-handle").focus();
    await page.keyboard.press("ArrowDown");
    await pauseFrames();
    assert.equal(
      await page.locator(".nexus-block-drag-handle").evaluate(element =>
        element === document.activeElement
      ),
      true,
      "keyboard movement retains handle focus"
    );
    await page.keyboard.press("ArrowDown");
    await expected("Second\n\nThird\n\nFirst");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expected("First\n\nSecond\n\nThird");

    await page.evaluate(() => window.fixture.readOnly(true));
    await hoverBlock(0);
    assert.equal(
      await page.locator(".nexus-block-drag-handle").isVisible(),
      false,
      "read-only handle must be hidden"
    );
    await expected("First\n\nSecond\n\nThird");
    await page.evaluate(() => window.fixture.readOnly(false));
    const grip = await handle(0);
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x + 100, grip.y + 100, { steps: 5 });
    await page.evaluate(() => window.fixture.enable(false));
    await page.mouse.up();
    assert.equal(await page.locator(".nexus-block-drag").count(), 0);
    await expected("First\n\nSecond\n\nThird");
    await page.evaluate(() => window.fixture.enable(true));

    await load(Array.from({ length: 100 }, (_, i) => `Paragraph ${i}`).join("\n\n"));
    const longGrip = await handle(0);
    await page.mouse.move(longGrip.x, longGrip.y);
    await page.mouse.down();
    const rect = await page.locator(".cm-scroller").boundingBox();
    await page.mouse.move(rect.x + 150, rect.y + rect.height - 3, { steps: 12 });
    await page.waitForFunction(() => window.fixture.view.scrollDOM.scrollTop > 100);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    const stopped = await page.evaluate(() => window.fixture.view.scrollDOM.scrollTop);
    await pauseFrames();
    assert.equal(await page.evaluate(() => window.fixture.view.scrollDOM.scrollTop), stopped);
    assertions++;
  }

  const table = "| A | B |\n| --- | --- |\n| old | value |\n\nTail";
  await load(table);
  await page.evaluate(() => { window.allowCellSave = window.fixture.rejectCellSave(); });
  const cell = page.locator(".nexus-cell").nth(2);
  await cell.click();
  await cell.fill("UNSAVED");
  await dragToEnd();
  await expected(table);
  assert.ok(await page.evaluate(() => window.fixture.rejected()) > 0);
  assert.equal(await cell.textContent(), "UNSAVED");
  await page.evaluate(() => window.allowCellSave());
  await dragToEnd();
  await expected("Tail\n\n| A | B |\n| --- | --- |\n| UNSAVED | value |");
  await page.evaluate(() => window.fixture.editor.undo());
  await expected(table.replace("old", "UNSAVED"));

  await load("First paragraph\n\nSecond paragraph\n\nThird paragraph");
  if (process.env.BLOCK_DRAG_SCREENSHOT) {
    const path = process.env.BLOCK_DRAG_SCREENSHOT;
    const draggingPath = path.endsWith(".png")
      ? `${path.slice(0, -4)}-dragging.png`
      : `${path}-dragging.png`;
    await mkdir(dirname(path), { recursive: true });
    await dragToEnd(0, false, () => page.screenshot({ path: draggingPath }));
    await expected("Second paragraph\n\nThird paragraph\n\nFirst paragraph");
    await page.screenshot({ path });
  } else {
    await dragToEnd();
  }
  assert.deepEqual(errors, [], "no browser errors");
  console.log([
    `Browser block reordering passed: ${assertions} document/scroll assertions;`,
    "source + live preview, all block types, undo/redo, cancellation, zoom,",
    "keyboard focus, read-only, unload, autoscroll, rejected table save and retry.",
  ].join(" "));
} finally {
  await browser.close();
}
