import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MAX_SNAPSHOTS,
  hashContent,
  normalizeLabel,
  SnapshotEngine
} from "../src/engine";
import {
  createMemorySnapshotStore,
  type Snapshot,
  type SnapshotMeta,
  type SnapshotStore
} from "../src/store";

function stubStore(overrides: Partial<SnapshotStore>): SnapshotStore {
  return { ...createMemorySnapshotStore(), ...overrides };
}

describe("hashContent", () => {
  it("is stable for identical input and differs across inputs", () => {
    expect(hashContent("alpha")).toBe(hashContent("alpha"));
    expect(hashContent("alpha")).not.toBe(hashContent("beta"));
    expect(hashContent("")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("normalizeLabel", () => {
  it("trims whitespace and drops blank labels", () => {
    expect(normalizeLabel("  before refactor  ")).toBe("before refactor");
    expect(normalizeLabel("   ")).toBeUndefined();
    expect(normalizeLabel(undefined)).toBeUndefined();
  });
});

describe("SnapshotEngine", () => {
  it("captures content and lists it newest-first", async () => {
    const engine = new SnapshotEngine({ store: createMemorySnapshotStore() });
    await engine.capture("doc", "alpha");
    await engine.capture("doc", "alpha beta");

    const metas = await engine.list("doc");
    expect(metas).toHaveLength(2);
    expect(metas[0]!.createdAt).toBeGreaterThanOrEqual(metas[1]!.createdAt);
    expect(await engine.load("doc", metas[0]!.id)).toBe("alpha beta");
  });

  it("de-duplicates consecutive identical content", async () => {
    const engine = new SnapshotEngine({ store: createMemorySnapshotStore() });
    const first = await engine.capture("doc", "alpha");
    const second = await engine.capture("doc", "alpha");

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await engine.list("doc")).toHaveLength(1);
  });

  it("captures again when content changed back to an older state", async () => {
    let tick = 0;
    const engine = new SnapshotEngine({
      store: createMemorySnapshotStore(),
      now: () => ++tick
    });
    await engine.capture("doc", "alpha");
    await engine.capture("doc", "beta");
    // De-dup only compares against the newest snapshot: returning to
    // "alpha" must still be recorded so the history reflects the return.
    const meta = await engine.capture("doc", "alpha");

    expect(meta).not.toBeNull();
    const metas = await engine.list("doc");
    expect(metas).toHaveLength(3);
    expect(metas[0]!.id).toBe(meta!.id);
  });

  it("trims labels and drops blank ones", async () => {
    const engine = new SnapshotEngine({ store: createMemorySnapshotStore() });
    const labelled = await engine.capture("doc", "alpha", "  draft  ");
    const blank = await engine.capture("doc", "beta", "   ");

    expect(labelled!.label).toBe("draft");
    expect(blank!.label).toBeUndefined();
  });

  it("keeps snapshot lists isolated per document key", async () => {
    const engine = new SnapshotEngine({ store: createMemorySnapshotStore() });
    await engine.capture("a.md", "alpha");
    await engine.capture("b.md", "beta");
    await engine.capture("b.md", "gamma");

    expect(await engine.list("a.md")).toHaveLength(1);
    expect(await engine.list("b.md")).toHaveLength(2);
    expect(await engine.load("a.md", (await engine.list("b.md"))[0]!.id)).toBeNull();
  });

  it("drops the oldest snapshots beyond maxSnapshots", async () => {
    const engine = new SnapshotEngine({
      store: createMemorySnapshotStore(),
      maxSnapshots: 2,
      now: (() => {
        let tick = 0;
        return () => ++tick;
      })()
    });
    await engine.capture("doc", "one");
    await engine.capture("doc", "two");
    await engine.capture("doc", "three");

    const metas = await engine.list("doc");
    expect(metas).toHaveLength(2);
    expect(await engine.load("doc", metas[0]!.id)).toBe("three");
    expect(await engine.load("doc", metas[1]!.id)).toBe("two");
  });

  it("prunes snapshots older than maxAgeMs on capture", async () => {
    let tick = 1_000;
    const engine = new SnapshotEngine({
      store: createMemorySnapshotStore(),
      maxAgeMs: 500,
      now: () => tick
    });
    await engine.capture("doc", "old");
    tick = 1_600; // 600ms later — beyond the 500ms expiry
    await engine.capture("doc", "new");

    const metas = await engine.list("doc");
    expect(metas).toHaveLength(1);
    expect(await engine.load("doc", metas[0]!.id)).toBe("new");
  });

  it("prune() sweeps expired snapshots without a new capture", async () => {
    let tick = 1_000;
    const engine = new SnapshotEngine({
      store: createMemorySnapshotStore(),
      maxAgeMs: 500,
      now: () => tick
    });
    await engine.capture("doc", "old");
    tick = 1_600;

    await engine.prune("doc");
    expect(await engine.list("doc")).toHaveLength(0);
  });

  it("age and count retention compose", async () => {
    let tick = 1_000;
    const engine = new SnapshotEngine({
      store: createMemorySnapshotStore(),
      maxSnapshots: 2,
      maxAgeMs: 500,
      now: () => tick
    });
    await engine.capture("doc", "one");
    tick = 1_100;
    await engine.capture("doc", "two");
    tick = 1_200;
    await engine.capture("doc", "three");
    tick = 1_800; // all three are now expired

    await engine.prune("doc");
    expect(await engine.list("doc")).toHaveLength(0);
  });

  it("snapshots exactly at the age boundary survive", async () => {
    let tick = 1_000;
    const engine = new SnapshotEngine({
      store: createMemorySnapshotStore(),
      maxAgeMs: 500,
      now: () => tick
    });
    await engine.capture("doc", "edge");
    tick = 1_500; // exactly 500ms old — not older than maxAgeMs

    await engine.prune("doc");
    expect(await engine.list("doc")).toHaveLength(1);
  });

  it("keeps everything when maxAgeMs is not configured", async () => {
    let tick = 1_000;
    const engine = new SnapshotEngine({
      store: createMemorySnapshotStore(),
      now: () => tick
    });
    await engine.capture("doc", "one");
    tick = 999_999_999;
    await engine.prune("doc");
    expect(await engine.list("doc")).toHaveLength(1);
  });

  it("defaults maxSnapshots to 50", async () => {
    const store = createMemorySnapshotStore();
    const engine = new SnapshotEngine({ store });
    for (let i = 0; i < DEFAULT_MAX_SNAPSHOTS + 5; i++) {
      await engine.capture("doc", `content ${i}`);
    }
    expect(await engine.list("doc")).toHaveLength(DEFAULT_MAX_SNAPSHOTS);
  });

  it("returns null instead of throwing when the store rejects save", async () => {
    const store = stubStore({
      save: () => Promise.reject(new Error("disk full"))
    });
    const engine = new SnapshotEngine({ store });

    await expect(engine.capture("doc", "alpha")).resolves.toBeNull();

    // A later capture against a healthy store still succeeds.
    const healthy = new SnapshotEngine({ store: createMemorySnapshotStore() });
    await expect(healthy.capture("doc", "alpha")).resolves.not.toBeNull();
  });

  it("resolves an empty list when the store rejects list", async () => {
    const store = stubStore({
      list: () => Promise.reject(new Error("unreadable"))
    });
    const engine = new SnapshotEngine({ store });
    await expect(engine.list("doc")).resolves.toEqual([]);
  });

  it("treats load failures and missing ids as null", async () => {
    const store = stubStore({
      load: () => Promise.reject(new Error("gone"))
    });
    const engine = new SnapshotEngine({ store });
    await expect(engine.load("doc", "missing")).resolves.toBeNull();

    const healthy = new SnapshotEngine({ store: createMemorySnapshotStore() });
    await expect(healthy.load("doc", "missing")).resolves.toBeNull();
  });

  it("serializes concurrent captures without losing entries", async () => {
    const engine = new SnapshotEngine({ store: createMemorySnapshotStore() });
    await Promise.all([
      engine.capture("doc", "one"),
      engine.capture("doc", "two"),
      engine.capture("doc", "three")
    ]);
    expect(await engine.list("doc")).toHaveLength(3);
  });

  it("generates unique ids for same-millisecond captures", async () => {
    const engine = new SnapshotEngine({
      store: createMemorySnapshotStore(),
      now: () => 42
    });
    const a = await engine.capture("doc", "one");
    const b = await engine.capture("doc", "two");
    expect(a!.id).not.toBe(b!.id);
  });
});

describe("createMemorySnapshotStore", () => {
  it("round-trips snapshots across engine instances (persistence contract)", async () => {
    const store = createMemorySnapshotStore();
    const first = new SnapshotEngine({ store });
    const meta = await first.capture("doc", "persisted");

    const second = new SnapshotEngine({ store });
    expect(await second.list("doc")).toHaveLength(1);
    expect(await second.load("doc", meta!.id)).toBe("persisted");
  });

  it("does not mutate caller state when snapshots change after save", async () => {
    const store = createMemorySnapshotStore();
    const snapshot: Snapshot = {
      id: "1-abc",
      createdAt: 1,
      size: 3,
      hash: "abc",
      content: "one"
    };
    await store.save("doc", snapshot);
    snapshot.content = "tampered";
    await expect(store.load("doc", "1-abc")).resolves.toBe("one");
  });

  it("remove of a missing id does not throw", async () => {
    const store = createMemorySnapshotStore();
    await expect(store.remove("doc", "missing")).resolves.toBeUndefined();
  });

  it("clear drops only the target document key", async () => {
    const store = createMemorySnapshotStore();
    const engine = new SnapshotEngine({ store });
    await engine.capture("a", "one");
    await engine.capture("b", "two");
    await store.clear("a");
    expect(await engine.list("a")).toEqual([]);
    expect(await engine.list("b")).toHaveLength(1);
  });
});

describe("SnapshotStore failure hooks", () => {
  it("notifies spies on remove and clear", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);
    const store = stubStore({ remove, clear });
    const engine = new SnapshotEngine({ store });
    const meta = (await engine.capture("doc", "one")) as SnapshotMeta;

    await engine.remove("doc", meta.id);
    await engine.clear("doc");
    expect(remove).toHaveBeenCalledWith("doc", meta.id);
    expect(clear).toHaveBeenCalledWith("doc");
  });
});
