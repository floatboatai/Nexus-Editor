import { expect } from "@playwright/test";
import { test } from "./fixtures/electron-app";
import { EditorPage } from "./helpers/editor";
import { createMarkdownFile, readMarkdownFile, stubOpenFileDialog } from "./helpers/test-vault";

test("opens, saves, and reopens a markdown file", async ({ electronApp, window, workspaceDir }) => {
  const filePath = await createMarkdownFile(
    workspaceDir,
    "notes/critical-workflow.md",
    "# Original note\n\nThis came from disk.",
  );
  const savedMarkdown = "# Persisted note\n\n- [x] Saved by E2E";
  const editor = new EditorPage(window);

  await stubOpenFileDialog(electronApp, filePath);
  await window.getByRole("button", { name: "Open" }).click();
  await expect(editor.editor).toContainText("Original note");
  await expect(window.locator("#status-line")).toContainText("critical-workflow.md");

  await editor.replaceMarkdown(savedMarkdown);
  await editor.expectDirty();
  await window.getByRole("button", { name: "Save", exact: true }).click();

  await expect.poll(() => readMarkdownFile(filePath)).toBe(savedMarkdown);
  await expect(editor.statusLine).not.toContainText("[modified]");

  await window.getByRole("button", { name: "Open" }).click();
  await expect(editor.editor).toContainText("Persisted note");
  await expect(editor.editor).toContainText("Saved by E2E");
});
