import { describe, expect, it, vi } from "vitest";
import { createFoundationModelsSuggestionCache } from "../src/renderer/foundation-models-cache";

describe("Foundation Models suggestion cache", () => {
  it("returns cached suggestions for the same paragraph before the TTL expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const cache = createFoundationModelsSuggestionCache({ suggestionTtlMs: 60_000, nullTtlMs: 15_000, maxEntries: 4 });

    cache.set(
      { paragraph: "A paragraph", promptVersion: "p1", modelVersion: "m1", availability: "available" },
      "next."
    );

    expect(
      cache.get({ paragraph: "A paragraph", promptVersion: "p1", modelVersion: "m1", availability: "available" })
    ).toBe("next.");

    vi.setSystemTime(61_001);
    expect(
      cache.get({ paragraph: "A paragraph", promptVersion: "p1", modelVersion: "m1", availability: "available" })
    ).toBeUndefined();
    vi.useRealTimers();
  });

  it("caches null results with a shorter TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    const cache = createFoundationModelsSuggestionCache({ suggestionTtlMs: 60_000, nullTtlMs: 15_000, maxEntries: 4 });

    cache.set(
      { paragraph: "A paragraph", promptVersion: "p1", modelVersion: "m1", availability: "available" },
      null
    );

    expect(
      cache.get({ paragraph: "A paragraph", promptVersion: "p1", modelVersion: "m1", availability: "available" })
    ).toBeNull();

    vi.setSystemTime(17_001);
    expect(
      cache.get({ paragraph: "A paragraph", promptVersion: "p1", modelVersion: "m1", availability: "available" })
    ).toBeUndefined();
    vi.useRealTimers();
  });

  it("separates entries by prompt and model version", () => {
    const cache = createFoundationModelsSuggestionCache({ suggestionTtlMs: 60_000, nullTtlMs: 15_000, maxEntries: 4 });

    cache.set(
      { paragraph: "A paragraph", promptVersion: "p1", modelVersion: "m1", availability: "available" },
      "next."
    );

    expect(
      cache.get({ paragraph: "A paragraph", promptVersion: "p2", modelVersion: "m1", availability: "available" })
    ).toBeUndefined();
    expect(
      cache.get({ paragraph: "A paragraph", promptVersion: "p1", modelVersion: "m2", availability: "available" })
    ).toBeUndefined();
  });

  it("evicts the oldest entry when the cache is full", () => {
    const cache = createFoundationModelsSuggestionCache({ suggestionTtlMs: 60_000, nullTtlMs: 15_000, maxEntries: 2 });

    cache.set({ paragraph: "one", promptVersion: "p1", modelVersion: "m1", availability: "available" }, "1");
    cache.set({ paragraph: "two", promptVersion: "p1", modelVersion: "m1", availability: "available" }, "2");
    cache.set({ paragraph: "three", promptVersion: "p1", modelVersion: "m1", availability: "available" }, "3");

    expect(cache.get({ paragraph: "one", promptVersion: "p1", modelVersion: "m1", availability: "available" })).toBeUndefined();
    expect(cache.get({ paragraph: "two", promptVersion: "p1", modelVersion: "m1", availability: "available" })).toBe("2");
    expect(cache.get({ paragraph: "three", promptVersion: "p1", modelVersion: "m1", availability: "available" })).toBe("3");
  });
});
