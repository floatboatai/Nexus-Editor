import type {
  ManagedResource,
  NexusAbstractFile,
  NexusFile,
  ResourceOwner,
  WindowId,
} from "@floatboat/nexus-plugin-api";
import { describe, expect, it, vi } from "vitest";

import { createRuntimeOwner } from "../src/workspace/runtime-workspace";
import { MemoryContentRuntime } from "../src/content/content-runtime";
import { VaultPathPolicy } from "../src/content/path-policy";

function harness(
  files: Readonly<Record<string, string | Uint8Array>> = {},
  options: ConstructorParameters<typeof MemoryContentRuntime>[0] = {},
) {
  const runtime = new MemoryContentRuntime({ initialFiles: files, ...options });
  const owner = createRuntimeOwner("content-test");
  const resources: ManagedResource[] = [];
  const services = runtime.createServices(owner, (resource) => resources.push(resource));
  const activate = async () => {
    for (const resource of resources) await resource.activate?.();
  };
  return { runtime, owner, resources, services, activate };
}

function requireFile(file: NexusAbstractFile | null): NexusFile {
  if (!file || file.kind !== "file") throw new Error("Expected a file");
  return file;
}

describe("Vault path authorization", () => {
  it.each([
    "/etc/passwd",
    "../secret.md",
    "safe/../../secret.md",
    "safe\\secret.md",
    "safe\0secret.md",
    "%2e%2e/secret.md",
    "%252e%252e%252fsecret.md",
    "C:/secret.md",
    "file://secret.md",
  ])("rejects traversal or non-relative path %s", (path) => {
    const policy = new VaultPathPolicy();
    expect(policy.result(path)).toMatchObject({
      ok: false,
      diagnostic: { code: "path-outside-authorized-root" },
    });
  });

  it("normalizes benign relative paths and lets host adapters reject symlink escapes", () => {
    const resolve = vi.fn((path: string) => ({ authorized: path !== "linked/out.md" }));
    const policy = new VaultPathPolicy({ resolver: { resolve } });
    expect(policy.normalize("Notes//./cafe\u0301.md")).toBe("Notes/caf\u00e9.md");
    expect(policy.result("linked/out.md")).toMatchObject({
      ok: false,
      diagnostic: { code: "path-outside-authorized-root" },
    });
    expect(resolve).toHaveBeenCalledWith("linked/out.md");
  });
});

