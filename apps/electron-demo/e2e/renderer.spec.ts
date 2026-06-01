/**
 * Renderer E2E harness — Nexus Editor demo
 *
 * Playwright opens the Vite dev server (http://localhost:5173) in a real
 * Chromium browser without any Electron host. Before each page load,
 * addInitScript installs a typed mock of window.nexusDemo — the
 * contextBridge shim that electron/preload.ts normally installs via
 * contextBridge.exposeInMainWorld(). This decouples renderer correctness
 * from IPC implementation and lets the harness:
 *
 *   - Boot the full renderer stack (CodeMirror, plugins, live-preview)
 *   - Assert on real DOM state, not internal variables
 *   - Record bridge call arguments for explicit assertion
 *   - Run cheaply in CI with no Electron binary required
 *
 * Scenarios covered
 * ─────────────────
 *  1. editor-boot        — CM editor mounts, status shows "Untitled"
 *  2. open-file          — bridge called, content loads, status reflects path
 *  3. dirty-state        — typing marks document as [modified]
 *  4. save               — bridge called with correct path, dirty cleared
 *  5. search             — Ctrl+F reveals search bar with focused input
 *
 * Run:   pnpm test:e2e
 * Debug: pnpm test:e2e:headed
 * Setup: npx playwright install --with-deps chromium   (first-time only)
 */

import { test, expect, type Page } from "@playwright/test";

// ─── Bridge mock ─────────────────────────────────────────────────────────────

/**
 * Install a minimal mock of window.nexusDemo before the renderer scripts run.
 *
 * All calls are recorded in window.__bridgeCalls so tests can assert:
 *   const calls = await page.evaluate(() => window.__bridgeCalls);
 *   expect(calls.saveFile[0][0]).toBe('/expected/path.md');
 *
 * Tests that need openFile to return specific content set
 * window.__mockOpenFile via page.evaluate() before triggering the click.
 */
async function setupBridgeMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__bridgeCalls = {} as Record<string, unknown[][]>;

    function record(name: string, ...args: unknown[]): void {
      const log = (window as any).__bridgeCalls as Record<string, unknown[][]>;
      if (!log[name]) log[name] = [];
      log[name].push(args);
    }

    (window as any).nexusDemo = {
      // ── File I/O ──────────────────────────────────────────────────────────
      openFile: async () => {
        record("openFile");
        // Tests set window.__mockOpenFile before clicking Open.
        return (window as any).__mockOpenFile ?? null;
      },
      saveFile: async (path: string, content: string) => {
        record("saveFile", path, content);
        return { path };
      },
      saveFileAs: async (content: string) => {
        record("saveFileAs", content);
        return null;
      },

      // ── Vault bridge ──────────────────────────────────────────────────────
      vault: {
        pick: async () => null,
        list: async () => [],
        read: async (filePath: string) => {
          record("vault.read", filePath);
          return { path: filePath, content: "" };
        },
        readAll: async () => [],
        write: async (filePath: string, content: string) => {
          record("vault.write", filePath, content);
          return { path: filePath };
        },
        createFile: async (parent: string, name: string) => ({
          path: `${parent}/${name}`,
        }),
        createFolder: async (parent: string, name: string) => ({
          path: `${parent}/${name}`,
        }),
        rename: async (oldPath: string) => ({ path: oldPath }),
        delete: async () => ({ ok: true }),
        // Return null lastVault so tryRestoreLastVault() exits early and
        // leaves the editor in the clean "Untitled" state after boot.
        getLast: async () => ({ lastVault: null, recents: [] }),
        setLast: async () => ({ ok: true }),
        // Return an unsubscribe stub; the app discards the return value here.
        onChanged: (_cb: unknown) => () => {},
      },
    };
  });
}

// ─── Shared setup ────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await setupBridgeMock(page);
  await page.goto("/");
  // CodeMirror signals a successful mount by adding .cm-editor to the DOM.
  await page.waitForSelector(".cm-editor", { timeout: 10_000 });
});

// ─── Scenarios ───────────────────────────────────────────────────────────────

test("editor-boot: CM editor mounts and status shows Untitled", async ({
  page,
}) => {
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(page.locator("#status-line")).toContainText("Untitled");
  await expect(page.locator("#status-line")).not.toContainText("[modified]");
});

test("open-file: bridge is called, content loads, status shows filename", async ({
  page,
}) => {
  // Arrange — set the file the bridge mock will return
  await page.evaluate(() => {
    (window as any).__mockOpenFile = {
      path: "/vault/notes/welcome.md",
      content: "# Welcome\n\nThis is a test note.",
    };
  });

  // Act
  await page.getByRole("button", { name: "Open" }).click();

  // Assert — editor renders the loaded text
  await expect(page.locator(".cm-editor")).toContainText("Welcome");

  // Status line shows the filename and no dirty marker
  await expect(page.locator("#status-line")).toContainText("welcome.md");
  await expect(page.locator("#status-line")).not.toContainText("[modified]");

  // Bridge was invoked exactly once
  const calls = await page.evaluate(() => (window as any).__bridgeCalls);
  expect(calls.openFile).toHaveLength(1);
});

test("dirty-state: typing in the editor marks the document as modified", async ({
  page,
}) => {
  // Click the CodeMirror editable area to focus it, then type
  await page.locator(".cm-content").click();
  await page.keyboard.type("draft text");

  await expect(page.locator("#status-line")).toContainText("[modified]");
});

test("save: saveFile bridge called with correct path, dirty state cleared", async ({
  page,
}) => {
  // Arrange — open a file so the save target path is known
  await page.evaluate(() => {
    (window as any).__mockOpenFile = {
      path: "/vault/notes/report.md",
      content: "# Report",
    };
  });
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.locator(".cm-editor")).toContainText("Report");

  // Edit to make dirty
  await page.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" (updated)");
  await expect(page.locator("#status-line")).toContainText("[modified]");

  // Act
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // Assert — bridge received the correct arguments
  const calls = await page.evaluate(() => (window as any).__bridgeCalls);
  expect(calls.saveFile).toHaveLength(1);
  expect(calls.saveFile[0][0]).toBe("/vault/notes/report.md");

  // Dirty flag must be cleared after a successful save
  await expect(page.locator("#status-line")).not.toContainText("[modified]");
});

test("search: Ctrl+F opens search bar with focused Find input", async ({
  page,
}) => {
  await page.keyboard.press("Control+f");

  const searchBar = page.locator(".nexus-search-bar");
  await expect(searchBar).toBeVisible();

  // The find input must be present and receive focus automatically
  const findInput = searchBar.locator('input[placeholder="Find..."]');
  await expect(findInput).toBeVisible();
  await expect(findInput).toBeFocused();
});
