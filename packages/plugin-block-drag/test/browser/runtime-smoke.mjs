import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.BLOCK_DRAG_URL ?? "http://127.0.0.1:5178";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
let assertions = 0;
const first = "First\n\nSecond\n\nThird";
const second = "Alpha\n\nBeta\n\nGamma";
const defaultDown = "Alt+Shift+ArrowDown";
const defaultUp = "Alt+Shift+ArrowUp";
const customDown = "Control+Shift+ArrowDown";
const snapshot = () => page.evaluate(() => window.runtimeFixture.snapshot());
const pauseFrames = () => page.evaluate(() => new Promise(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
}));
const select = async (id, block = 0) => {
  await page.locator(`#${id} .cm-line`).nth(block * 2).click({ position: { x: 60, y: 8 } });
  await pauseFrames();
};
const preference = value => page.evaluate(value => window.runtimeFixture.preference(value), value);
const press = async key => {
  await page.keyboard.press(key);
  await page.evaluate(() => window.runtimeFixture.settled());
  await pauseFrames();
};
const expectDocuments = async (expectedFirst = first, expectedSecond = second) => {
  assert.deepEqual((await snapshot()).documents, { first: expectedFirst, second: expectedSecond });
  assertions++;
};
const expectDispatch = async (status, ok) => {
  const actual = (await snapshot()).lastDispatch;
  assert.equal(actual?.status, status);
  if (ok !== undefined) assert.equal(actual.ok, ok);
  assertions++;
};

try {
  await page.goto(`${origin}/packages/plugin-block-drag/test/browser/runtime.html`);
  await page.waitForFunction(() => window.runtimeFixture);
  assert.equal((await snapshot()).overlays, 2);
  assertions++;

  await select("first");
  await press(defaultDown);
  await expectDocuments("Second\n\nFirst\n\nThird");
  await expectDispatch("handled", true);
  // Select the moved source so each routing check has its own starting selection.
  await select("first", 1);
  await press(defaultUp);
  await expectDocuments();

  await select("second");
  await press(defaultDown);
  await expectDocuments(first, "Beta\n\nAlpha\n\nGamma");
  await select("second", 1);
  await press(defaultUp);
  await expectDocuments();
  await page.locator("#outside").click();
  await press(defaultDown);
  await expectDocuments();
  await expectDispatch("handled", false);

  await preference({ mode: "custom", bindings: [{ key: "ArrowDown", modifiers: ["Ctrl", "Shift"] }] });
  await select("first");
  await press(defaultDown);
  await expectDocuments();
  await expectDispatch("pass");
  await select("first");
  await press(customDown);
  await expectDocuments("Second\n\nFirst\n\nThird");
  await expectDispatch("handled", true);
  await select("first", 1);
  await press(defaultUp);
  await expectDocuments();

  await preference({ mode: "cleared" });
  for (const key of [defaultDown, customDown]) {
    await select("first");
    await press(key);
    await expectDocuments();
    await expectDispatch("pass");
  }

  await preference({ mode: "default" });
  await page.evaluate(() => window.runtimeFixture.conflict(true));
  await select("first");
  await press(defaultDown);
  await expectDocuments();
  await expectDispatch("conflict");
  assert.equal((await snapshot()).conflictingCalls, 0);
  assertions++;
  await page.evaluate(() => window.runtimeFixture.conflict(false));
  await select("first");
  await press(defaultDown);
  await expectDocuments("Second\n\nFirst\n\nThird");
  await select("first", 1);
  await press(defaultUp);
  await expectDocuments();

  await preference({ mode: "custom", bindings: [{ key: "ArrowDown", modifiers: ["Ctrl", "Shift"] }] });
  await page.evaluate(() => window.runtimeFixture.disable());
  assert.equal((await snapshot()).overlays, 0);
  assert.deepEqual((await snapshot()).commands, []);
  assertions += 2;
  for (const key of [defaultDown, customDown]) {
    await select("first");
    await press(key);
    await expectDocuments();
    await expectDispatch("pass");
  }
  await page.evaluate(() => window.runtimeFixture.enable());
  assert.equal((await snapshot()).overlays, 2);
  assert.equal((await snapshot()).commands.length, 2);
  assertions += 2;
  await select("first");
  await press(defaultDown);
  await expectDocuments();
  await expectDispatch("pass");
  await select("second");
  await press(customDown);
  await expectDocuments(first, "Beta\n\nAlpha\n\nGamma");
  await expectDispatch("handled", true);
  await select("second", 1);
  await press(defaultUp);
  await expectDocuments();

  await preference({ mode: "cleared" });
  await page.evaluate(async () => {
    await window.runtimeFixture.disable();
    await window.runtimeFixture.enable();
  });
  for (const key of [defaultDown, customDown]) {
    await select("second");
    await press(key);
    await expectDocuments();
    await expectDispatch("pass");
  }
  assert.deepEqual(errors, [], "no browser errors");
  assertions++;
  console.log(`Runtime browser shortcuts passed: ${assertions} assertions; defaults, rebinding, clearing, conflicts, focus routing, late attachment, disable/re-enable.`);
} finally {
  await browser.close();
}