describe("MemoryVaultRuntime", () => {
  it("preserves stable identity across rename and invalidates deleted references", async () => {
    const { services } = harness(
      { "Notes/old.md": "old" },
      { allowPermanentDelete: () => true },
    );
    const original = requireFile(services.vault.getFileByPath("Notes/old.md" as never));
    const originalId = original.id;
    const moved = await services.vault.rename(original, "Notes/new.md" as never);
    expect(moved.ok).toBe(true);
    expect(original.path).toBe("Notes/new.md");
    expect(original.id).toBe(originalId);
    expect(Object.keys(original)).not.toContain("runtime");
    expect("replace" in original).toBe(false);
    expect("bytes" in original).toBe(false);
    expect(services.vault.getFileByPath("Notes/new.md" as never)).toBe(original);

    await services.vault.delete(original, { permanent: true });
    expect(original.valid).toBe(false);
    const replacement = await services.vault.create("Notes/new.md" as never, "replacement");
    expect(replacement.ok).toBe(true);
    if (!replacement.ok) return;
    expect(replacement.file.id).not.toBe(originalId);
    await expect(services.vault.read(original)).rejects.toMatchObject({
      diagnostic: { code: "file-invalid-reference" },
    });
  });

  it("requires explicit host permission for permanent deletion", async () => {
    const { services } = harness({ "keep.md": "keep" });
    const file = requireFile(services.vault.getFileByPath("keep.md" as never));
    expect(await services.vault.delete(file, { permanent: true })).toMatchObject({
      ok: false,
      diagnostic: { code: "permission-denied" },
    });
    expect(file.valid).toBe(true);
    expect(await services.vault.read(file)).toBe("keep");
  });

  it("rejects references created by another Vault", async () => {
    const first = harness({ "note.md": "first" });
    const second = harness({ "note.md": "second" });
    const foreign = requireFile(first.services.vault.getFileByPath("note.md" as never));
    await expect(second.services.vault.read(foreign)).rejects.toMatchObject({
      diagnostic: { code: "file-invalid-reference" },
    });
    expect(await second.services.vault.modify(foreign, "bad")).toMatchObject({
      ok: false,
      diagnostic: { code: "file-invalid-reference" },
    });
    expect(second.services.metadata.getFileCache(foreign)).toBeNull();
    expect(await second.services.resources.createResourceUrl(foreign)).toMatchObject({
      ok: false,
      diagnostic: { code: "file-invalid-reference" },
    });
  });

  it("supports text, binary, append, version checks, and snapshots input buffers", async () => {
    const { services } = harness();
    const buffer = new Uint8Array([1, 2, 3]);
    const created = await services.vault.createBinary(
      "asset.bin" as never,
      buffer.buffer,
    );
    buffer[0] = 99;
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect([...new Uint8Array(await services.vault.readBinary(created.file))]).toEqual([1, 2, 3]);

    const note = await services.vault.create("note.md" as never, "a");
    expect(note.ok).toBe(true);
    if (!note.ok) return;
    const appended = await services.vault.append(note.file, "b", {
      expectedVersion: note.version,
    });
    expect(appended.ok).toBe(true);
    const conflict = await services.vault.modify(note.file, "lost", {
      expectedVersion: note.version,
    });
    expect(conflict).toMatchObject({
      ok: false,
      diagnostic: { code: "file-version-conflict" },
      currentVersion: appended.ok ? appended.version : undefined,
    });
    expect(await services.vault.read(note.file)).toBe("ab");
  });

  it("serializes process calls and leaves content/version unchanged on failure", async () => {
    const { services } = harness({ "counter.md": "0" });
    const file = requireFile(services.vault.getFileByPath("counter.md" as never));
    const first = services.vault.process(file, (current) => String(Number(current) + 1));
    const second = services.vault.process(file, (current) => String(Number(current) + 1));
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(await services.vault.read(file)).toBe("2");
    const beforeVersion = file.version;
    const failed = await services.vault.process(file, () => {
      throw new Error("stop");
    });
    expect(failed).toMatchObject({ ok: false, diagnostic: { code: "callback-failed" } });
    expect(file.version).toBe(beforeVersion);
    expect(await services.vault.read(file)).toBe("2");
  });

  it("emits typed origins once and deduplicates watcher echoes by operation ID", async () => {
    const { runtime, services, activate } = harness({ "note.md": "before" });
    const events: Array<{ type: string; operationId: string; kind: string }> = [];
    services.vault.events.on("modify", ({ origin }) => {
      events.push({ type: "modify", operationId: origin.operationId, kind: origin.kind });
    });
    await activate();
    const file = requireFile(services.vault.getFileByPath("note.md" as never));
    const result = await services.vault.modify(file, "after");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(events).toEqual([
      { type: "modify", operationId: result.operationId, kind: "plugin" },
    ]);
    expect(await runtime.vault.confirmExternalChange({
      type: "modify",
      path: "note.md",
      data: "after",
      operationId: result.operationId,
    })).toEqual({ ok: true, deduplicated: true });
    expect(events).toHaveLength(1);
    const external = await runtime.vault.confirmExternalChange({
      type: "modify",
      path: "note.md",
      data: "external",
    });
    expect(external).toMatchObject({ ok: true, deduplicated: false });
    expect(events.at(-1)?.kind).toBe("external");
  });

  it("keeps a durable host adapter's plugin origin when confirming a write", async () => {
    const { runtime, services, activate } = harness({ "note.md": "before" });
    const origins: Array<{ kind: string; operationId: string }> = [];
    services.vault.events.on("modify", ({ origin }) => origins.push(origin));
    await activate();

    const operationId = "electron-write-1" as never;
    expect(await runtime.vault.confirmHostChange({
      type: "modify",
      path: "note.md",
      data: "after",
      operationId,
    }, {
      kind: "plugin",
      pluginId: "content-test" as never,
      operationId,
    })).toMatchObject({ ok: true, deduplicated: false, operationId });
    expect(origins).toHaveLength(1);
    expect(origins[0]).toMatchObject({ kind: "plugin", operationId });

    expect(await runtime.vault.confirmExternalChange({
      type: "modify",
      path: "note.md",
      data: "after",
      operationId,
    })).toEqual({ ok: true, deduplicated: true });
    expect(origins).toHaveLength(1);
  });

  it("confirms durable folder creation and deduplicates its watcher echo", async () => {
    const { runtime, services, activate } = harness();
    const creates: Array<{ kind: string; operationId: string; path: string; fileKind: string }> = [];
    services.vault.events.on("create", ({ file, origin }) => {
      creates.push({
        kind: origin.kind,
        operationId: origin.operationId,
        path: file.path,
        fileKind: file.kind,
      });
    });
    await activate();

    const operationId = "electron-folder-1" as never;
    expect(await runtime.vault.confirmHostChange({
      type: "create-folder",
      path: "Projects/Alpha",
      operationId,
    }, {
      kind: "plugin",
      pluginId: "content-test" as never,
      operationId,
    })).toMatchObject({ ok: true, deduplicated: false, operationId });
    expect(runtime.vault.getFolderByPath("Projects/Alpha")).toMatchObject({
      kind: "folder",
      path: "Projects/Alpha",
    });
    expect(creates.at(-1)).toEqual({
      kind: "plugin",
      operationId,
      path: "Projects/Alpha",
      fileKind: "folder",
    });

    const eventCount = creates.length;
    expect(await runtime.vault.confirmExternalChange({
      type: "create-folder",
      path: "Projects/Alpha",
      operationId,
    })).toEqual({ ok: true, deduplicated: true });
    expect(creates).toHaveLength(eventCount);
  });

  it("does not advance versions or emit modify for a no-op process", async () => {
    const { services, activate } = harness({ "note.md": "same" });
    const file = requireFile(services.vault.getFileByPath("note.md" as never));
    const modify = vi.fn();
    services.vault.events.on("modify", modify);
    await activate();
    const version = file.version;
    const result = await services.vault.process(file, (current) => current);
    expect(result).toMatchObject({ ok: true, version });
    expect(file.version).toBe(version);
    expect(modify).not.toHaveBeenCalled();
  });

  it("keeps operation IDs host-issued and stops old service facades after dispose", async () => {
    const { runtime, services } = harness({ "note.md": "one" });
    const file = requireFile(services.vault.getFileByPath("note.md" as never));
    const first = await services.vault.modify(file, "two", { origin: "caller-label" });
    const second = await services.vault.modify(file, "three", { origin: "caller-label" });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.operationId).not.toBe("caller-label");
    expect(first.operationId).not.toBe(second.operationId);
    await runtime.dispose();
    await expect(services.vault.read(file)).rejects.toThrow("disposed");
    expect(await services.vault.create("after.md" as never, "no")).toMatchObject({
      ok: false,
      diagnostic: { code: "unsupported-operation" },
    });
  });
});

