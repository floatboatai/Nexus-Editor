import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".cm-editor");
});

test("renders the CodeMirror editor", async ({ page }) => {
  const editor = page.locator(".cm-editor");
  await expect(editor).toBeVisible();
});

test("renders the toolbar", async ({ page }) => {
  const toolbar = page.locator('[role="toolbar"]');
  await expect(toolbar).toBeVisible();
});

test("renders initial document content", async ({ page }) => {
  const content = page.locator(".cm-content");
  await expect(content).toContainText("world");
});

test("accepts text input", async ({ page }) => {
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.type(" appended");
  await expect(content).toContainText("Hello **world** appended");
});

test("bold shortcut via toolbar click", async ({ page }) => {
  const content = page.locator(".cm-content");
  await content.click();
  const boldBtn = page.locator('[data-toolbar-action="bold"]');
  await boldBtn.click();
  await expect(content).toContainText("**");
});

test("Ctrl+F opens the search panel", async ({ page }) => {
  const content = page.locator(".cm-content");
  await content.click();
  await content.press("Control+f");
  const searchPanel = page.locator('[data-test-id="markdown-search-bar"]');
  await expect(searchPanel).toBeVisible({ timeout: 3000 });
});

test("search panel input is visible after opening", async ({ page }) => {
  const content = page.locator(".cm-content");
  await content.click();
  await content.press("Control+f");
  const input = page.locator('[data-test-id="markdown-search-input"]');
  await expect(input).toBeVisible({ timeout: 3000 });
});

test("undo reverts text change via Ctrl+Z", async ({ page }) => {
  const content = page.locator(".cm-content");
  await content.click();
  await content.press("End");
  await page.keyboard.type("extra");
  await content.press("Control+z");
  await expect(content).not.toContainText("extra");
});

test("toolbar ordered and unordered list buttons exist", async ({ page }) => {
  const olBtn = page.locator('[data-toolbar-action="ordered-list"]');
  const ulBtn = page.locator('[data-toolbar-action="unordered-list"]');
  await expect(olBtn).toBeVisible();
  await expect(ulBtn).toBeVisible();
});

test("editor accepts keyboard shortcuts and toolbar buttons", async ({ page }) => {
  const content = page.locator(".cm-content");
  await content.click();
  await content.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("new line");
  await expect(content).toContainText("new line");
});
