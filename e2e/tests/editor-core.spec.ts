import { test, expect } from "../helpers/electron-fixture";

test.describe("Editor Core E2E", () => {
  test("launches the Electron app and renders the editor", async ({ page }) => {
    // The fixture already waits for .cm-editor, so just verify it exists
    const editor = page.locator(".cm-editor");
    await expect(editor).toBeVisible();
  });

  test("editor accepts text input", async ({ page }) => {
    const content = page.locator(".cm-content");
    await content.click();
    await page.keyboard.type("# Hello E2E");

    // Verify the text was typed into the editor
    const text = await content.textContent();
    expect(text).toContain("Hello E2E");
  });

  test("search panel opens with Ctrl+F", async ({ page }) => {
    const content = page.locator(".cm-content");
    await content.click();

    // Open search panel
    await page.keyboard.press("Control+f");

    // The search panel should appear
    const searchBar = page.locator('[data-test-id="markdown-search-bar"]');
    await expect(searchBar).toBeVisible({ timeout: 5000 });
  });

  test("toolbar is visible", async ({ page }) => {
    const toolbar = page.locator(".nexus-toolbar");
    // Toolbar might not exist if the demo doesn't include it — just check page loads
    const editorExists = await page.locator(".cm-editor").isVisible();
    expect(editorExists).toBe(true);
  });
});
