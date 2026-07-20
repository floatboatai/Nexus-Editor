import { expect } from "@playwright/test";
import { test } from "./fixtures/electron-app";
import { EditorPage } from "./helpers/editor";
import {
  createMarkdownFile,
  readMarkdownFile,
  stubOpenFileDialog,
  writeMarkdownFile,
} from "./helpers/test-vault";

test("opens, saves, and reopens a markdown file", async ({ electronApp, window, workspaceDir }) => {
  const filePath = await createMarkdownFile(
    workspaceDir,
    "notes/critical-workflow.md",
    "# Original note\n\nThis came from disk.",
  );
  const savedMarkdown = "# Persisted note\n\n- [x] Saved by E2E";
  const reloadedMarkdown = "# Reloaded from disk\n\n- [x] File IO verified";
  const editor = new EditorPage(window);

  const restoreOpenFileDialog = await stubOpenFileDialog(electronApp, filePath);
  try {
    await window.getByRole("button", { name: "Open" }).click();
    await expect(editor.editor).toContainText("Original note");
    await expect(window.locator("#status-line")).toContainText("critical-workflow.md");

    await editor.replaceMarkdown(savedMarkdown);
    await editor.expectDirty();
    await window.getByRole("button", { name: "Save", exact: true }).click();

    await expect.poll(() => readMarkdownFile(filePath)).toBe(savedMarkdown);
    await expect(editor.statusLine).not.toContainText("[modified]");

    await writeMarkdownFile(filePath, reloadedMarkdown);
    await window.getByRole("button", { name: "Open" }).click();
    await expect(editor.editor).toContainText("Reloaded from disk");
    await expect(editor.editor).toContainText("File IO verified");
  } finally {
    await restoreOpenFileDialog();
  }
});
