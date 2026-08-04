import { describe, expect, it, vi, beforeEach } from "vitest";
import { openProjectSwitcher } from "../src/renderer/project-switcher";

function mockVault(recents: Array<{ path: string; name: string; exists: boolean }>, activeVault: string | null = null) {
  const removeRecent = vi.fn().mockResolvedValue({ ok: true });
  const listRecents = vi.fn().mockResolvedValue({ recents, activeVault });
  (globalThis as Record<string, unknown>).window = Object.assign(globalThis, {
    nexusDemo: { vault: { listRecents, removeRecent } },
  });
  return { listRecents, removeRecent };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("openProjectSwitcher", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders existing and missing projects distinctly", async () => {
    mockVault([
      { path: "/a/Alpha", name: "Alpha", exists: true },
      { path: "/b/Beta", name: "Beta", exists: false },
    ]);
    await openProjectSwitcher({ onSwitch: vi.fn(), onPickNew: vi.fn() });
    await flush();

    const rows = document.querySelectorAll(".nx-switcher__row");
    expect(rows).toHaveLength(2);
    // Only the existing one is keyboard-selectable.
    expect(document.querySelectorAll(".nx-switcher__row[data-selectable='1']")).toHaveLength(1);
    expect(document.querySelector(".nx-switcher__row.is-missing")).not.toBeNull();
    // Missing row shows the friendly hint + a Remove button.
    expect(document.body.textContent).toContain("Folder moved or deleted");
    expect(document.querySelector(".nx-switcher__remove")).not.toBeNull();
  });

  it("switches to a project on click and closes", async () => {
    mockVault([{ path: "/a/Alpha", name: "Alpha", exists: true }]);
    const onSwitch = vi.fn();
    await openProjectSwitcher({ onSwitch, onPickNew: vi.fn() });
    await flush();

    document.querySelector<HTMLElement>(".nx-switcher__row[data-selectable='1']")!.click();
    expect(onSwitch).toHaveBeenCalledWith("/a/Alpha");
    expect(document.querySelector(".nx-switcher")).toBeNull(); // closed
  });

  it("removes a dead project via the bridge and refreshes", async () => {
    const { removeRecent } = mockVault([{ path: "/b/Beta", name: "Beta", exists: false }]);
    await openProjectSwitcher({ onSwitch: vi.fn(), onPickNew: vi.fn() });
    await flush();

    document.querySelector<HTMLElement>(".nx-switcher__remove")!.click();
    await flush();
    expect(removeRecent).toHaveBeenCalledWith("/b/Beta");
  });

  it("shows an empty state when there are no recents", async () => {
    mockVault([]);
    await openProjectSwitcher({ onSwitch: vi.fn(), onPickNew: vi.fn() });
    await flush();
    expect(document.querySelector(".nx-switcher__empty")).not.toBeNull();
  });
});
