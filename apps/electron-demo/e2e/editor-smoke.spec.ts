import { expect } from "@playwright/test";
import { test } from "./fixtures/electron-app";
import { EditorPage } from "./helpers/editor";

test("launches with an accessible markdown editor", async ({ window }) => {
  await expect(window.getByRole("button", { name: "Open" })).toBeVisible();
  await expect(window.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(window.getByRole("textbox", { name: "Markdown editor" })).toBeVisible();
  await expect(window.locator("#status-line")).toContainText("Untitled");
});

test("edits markdown and supports undo and redo", async ({ window }) => {
  const editor = new EditorPage(window);
  const markdown = "# Hello Nexus\n\n- [x] E2E works";

  await editor.replaceMarkdown(markdown);
  await editor.expectDirty();
  await expect(editor.editor).toContainText("Hello Nexus");
  await expect(editor.editor).toContainText("E2E works");

  await editor.undo();
  await expect(editor.editor).not.toContainText("Hello Nexus");

  await editor.redo();
  await expect(editor.editor).toContainText("Hello Nexus");
  await expect(editor.editor).toContainText("E2E works");
});
