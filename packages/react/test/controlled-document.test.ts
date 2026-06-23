import { describe, expect, it } from "vitest";
import {
  isControlledDocument,
  resolveInitialDocument,
  shouldSyncControlledDocument
} from "../src/controlled-document";

describe("controlled-document helpers", () => {
  it("detects controlled mode when value is defined", () => {
    expect(isControlledDocument(undefined)).toBe(false);
    expect(isControlledDocument("")).toBe(true);
  });

  it("resolves initial document from value or initialValue", () => {
    expect(resolveInitialDocument("live", "seed")).toBe("live");
    expect(resolveInitialDocument(undefined, "seed")).toBe("seed");
    expect(resolveInitialDocument(undefined, undefined)).toBe("");
  });

  it("skips sync when last synced doc already matches", () => {
    expect(shouldSyncControlledDocument("same", "same")).toBe(false);
    expect(shouldSyncControlledDocument("next", "prev")).toBe(true);
    expect(shouldSyncControlledDocument("fresh", null)).toBe(true);
  });
});
