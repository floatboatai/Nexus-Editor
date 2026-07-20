import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ElectronApplication } from "@playwright/test";

const originalOpenDialogKey = "__nexusE2EOriginalShowOpenDialog";

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

export async function writeMarkdownFile(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, "utf8");
}

export async function stubOpenFileDialog(
  electronApp: ElectronApplication,
  filePath: string,
): Promise<() => Promise<void>> {
  await electronApp.evaluate(({ dialog }, options) => {
    const state = globalThis as typeof globalThis & Record<string, unknown>;
    state[options.originalKey] ??= dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [options.filePath],
    });
  }, { filePath, originalKey: originalOpenDialogKey });

  return async () => {
    await electronApp.evaluate(({ dialog }, originalKey) => {
      const state = globalThis as typeof globalThis & Record<string, unknown>;
      const original = state[originalKey];
      if (typeof original !== "function") return;

      dialog.showOpenDialog = original as typeof dialog.showOpenDialog;
      delete state[originalKey];
    }, originalOpenDialogKey);
  };
}
