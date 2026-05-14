import { describe, expect, it } from "vitest";
import { createState } from "../src/renderer/state";

describe("createState", () => {
  it("initializes with no file path and not dirty", () => {
    const state = createState();
    expect(state.filePath).toBeNull();
    expect(state.content).toBe("");
    expect(state.dirty).toBe(false);
    expect(state.error).toBeNull();
    expect(state.statusMessage).toBeNull();
  });
});
