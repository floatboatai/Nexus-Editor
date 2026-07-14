import { describe, expect, it } from "vitest";
import { normalizeSlashes, joinPath, isPathInside } from "../src/renderer/path-utils";

describe("normalizeSlashes", () => {
  it("returns path unchanged when already using forward slashes", () => {
    expect(normalizeSlashes("foo/bar/baz")).toBe("foo/bar/baz");
  });

  it("converts Windows backslashes to forward slashes", () => {
    expect(normalizeSlashes("foo\\bar\\baz")).toBe("foo/bar/baz");
  });

  it("converts mixed slashes to forward slashes", () => {
    expect(normalizeSlashes("foo/bar\\baz/qux")).toBe("foo/bar/baz/qux");
  });

  it("handles UNC paths", () => {
    expect(normalizeSlashes("\\\\server\\share\\folder")).toBe("//server/share/folder");
  });

  it("converts multiple consecutive backslashes to forward slashes", () => {
    expect(normalizeSlashes("foo\\\\bar\\\\baz")).toBe("foo//bar//baz");
  });

  it("handles empty string", () => {
    expect(normalizeSlashes("")).toBe("");
  });

  it("handles root path", () => {
    expect(normalizeSlashes("\\")).toBe("/");
  });
});

describe("joinPath", () => {
  it("joins two segments", () => {
    expect(joinPath("foo", "bar")).toBe("foo/bar");
  });

  it("joins multiple segments", () => {
    expect(joinPath("foo", "bar", "baz")).toBe("foo/bar/baz");
  });

  it("normalizes mixed slashes in segments", () => {
    expect(joinPath("foo\\bar", "baz\\qux")).toBe("foo/bar/baz/qux");
  });

  it("handles leading slash in segment", () => {
    expect(joinPath("/foo", "bar")).toBe("/foo/bar");
  });

  it("handles trailing slash in segment", () => {
    expect(joinPath("foo/", "bar")).toBe("foo/bar");
  });

  it("collapses multiple consecutive slashes", () => {
    expect(joinPath("foo//", "//bar")).toBe("foo/bar");
  });

  it("handles single segment", () => {
    expect(joinPath("foo")).toBe("foo");
  });

  it("handles empty segments", () => {
    expect(joinPath("foo", "", "bar")).toBe("foo/bar");
  });

  it("handles Windows-style paths as segments", () => {
    expect(joinPath("foo\\bar", "baz")).toBe("foo/bar/baz");
  });
});

describe("isPathInside", () => {
  it("returns true when the target equals the base path", () => {
    expect(isPathInside("/vault", "/vault")).toBe(true);
  });

  it("returns true when the target is inside the base path", () => {
    expect(isPathInside("/vault", "/vault/folder/note.md")).toBe(true);
  });

  it("ignores trailing slashes on base and target paths", () => {
    expect(isPathInside("/vault/", "/vault/folder/")).toBe(true);
    expect(isPathInside("/vault/", "/vault/")).toBe(true);
  });

  it("normalizes Windows backslashes before comparing", () => {
    expect(isPathInside("C:\\vault", "C:\\vault\\folder\\note.md")).toBe(true);
  });

  it("returns false for sibling-prefix paths", () => {
    expect(isPathInside("/vault", "/vault2/file.md")).toBe(false);
    expect(isPathInside("C:\\vault", "C:\\vault2\\file.md")).toBe(false);
  });

  it("treats root as containing absolute descendant paths", () => {
    expect(isPathInside("/", "/vault/file.md")).toBe(true);
    expect(isPathInside("/", "/")).toBe(true);
  });
});
