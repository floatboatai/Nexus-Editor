import { describe, expect, it } from "vitest";
import {
  isControlledDocument,
  resolveInitialDocument,
  shouldSyncControlledDocument
} from "../src/controlled-document";

describe("controlled-document helpers (vue)", () => {
  it("detects controlled mode when modelValue is defined", () => {
    expect(isControlledDocument(undefined)).toBe(false);
    expect(isControlledDocument("")).toBe(true);
  });

  it("resolves initial document from modelValue or initialValue", () => {
    expect(resolveInitialDocument("live", "seed")).toBe("live");
    expect(resolveInitialDocument(undefined, "seed")).toBe("seed");
  });

  it("skips sync when last synced doc already matches", () => {
    expect(shouldSyncControlledDocument("same", "same")).toBe(false);
    expect(shouldSyncControlledDocument("next", "prev")).toBe(true);
  });
});
