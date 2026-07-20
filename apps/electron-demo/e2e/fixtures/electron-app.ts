import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const electronBinary = require("electron") as string;
const appDirectory = path.resolve(__dirname, "../..");

export interface ElectronTestContext {
  electronApp: ElectronApplication;
  window: Page;
  workspaceDir: string;
  userDataDir: string;
}

function formatFailureDetails(
  rendererErrors: string[],
  processLogs: string[],
): string {
  const sections: string[] = [];
  if (rendererErrors.length > 0) {
    sections.push(`Renderer console errors:\n${rendererErrors.join("\n")}`);
  }
  if (processLogs.length > 0) {
    sections.push(`Electron process output:\n${processLogs.join("\n")}`);
  }
  return sections.join("\n\n");
}

async function attachFailureDetails(
  testInfo: TestInfo,
  rendererErrors: string[],
  processLogs: string[],
): Promise<void> {
  const details = formatFailureDetails(rendererErrors, processLogs);
  if (!details) return;

  await testInfo.attach("electron-diagnostics", {
    body: Buffer.from(details),
    contentType: "text/plain",
  });
}

export const test = base.extend<ElectronTestContext>({
  workspaceDir: [
    async ({}, use) => {
      const directory = await mkdtemp(path.join(tmpdir(), "nexus-e2e-workspace-"));
      try {
        await use(directory);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    { auto: true },
  ],

  userDataDir: async ({}, use) => {
    const directory = await mkdtemp(path.join(tmpdir(), "nexus-e2e-user-data-"));
    try {
      await use(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },

  electronApp: async ({ userDataDir }, use, testInfo) => {
    const rendererErrors: string[] = [];
    const processLogs: string[] = [];
    let app: ElectronApplication | undefined;

    try {
      app = await electron.launch({
        executablePath: electronBinary,
        args: ["dist-electron/main.js", `--user-data-dir=${userDataDir}`],
        cwd: appDirectory,
      });

      app.process().stderr?.on("data", (chunk: Buffer) => {
        processLogs.push(chunk.toString());
      });

      const window = await app.firstWindow();
      window.on("console", (message) => {
        if (message.type() === "error") rendererErrors.push(message.text());
      });
      window.on("pageerror", (error) => rendererErrors.push(error.message));

      await expect(window.getByRole("textbox", { name: "Markdown editor" })).toBeVisible();
      await use(app);

      if (testInfo.status === testInfo.expectedStatus && rendererErrors.length > 0) {
        throw new Error(formatFailureDetails(rendererErrors, processLogs));
      }
    } finally {
      await attachFailureDetails(testInfo, rendererErrors, processLogs);
      await app?.close().catch(() => undefined);
    }
  },

  window: async ({ electronApp }, use) => {
    await use(await electronApp.firstWindow());
  },
});
