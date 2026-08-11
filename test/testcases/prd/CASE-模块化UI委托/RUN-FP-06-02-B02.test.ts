import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type SlashCommandDef } from "@floatboat/nexus-core";

afterEach(() => {
  vi.restoreAllMocks();
});

const container = document.createElement("div");
const handler = vi.fn();
const commands: SlashCommandDef[] = [
  { id: "heading", title: "Heading", keywords: ["h1"] },
];
const editor = createEditor({
  container,
  initialValue: "",
  plugins: [{ name: "test", slashCommands: commands }],
});
editor.on("slashMenuChange", handler);

describe("FP-06-02-B02: destroy() 后残留订阅不再触发回调", () => {
  it("步骤1-3: destroy 后触发不再回调", () => {
    editor.setDocument("/he");
    editor.setSelection(3);
    expect(handler.mock.calls.length).toBeGreaterThan(0);
    const before = handler.mock.calls.length;

    editor.destroy();
    editor.setDocument("/hea"); // destroyed 后安全 no-op
    editor.setSelection(4);

    expect(handler.mock.calls.length).toBe(before);
  });
});
