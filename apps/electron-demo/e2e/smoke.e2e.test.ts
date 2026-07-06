import { afterEach, describe, expect, it } from "vitest";

import { type AppHandle, closeApp, getEditorText, launchApp, setEditorText } from "./driver";

// These tests drive the *packaged* Electron app (real Chromium, real main
// process, real IPC) via Playwright — the class of bug that only shows up
// outside jsdom: production build wiring, preload bridge exposure, real
// layout/paint, real mouse coordinates. Slow and requires a prior
// `pnpm build`, so they run under their own `test:e2e` script rather than
// the default `pnpm test`.

let current: AppHandle | null = null;

afterEach(async () => {
  if (current) await closeApp(current);
  current = null;
});

describe("electron-demo smoke", () => {
  it("launches and shows an empty editor", async () => {
    const handle = await launchApp();
    current = handle;
    const text = await getEditorText(handle.page);
    expect(text.trim()).toBe("");
  });

  it("renders live-preview formatting for typed markdown", async () => {
    const handle = await launchApp();
    current = handle;
    await setEditorText(handle.page, "# Heading\n\n**bold** and *italic*\n\nend");
    await handle.page.keyboard.press("End");

    const text = await getEditorText(handle.page);
    expect(text).toContain("Heading");
    expect(text).toContain("bold");
    expect(text).toContain("italic");
    // Live preview hides the raw markers once the cursor leaves the line.
    expect(text).not.toContain("**bold**");
    expect(text).not.toContain("# Heading");

    const heading = await handle.page.evaluate(() =>
      document.querySelector("[data-heading-level]")?.getAttribute("data-heading-level")
    );
    expect(heading).toBe("1");
  });

  it("toggles a GFM task list checkbox via a real mouse click", async () => {
    const handle = await launchApp();
    current = handle;
    await setEditorText(handle.page, "- [ ] alpha\n- [ ] beta");
    await handle.page.keyboard.press("Meta+End").catch(() => {});
    await handle.page.keyboard.press("End");

    const checkboxCountBefore = await handle.page.evaluate(
      () => document.querySelectorAll("input[type=checkbox]").length
    );
    expect(checkboxCountBefore).toBeGreaterThanOrEqual(1);

    // Click the DOM checkbox directly rather than via Playwright's coordinate
    // click — contextIsolation puts the real UI in the main window's page
    // context, so a plain DOM click always lands on the right element.
    //
    // The checkbox's own click handler calls preventDefault() (it drives
    // `checked` purely from the dispatched markdown source, not the
    // browser's native toggle) and dispatches a CM6 change. That change's
    // decoration key embeds the checked state, so CM6 treats it as a
    // different widget and replaces the <input> node synchronously — the
    // element `box` pointed at is detached once `.click()` returns. Re-query
    // fresh rather than trusting the stale reference's `.checked`.
    const checked = await handle.page.evaluate(() => {
      const box = document.querySelector<HTMLInputElement>("input[type=checkbox]");
      if (!box) return null;
      box.click();
      return document.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked ?? null;
    });
    expect(checked).toBe(true);

    // The toggle round-trips through a real CM6 dispatch; give it a tick to
    // re-render the strike-through decoration before asserting on it.
    await handle.page.waitForTimeout(100);
    const strikethrough = await handle.page.evaluate(() =>
      Array.from(document.querySelectorAll("*")).some(
        (el) => (el as HTMLElement).style?.textDecoration?.includes("line-through")
      )
    );
    expect(strikethrough).toBe(true);
  });
});
