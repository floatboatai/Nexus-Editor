import { describe, expect, it, vi } from "vitest";
import {
  createActionCommandPalette,
  filterActionCommands,
  fuzzyScore,
  type ActionCommand,
} from "../src/renderer/action-command-palette";

function commands(): ActionCommand[] {
  return [
    {
      id: "theme",
      title: "Switch to Dark Theme",
      description: "Toggle color scheme",
      category: "Appearance",
      keywords: ["theme", "dark", "light"],
      run: vi.fn(),
    },
    {
      id: "settings",
      title: "Open Settings",
      description: "Editor preferences panel",
      category: "Settings",
      keywords: ["preferences", "config"],
      run: vi.fn(),
    },
    {
      id: "preview",
      title: "Enable Live Preview",
      description: "Obsidian-style inline rendering",
      category: "View",
      keywords: ["preview", "source"],
      run: vi.fn(),
    },
    {
      id: "find",
      title: "Find in Document",
      description: "Search text in the current note",
      category: "Edit",
      keywords: ["search"],
      run: vi.fn(),
    },
  ];
}

describe("fuzzyScore", () => {
  it("matches contiguous and subsequence queries", () => {
    expect(fuzzyScore("thm", "Switch to Dark Theme")).toBeGreaterThan(0);
    expect(fuzzyScore("dark", "Switch to Dark Theme")).toBeGreaterThan(0);
    expect(fuzzyScore("xyz", "Switch to Dark Theme")).toBe(-1);
  });

  it("returns 0 for empty query", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });
});

describe("filterActionCommands", () => {
  it("returns all commands when query is empty", () => {
    expect(filterActionCommands(commands(), "")).toHaveLength(4);
  });

  it("ranks theme ahead of unrelated actions for 'theme'", () => {
    const result = filterActionCommands(commands(), "theme");
    expect(result[0]?.id).toBe("theme");
  });

  it("matches keywords and categories", () => {
    const byKeyword = filterActionCommands(commands(), "preferences");
    expect(byKeyword.map((c) => c.id)).toContain("settings");

    const byCategory = filterActionCommands(commands(), "appearance");
    expect(byCategory.map((c) => c.id)).toContain("theme");
  });

  it("finds live preview via abbreviated fuzzy query", () => {
    const result = filterActionCommands(commands(), "livprev");
    expect(result.some((c) => c.id === "preview")).toBe(true);
  });
});

describe("createActionCommandPalette", () => {
  it("opens, filters, and runs the highlighted command on Enter", () => {
    const cmds = commands();
    const palette = createActionCommandPalette({ getCommands: () => cmds });

    palette.open();
    expect(palette.isOpen()).toBe(true);

    const input = document.querySelector(".nexus-action-palette__input") as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = "sett";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const items = document.querySelectorAll(".nexus-action-palette__item");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.textContent).toContain("Open Settings");

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(cmds.find((c) => c.id === "settings")?.run).toHaveBeenCalled();
    expect(palette.isOpen()).toBe(false);

    palette.destroy();
    expect(document.querySelector(".nexus-action-palette")).toBeNull();
  });

  it("closes on Escape without running a command", () => {
    const cmds = commands();
    const palette = createActionCommandPalette({ getCommands: () => cmds });
    palette.open();

    const input = document.querySelector(".nexus-action-palette__input") as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(palette.isOpen()).toBe(false);
    for (const cmd of cmds) expect(cmd.run).not.toHaveBeenCalled();
    palette.destroy();
  });
});
