import { describe, expect, it } from "vitest";
import { isWordBoundary, getTriggerPos, getQueryText, clampIndex } from "../src/mention-extension";

describe("isWordBoundary", () => {
  it("returns true at start of document", () => {
    expect(isWordBoundary("hello", 0)).toBe(true);
  });
  it("returns true after whitespace", () => {
    expect(isWordBoundary("hello world", 6)).toBe(true);
  });
  it("returns true after punctuation", () => {
    expect(isWordBoundary("hello,world", 5)).toBe(true);
  });
  it("returns false after a letter", () => {
    expect(isWordBoundary("hello", 4)).toBe(false);
  });
});

describe("getTriggerPos", () => {
  it("finds @ at word boundary", () => {
    expect(getTriggerPos("Hello @alice", 12, "@")).toBe(6);
  });
  it("returns null when @ is not preceded by word boundary", () => {
    expect(getTriggerPos("email@domain.com", 16, "@")).toBe(null);
  });
  it("returns null when no @ present", () => {
    expect(getTriggerPos("Hello world", 11, "@")).toBe(null);
  });
});

describe("getQueryText", () => {
  it("extracts query between trigger and cursor", () => {
    expect(getQueryText("Hello @alice", 6, 12)).toBe("alice");
  });
  it("returns empty string when cursor is right after trigger", () => {
    expect(getQueryText("Hello @", 6, 7)).toBe("");
  });
});

describe("clampIndex", () => {
  it("clamps within bounds", () => {
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(1, 3)).toBe(1);
  });
  it("returns 0 for empty arrays", () => {
    expect(clampIndex(0, 0)).toBe(0);
  });
});
