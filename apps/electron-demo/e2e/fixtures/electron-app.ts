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

interface E2EFixtures extends ElectronTestContext {
  e2eContext: ElectronTestContext;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

function recordedTestFailure(testInfo: TestInfo): string | undefined {
  if (testInfo.status === testInfo.expectedStatus) return undefined;

  const error = testInfo.error;
  return (
    error?.stack ??
    error?.message ??
    error?.value ??
    `Test finished with ${testInfo.status} instead of ${testInfo.expectedStatus}.`
  );
}

function formatDiagnostics(
  rendererErrors: string[],
  processLogs: string[],
  testFailure: unknown,
  teardownErrors: unknown[],
): string {
  const sections: string[] = [];

  if (testFailure) {
    sections.push(`Test failure:\n${describeError(testFailure)}`);
  }
  if (rendererErrors.length > 0) {
    sections.push(`Renderer console errors:\n${rendererErrors.join("\n")}`);
  }
  if (processLogs.length > 0) {
    sections.push(`Electron process stderr:\n${processLogs.join("\n")}`);
  }
  if (teardownErrors.length > 0) {
    sections.push(
      `Fixture teardown errors:\n${teardownErrors.map(describeError).join("\n\n")}`,
    );
  }

  return sections.join("\n\n");
}

async function captureTeardownError(
  teardownErrors: unknown[],
  operation: () => Promise<void> | void,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    teardownErrors.push(error);
  }
}

async function attachDiagnostics(
  testInfo: TestInfo,
  rendererErrors: string[],
  processLogs: string[],
  testFailure: unknown,
  teardownErrors: unknown[],
): Promise<void> {
  const details = formatDiagnostics(rendererErrors, processLogs, testFailure, teardownErrors);
  if (!details) return;

  await testInfo.attach("electron-diagnostics", {
    body: Buffer.from(details),
    contentType: "text/plain",
  });
}

export const test = base.extend<E2EFixtures>({
  e2eContext: [
    async ({}, use, testInfo) => {
      const rendererErrors: string[] = [];
      const processLogs: string[] = [];
      const teardownErrors: unknown[] = [];
      const rendererListeners = new Map<
        Page,
        { onConsole: (message: ConsoleMessage) => void; onPageError: (error: Error) => void }
      >();
      let workspaceDir: string | undefined;
      let userDataDir: string | undefined;
      let app: ElectronApplication | undefined;
      let stderr: NodeJS.ReadableStream | null = null;
      let testFailure: unknown;

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
        workspaceDir = await mkdtemp(path.join(tmpdir(), "nexus-e2e-workspace-"));
        userDataDir = await mkdtemp(path.join(tmpdir(), "nexus-e2e-user-data-"));

        app = await electron.launch({
          executablePath: electronBinary,
          args: ["dist-electron/main.js", `--user-data-dir=${userDataDir}`],
          cwd: appDirectory,
          env: { ...process.env, NEXUS_E2E: "1" },
        });

        stderr = app.process().stderr;
        stderr?.on("data", onStderr);
        app.on("window", observeRenderer);

        const window = await app.firstWindow();
        observeRenderer(window);
        await expect(window.getByRole("textbox", { name: "Markdown editor" })).toBeVisible();

        await use({ electronApp: app, window, workspaceDir, userDataDir });

        testFailure ??= recordedTestFailure(testInfo);

        if (rendererErrors.length > 0) {
          throw new Error(formatDiagnostics(rendererErrors, processLogs, undefined, []));
        }
      } catch (error) {
        testFailure = error;
        throw error;
      } finally {
        for (const [page, listeners] of rendererListeners) {
          await captureTeardownError(teardownErrors, () => {
            page.off("console", listeners.onConsole);
            page.off("pageerror", listeners.onPageError);
          });
        }
        await captureTeardownError(teardownErrors, () => {
          app?.off("window", observeRenderer);
        });
        await captureTeardownError(teardownErrors, () => app?.close());
        await captureTeardownError(teardownErrors, () => {
          stderr?.off("data", onStderr);
        });
        if (workspaceDir) {
          const directory = workspaceDir;
          await captureTeardownError(teardownErrors, () =>
            rm(directory, { recursive: true, force: true }),
          );
        }
        if (userDataDir) {
          const directory = userDataDir;
          await captureTeardownError(teardownErrors, () =>
            rm(directory, { recursive: true, force: true }),
          );
        }

        try {
          await attachDiagnostics(
            testInfo,
            rendererErrors,
            processLogs,
            testFailure,
            teardownErrors,
          );
        } catch (error) {
          teardownErrors.push(error);
          process.stderr.write(`Unable to attach Electron E2E diagnostics: ${describeError(error)}\n`);
        }

        if (teardownErrors.length > 0 && !testFailure) {
          throw new AggregateError(teardownErrors, "Electron E2E fixture teardown failed");
        }
      }
    },
    { auto: true },
  ],

  electronApp: async ({ e2eContext }, use) => {
    await use(e2eContext.electronApp);
  },

  window: async ({ e2eContext }, use) => {
    await use(e2eContext.window);
  },

  workspaceDir: async ({ e2eContext }, use) => {
    await use(e2eContext.workspaceDir);
  },

  userDataDir: async ({ e2eContext }, use) => {
    await use(e2eContext.userDataDir);
  },
});