describe("FileManager and frontmatter", () => {
  it("moves files, updates resolvable wiki links, and defaults to recoverable trash", async () => {
    const { runtime, services } = harness({
      "Notes/target.md": "# Target",
      "source.md": "See [[Notes/target|target]], [[target]], and \\[[target]].",
    });
    const target = requireFile(services.vault.getFileByPath("Notes/target.md" as never));
    const moved = await services.fileManager.moveFile(target, "Archive/target.md" as never, {
      updateLinks: "always",
    });
    expect(moved.ok).toBe(true);
    const source = requireFile(services.vault.getFileByPath("source.md" as never));
    expect(await services.vault.read(source)).toBe(
      "See [[Archive/target|target]], [[Archive/target]], and \\[[target]].",
    );
    expect(services.fileManager.generateMarkdownLink(target, { alias: "Target" })).toBe(
      "[[Archive/target|Target]]",
    );
    const trashed = await services.fileManager.trashFile(target);
    expect(trashed).toEqual({ ok: true, value: { recoverable: true } });
    expect(target.valid).toBe(true);
    expect(target.path).toBe(".trash/Archive/target.md");
    expect(runtime.vault.getFileById(target.id)).toBe(target);
  });

  it("rewrites only wiki links that resolve to the moved file", async () => {
    const { services } = harness({
      "Projects/Notes/target.md": "# Target",
      "Other/target.md": "# Other",
      "Projects/source.md": "![[Notes/target#Heading|preview]]",
      "Projects/Notes/local.md": "[[target]]",
      "Other/source.md": "[[target]]",
      "root.md": "[[target]] and [[Projects/Notes/target]]",
    });
    const target = requireFile(
      services.vault.getFileByPath("Projects/Notes/target.md" as never),
    );
    const other = requireFile(services.vault.getFileByPath("Other/target.md" as never));
    const relativeSource = requireFile(
      services.vault.getFileByPath("Projects/source.md" as never),
    );
    const localSource = requireFile(
      services.vault.getFileByPath("Projects/Notes/local.md" as never),
    );
    const otherSource = requireFile(
      services.vault.getFileByPath("Other/source.md" as never),
    );
    const rootSource = requireFile(services.vault.getFileByPath("root.md" as never));

    expect(services.metadata.resolveLink("Notes/target", relativeSource.path)).toBe(target);
    expect(services.metadata.resolveLink("target", localSource.path)).toBe(target);
    expect(services.metadata.resolveLink("target", otherSource.path)).toBe(other);
    expect(services.metadata.resolveLink("target", rootSource.path)).toBeNull();

    const moved = await services.fileManager.moveFile(
      target,
      "Archive/target.md" as never,
      { updateLinks: "always" },
    );

    expect(moved.ok).toBe(true);
    expect(await services.vault.read(relativeSource)).toBe(
      "![[Archive/target#Heading|preview]]",
    );
    expect(await services.vault.read(localSource)).toBe("[[Archive/target]]");
    expect(await services.vault.read(otherSource)).toBe("[[target]]");
    expect(await services.vault.read(rootSource)).toBe(
      "[[target]] and [[Archive/target]]",
    );
  });

  it("uses a concurrently moved source's current path when resolving links", async () => {
    const { services } = harness({
      "A/foo.md": "# A",
      "B/foo.md": "# B",
      "A/source.md": "[[foo]]",
    });
    const target = requireFile(services.vault.getFileByPath("A/foo.md" as never));
    const source = requireFile(services.vault.getFileByPath("A/source.md" as never));

    const movingSource = services.fileManager.moveFile(
      source,
      "B/source.md" as never,
      { updateLinks: "never" },
    );
    const movingTarget = services.fileManager.moveFile(
      target,
      "C/foo.md" as never,
      { updateLinks: "always" },
    );

    expect(await Promise.all([movingSource, movingTarget])).toMatchObject([
      { ok: true },
      { ok: true },
    ]);
    expect(source.path).toBe("B/source.md");
    expect(await services.vault.read(source)).toBe("[[foo]]");
  });

  it("resolves links from the topology established by an earlier queued move", async () => {
    const { services } = harness({
      "A/foo.md": "# Target",
      "B/foo.md": "# Competitor",
      "source.md": "[[foo]]",
    });
    const target = requireFile(services.vault.getFileByPath("A/foo.md" as never));
    const competitor = requireFile(services.vault.getFileByPath("B/foo.md" as never));
    const source = requireFile(services.vault.getFileByPath("source.md" as never));

    const movingCompetitor = services.fileManager.moveFile(
      competitor,
      "B/bar.md" as never,
      { updateLinks: "never" },
    );
    const movingTarget = services.fileManager.moveFile(
      target,
      "C/qux.md" as never,
      { updateLinks: "always" },
    );

    expect(await Promise.all([movingCompetitor, movingTarget])).toMatchObject([
      { ok: true },
      { ok: true },
    ]);
    expect(await services.vault.read(source)).toBe("[[C/qux]]");
  });

  it("serializes safe YAML frontmatter without changing the body", async () => {
    const { services } = harness({ "note.md": "Body\r\ncontinues\r\n" });
    const file = requireFile(services.vault.getFileByPath("note.md" as never));
    const result = await services.fileManager.processFrontmatter(file, (frontmatter) => {
      frontmatter.status = "done";
      frontmatter.count = 2;
    });
    expect(result.ok).toBe(true);
    const content = await services.vault.read(file);
    expect(content).toContain("status: done\r\ncount: 2");
    expect(content.endsWith("Body\r\ncontinues\r\n")).toBe(true);

    const version = file.version;
    const polluted = await services.fileManager.processFrontmatter(file, (frontmatter) => {
      Object.defineProperty(frontmatter, "__proto__", {
        value: { polluted: true },
        enumerable: true,
      });
    });
    expect(polluted).toMatchObject({ ok: false, diagnostic: { code: "callback-failed" } });
    expect(file.version).toBe(version);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();

    const cyclic = await services.fileManager.processFrontmatter(file, (frontmatter) => {
      (frontmatter as Record<string, unknown>).self = frontmatter;
    });
    expect(cyclic.ok).toBe(false);
    expect(file.version).toBe(version);
  });

  it("publishes processFrontmatter as Vault modify then matching metadata changed", async () => {
    const { services, activate } = harness({ "note.md": "Body\n" });
    const file = requireFile(services.vault.getFileByPath("note.md" as never));
    const order: string[] = [];
    services.vault.events.on("modify", ({ version }) => order.push(`vault:${version}`));
    services.metadata.events.on("changed", ({ version }) => order.push(`metadata:${version}`));
    await activate();

    const result = await services.fileManager.processFrontmatter(file, (frontmatter) => {
      frontmatter.status = "done";
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const metadata = await services.metadata.waitForVersion(file, result.version);
    expect(metadata.frontmatter).toEqual({ status: "done" });
    expect(order).toEqual([
      `vault:${result.version}`,
      `metadata:${result.version}`,
    ]);
  });

  it("finds collision-free attachment paths", async () => {
    const { services } = harness({ "Notes/photo.png": new Uint8Array([1]) });
    expect(await services.fileManager.getAvailableAttachmentPath({
      name: "photo.png",
      sourcePath: "Notes/note.md" as never,
    })).toBe("Notes/photo 1.png");
  });
});

describe("Metadata and resource services", () => {
  it("indexes versioned metadata and preserves modify -> changed -> resolved ordering", async () => {
    const { services, activate } = harness({
      "Target.md": "# Target",
      "source.md": "old",
    });
    const order: string[] = [];
    services.vault.events.on("modify", ({ version }) => order.push(`vault:${version}`));
    services.metadata.events.on("changed", ({ version }) => order.push(`metadata:${version}`));
    services.metadata.events.on("resolved", () => order.push("resolved"));
    await activate();
    const source = requireFile(services.vault.getFileByPath("source.md" as never));
    const result = await services.vault.modify(
      source,
      [
        "---",
        "status: active",
        "---",
        "# Heading",
        "#tag",
        "See [[Target]] and ![[missing.png]].",
        "Block ^block-id",
      ].join("\n"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const metadata = await services.metadata.waitForVersion(source, result.version);
    expect(metadata).toMatchObject({
      version: result.version,
      frontmatter: { status: "active" },
      headings: [{ heading: "Heading", level: 1 }],
      tags: ["#tag"],
      links: [{ link: "Target", embed: false }],
      embeds: [{ link: "missing.png", embed: true }],
    });
    expect(() => {
      (metadata.frontmatter as { status: string }).status = "mutated";
    }).toThrow();
    expect(metadata.blocks["block-id"]?.id).toBe("block-id");
    expect(services.metadata.getResolvedLinks(source)).toHaveLength(1);
    expect(services.metadata.getBacklinks(
      requireFile(services.vault.getFileByPath("Target.md" as never)),
    )).toHaveLength(1);
    expect(services.metadata.getUnresolvedLinks(source)).toMatchObject([
      { target: "missing.png" },
    ]);
    expect(order).toEqual([
      `vault:${result.version}`,
      `metadata:${result.version}`,
      "resolved",
    ]);
  });

  it("migrates unresolved links after the target is created", async () => {
    const { services } = harness({ "source.md": "[[Later]]" });
    const source = requireFile(services.vault.getFileByPath("source.md" as never));
    expect(services.metadata.getUnresolvedLinks(source)).toHaveLength(1);
    const created = await services.vault.create("Later.md" as never, "# Later");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await services.metadata.waitForVersion(created.file, created.version);
    expect(services.metadata.getUnresolvedLinks(source)).toHaveLength(0);
    expect(services.metadata.getResolvedLinks(source)).toHaveLength(1);
  });

  it("creates opaque owner/window-bound URLs and revokes access on dispose", async () => {
    let token = 0;
    const { runtime, resources, services, activate } = harness(
      { "private/secret image.png": new Uint8Array([1]) },
      {
        hostId: "host-a",
        vaultId: "vault-a",
        resourceTokenFactory: () => `token-${++token}`,
      },
    );
    const file = requireFile(
      services.vault.getFileByPath("private/secret image.png" as never),
    );
    const windowId = "window-1" as WindowId;
    const created = await services.resources.createResourceUrl(file, { windowId });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.url).not.toContain("private");
    expect(created.value.url).not.toContain("secret");
    await activate();
    expect(runtime.resources.resolve(created.value.url, "window-2" as WindowId)).toMatchObject({
      ok: false,
      diagnostic: { code: "permission-denied" },
    });
    expect(runtime.resources.resolve(created.value.url, windowId)).toMatchObject({
      ok: true,
      value: { file: { id: file.id } },
    });
    await services.vault.rename(file, "renamed.png" as never);
    expect(runtime.resources.resolve(created.value.url, windowId)).toMatchObject({ ok: true });
    await created.value.dispose();
    expect(created.value.revoked).toBe(true);
    expect(runtime.resources.resolve(created.value.url, windowId)).toMatchObject({
      ok: false,
      diagnostic: { code: "resource-url-revoked" },
    });
    expect(resources).toContain(created.value);
  });
});
