import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.BLOCK_DRAG_URL ?? "http://127.0.0.1:5178";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const frames = () => page.evaluate(() => new Promise(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
}));
let assertions = 0;
const documentText = () => page.evaluate(() => window.fixture.editor.getDocument());
const expected = async value => {
  assert.equal(await documentText(), value);
  assertions++;
};
const load = async source => {
  await page.evaluate(source => window.fixture.load(source), source);
  await frames();
};
const center = async locator => {
  const box = await locator.boundingBox();
  assert.ok(box, "target is rendered");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const hover = async position => {
  const point = await page.evaluate(position => {
    const view = window.fixture.view;
    const rect = view.scrollDOM.getBoundingClientRect();
    return {
      x: rect.left + 120,
      y: view.documentTop + view.lineBlockAt(position).top * view.scaleY + 8,
    };
  }, position);
  await page.mouse.move(point.x, point.y);
  await frames();
};
const begin = async (position = 0) => {
  await hover(position);
  const grip = await center(page.locator(".nexus-block-drag-handle"));
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await frames();
};
const endPoint = () => page.evaluate(() => {
  const view = window.fixture.view;
  const rect = view.scrollDOM.getBoundingClientRect();
  return {
    x: rect.left + 160,
    y: Math.min(rect.bottom - 5, view.documentTop + view.lineBlockAt(view.state.doc.length).bottom + 4),
  };
});
const dragToEnd = async (position = 0) => {
  await begin(position);
  const end = await endPoint();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
  await frames();
};
const pointerDrag = async (source, target) => {
  const from = await center(source);
  const to = await center(target);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.mouse.up();
  await frames();
};

try {
  for (const preview of [false, true]) {
    await page.goto(`${origin}/packages/plugin-block-drag/test/browser/index.html?preview=${preview}`);
    await page.waitForFunction(() => window.fixture);
    const original = "First\n\nSecond\n\nThird";
    await load(original);
    await begin();
    await page.mouse.move(900, 650, { steps: 15 });
    await page.mouse.up();
    await expected(original);

    await page.evaluate(() => {
      window.capturedPointerId = null;
      document.querySelector(".nexus-block-drag-handle").addEventListener(
        "gotpointercapture",
        event => { window.capturedPointerId = event.pointerId; },
        { once: true },
      );
    });
    await begin();
    const end = await endPoint();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    const released = await page.evaluate(() => {
      const handle = document.querySelector(".nexus-block-drag-handle");
      const pointerId = window.capturedPointerId;
      if (pointerId === null || !handle.hasPointerCapture(pointerId)) return false;
      handle.releasePointerCapture(pointerId);
      return true;
    });
    assert.equal(released, true, "release the browser's actual pointer capture");
    await frames();
    await page.mouse.up();
    await expected(original);
    assert.equal(await page.locator(".is-dragging").count(), 0);

    await page.evaluate(() => { document.querySelector("#editor").style.width = "340px"; });
    await frames();
    await dragToEnd();
    await expected("Second\n\nThird\n\nFirst");
    await page.evaluate(() => { document.querySelector("#editor").style.width = "700px"; });

    const folded = "# Heading\n\nHidden paragraph\n\n# End\n\nLast";
    await load(folded);
    await page.evaluate(() => window.fixture.fold(9, 28));
    await hover(0);
    assert.equal(await page.locator(".nexus-block-drag-handle").isVisible(), false);
    await expected(folded);
    await page.evaluate(() => window.fixture.fold(9, 28, false));
    await frames();
    await begin();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.evaluate(() => window.fixture.fold(9, 28));
    await page.mouse.up();
    await expected(folded);
    assert.equal(await page.locator(".is-dragging").count(), 0);

    const wide = `\`\`\`\n${"long_code_".repeat(100)}\n\`\`\`\n\nTail`;
    await load(wide);
    await page.evaluate(() => {
      window.fixture.view.contentDOM.style.whiteSpace = "pre";
    });
    await frames();
    const scrollable = await page.evaluate(() => {
      const scroll = window.fixture.view.scrollDOM;
      const wrapper = document.querySelector(".nexus-code-wrapper");
      return scroll.scrollWidth > scroll.clientWidth ||
        (wrapper && wrapper.scrollWidth > wrapper.clientWidth);
    });
    assert.ok(scrollable, "wide content actually overflows");
    await page.evaluate(() => {
      window.fixture.view.scrollDOM.scrollLeft = 180;
    });
    await frames();
    await dragToEnd();
    await expected(`Tail\n\n${wide.slice(0, -6)}`);
  }

  const table = "| A | B | C |\n| --- | --- | --- |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n\nTail";
  const cells = page.locator(".nexus-cell");
  await load(table);
  assert.equal(await cells.nth(3).evaluate(cell => cell.isContentEditable), false);
  await cells.nth(3).click();
  await cells.nth(3).fill("中文输入");
  await page.locator("h1").click();
  await frames();
  await expected(table.replace("a1", "中文输入"));
  // This checks Unicode text handling, not a native OS input-method session.

  await load(table);
  await pointerDrag(cells.nth(3), cells.nth(8));
  await page.keyboard.press("Delete");
  await frames();
  await expected("| A | B | C |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n\nTail");

  await load(table);
  await page.locator(".nexus-col-grip").nth(1).click();
  await page.keyboard.press("Delete");
  await frames();
  await expected("| A | C |\n| --- | --- |\n| a1 | c1 |\n| a2 | c2 |\n\nTail");

  await load(table);
  await page.locator(".nexus-col-grip").nth(1).click();
  await page.locator("h1").click();
  await page.locator(".nexus-table-wrapper").focus();
  await page.keyboard.press("Delete");
  await expected(table);

  await load(table);
  await pointerDrag(page.locator(".nexus-col-grip").nth(0), page.locator(".nexus-col-grip").nth(2));
  await expected("| B | C | A |\n| --- | --- | --- |\n| b1 | c1 | a1 |\n| b2 | c2 | a2 |\n\nTail");

  await load(table);
  await pointerDrag(page.locator(".nexus-row-grip").nth(1), page.locator(".nexus-row-grip").nth(2));
  await expected("| A | B | C |\n| --- | --- | --- |\n| a2 | b2 | c2 |\n| a1 | b1 | c1 |\n\nTail");
  await dragToEnd();
  assert.ok((await documentText()).startsWith("Tail\n\n| A | B | C |"));
  assertions++;
  await cells.nth(3).click();
  await cells.nth(3).fill("after move");
  await page.locator("h1").click();
  await frames();
  assert.ok((await documentText()).includes("after move"));
  assertions++;

  assert.deepEqual(errors, [], "no browser errors");
  console.log(`Browser edge/table acceptance passed: ${assertions} document assertions plus geometry and lifecycle checks.`);
} finally {
  await browser.close();
}
