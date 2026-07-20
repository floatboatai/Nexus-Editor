import {
  _electron as electron,
  type ConsoleMessage,
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

  electronApp: async ({ workspaceDir: _workspaceDir, userDataDir }, use, testInfo) => {
    const rendererErrors: string[] = [];
    const processLogs: string[] = [];
    const rendererListeners = new Map<
      Page,
      { onConsole: (message: ConsoleMessage) => void; onPageError: (error: Error) => void }
    >();
    let app: ElectronApplication | undefined;
    let stderr: NodeJS.ReadableStream | null = null;

    const onStderr = (chunk: Buffer) => {
      processLogs.push(chunk.toString());
    };

    const observeRenderer = (page: Page) => {
      if (rendererListeners.has(page)) return;

      const onConsole = (message: ConsoleMessage) => {
        if (message.type() === "error") rendererErrors.push(message.text());
      };
      const onPageError = (error: Error) => rendererErrors.push(error.message);

      page.on("console", onConsole);
      page.on("pageerror", onPageError);
      rendererListeners.set(page, { onConsole, onPageError });
    };

    try {
      app = await electron.launch({
        executablePath: electronBinary,
        args: ["dist-electron/main.js", `--user-data-dir=${userDataDir}`],
        cwd: appDirectory,
      });

      stderr = app.process().stderr;
      stderr?.on("data", onStderr);
      app.on("window", observeRenderer);

      const window = await app.firstWindow();
      observeRenderer(window);

      await expect(window.getByRole("textbox", { name: "Markdown editor" })).toBeVisible();
      await use(app);

      if (testInfo.status === testInfo.expectedStatus && rendererErrors.length > 0) {
        throw new Error(formatFailureDetails(rendererErrors, processLogs));
      }
    } finally {
      try {
        for (const [page, listeners] of rendererListeners) {
          page.off("console", listeners.onConsole);
          page.off("pageerror", listeners.onPageError);
        }
        app?.off("window", observeRenderer);
      } finally {
        try {
          await app?.close();
        } finally {
          stderr?.off("data", onStderr);
          await attachFailureDetails(testInfo, rendererErrors, processLogs);
        }
      }
    }
  },

  window: async ({ electronApp }, use) => {
    await use(await electronApp.firstWindow());
  },
});
