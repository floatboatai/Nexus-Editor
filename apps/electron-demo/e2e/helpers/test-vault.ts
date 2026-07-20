import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ElectronApplication } from "@playwright/test";

export async function createMarkdownFile(
  workspaceDir: string,
  relativePath: string,
  content: string,
): Promise<string> {
  const filePath = path.join(workspaceDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return filePath;
}

export async function readMarkdownFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

export async function stubOpenFileDialog(
  electronApp: ElectronApplication,
  filePath: string,
): Promise<void> {
  await electronApp.evaluate(({ dialog }, selectedFilePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selectedFilePath],
    });
  }, filePath);
}
