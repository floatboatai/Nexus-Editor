import { afterEach, describe, expect, it, vi } from "vitest";
import { createQuickOpen, toVaultRelative, type QuickOpen } from "../src/renderer/quick-open";

const VAULT = "/home/user/vault";
const FILES = [
  "/home/user/vault/Projects/Nexus-Editor.md",
  "/home/user/vault/Projects/Ideas.md",
  "/home/user/vault/Daily/2026-04-20.md",
  "/home/user/vault/index.md"
];

let current: QuickOpen | null = null;

function setup(overrides: Partial<Parameters<typeof createQuickOpen>[0]> = {}) {
  const onOpenFile = vi.fn();
  const quickOpen = createQuickOpen({
    getFiles: () => FILES,
    getVaultPath: () => VAULT,
    onOpenFile,
    ...overrides
  });
  current = quickOpen;
  document.body.append(quickOpen.element);

  const input = quickOpen.element.querySelector<HTMLInputElement>('[data-test-id="quick-open-input"]')!;
  const items = () =>
    Array.from(quickOpen.element.querySelectorAll<HTMLElement>('[data-test-id="quick-open-item"]'));

  const type = (value: string) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const press = (key: string) =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

  return { quickOpen, onOpenFile, input, items, type, press };
}

afterEach(() => {
  current?.destroy();
  current = null;
  document.body.innerHTML = "";
});

describe("toVaultRelative", () => {
  it("strips the vault prefix and normalizes slashes", () => {
    expect(toVaultRelative("/home/user/vault/Projects/Ideas.md", "/home/user/vault")).toBe(
      "Projects/Ideas.md"
    );
    expect(toVaultRelative("C:\\vault\\Notes\\a.md", "C:\\vault")).toBe("Notes/a.md");
  });

  it("returns the full path when the file is outside the vault", () => {
    expect(toVaultRelative("/other/place/a.md", "/home/user/vault")).toBe("/other/place/a.md");
  });

  it("returns the normalized path when there is no vault", () => {
    expect(toVaultRelative("C:\\x\\a.md", null)).toBe("C:/x/a.md");
  });
});

describe("createQuickOpen", () => {
  it("is hidden until opened", () => {
    const { quickOpen } = setup();
    expect(quickOpen.isOpen()).toBe(false);
    expect(quickOpen.element.style.display).toBe("none");
  });

  it("lists every file (vault-relative, sorted) on open with an empty query", () => {
    const { quickOpen, items } = setup();
    quickOpen.open();
    expect(quickOpen.isOpen()).toBe(true);
    const expected = FILES.map((f) => toVaultRelative(f, VAULT)).sort((a, b) => a.localeCompare(b));
    expect(items().map((el) => el.textContent)).toEqual(expected);
  });

  it("fuzzy-filters as the user types", () => {
    const { quickOpen, items, type } = setup();
    quickOpen.open();
    type("nexus");
    const texts = items().map((el) => el.textContent);
    expect(texts).toEqual(["Projects/Nexus-Editor.md"]);
  });

  it("highlights the matched characters", () => {
    const { quickOpen, items, type } = setup();
    quickOpen.open();
    type("idea");
    const row = items()[0];
    const highlighted = Array.from(row.querySelectorAll("span")).map((s) => s.textContent).join("");
    expect(highlighted.toLowerCase()).toBe("idea");
  });

  it("opens the active item on Enter and closes", () => {
    const { quickOpen, onOpenFile, type, press } = setup();
    quickOpen.open();
    type("nexus");
    press("Enter");
    expect(onOpenFile).toHaveBeenCalledWith("/home/user/vault/Projects/Nexus-Editor.md");
    expect(quickOpen.isOpen()).toBe(false);
  });

  it("moves the selection with arrow keys", () => {
    const { quickOpen, onOpenFile, items, press } = setup();
    quickOpen.open(); // empty query → all files, active index 0
    const secondLabel = items()[1].textContent;
    const expectedPath = FILES.find((f) => toVaultRelative(f, VAULT) === secondLabel)!;

    press("ArrowDown"); // -> index 1
    press("Enter");
    expect(onOpenFile).toHaveBeenCalledWith(expectedPath);
  });

  it("closes on Escape without opening a file", () => {
    const { quickOpen, onOpenFile, press } = setup();
    quickOpen.open();
    press("Escape");
    expect(quickOpen.isOpen()).toBe(false);
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("shows an empty state when there are no matches", () => {
    const { quickOpen, items, type } = setup();
    quickOpen.open();
    type("zzzzzz");
    expect(items()).toHaveLength(0);
    expect(quickOpen.element.textContent).toContain("No matching files");
  });

  it("prompts to open a vault when there are no files", () => {
    const { quickOpen } = setup({ getFiles: () => [], getVaultPath: () => null });
    quickOpen.open();
    expect(quickOpen.element.textContent).toContain("open a vault first");
  });
});
