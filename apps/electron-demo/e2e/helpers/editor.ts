import { expect, type Locator, type Page } from "@playwright/test";

const modifier = process.platform === "darwin" ? "Meta" : "Control";
const redoShortcut = process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Y";

export class EditorPage {
  readonly editor: Locator;
  readonly statusLine: Locator;

  constructor(private readonly page: Page) {
    this.editor = page.getByRole("textbox", { name: "Markdown editor" });
    this.statusLine = page.locator("#status-line");
  }

  async replaceMarkdown(markdown: string): Promise<void> {
    await this.editor.click();
    await this.editor.press(`${modifier}+A`);
    await this.page.keyboard.insertText(markdown);
  }

  async undo(): Promise<void> {
    await this.editor.press(`${modifier}+Z`);
  }

  async redo(): Promise<void> {
    await this.editor.press(redoShortcut);
  }

  async expectDirty(): Promise<void> {
    await expect(this.statusLine).toContainText("[modified]");
  }
}
