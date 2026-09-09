// @vitest-environment node

import { constants } from "node:fs";
import { lstat, mkdtemp, mkdir, open, readFile, realpath, rename, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  ElectronExternalNavigationBroker,
  ElectronPluginStorageBroker,
  ElectronVaultBroker,
  PluginHostBrokerError,
  normalizeVaultRelativePath,
  type SenderIdentity,
  type VaultBrokerOptions,
} from "../electron/plugin-host-broker";
import {
  PLUGIN_HOST_PERMISSIONS,
  type PluginVaultChangeEvent,
} from "../src/shared/plugin-ipc";

const sender: SenderIdentity = { id: 7, url: "app://nexus/index.html" };
const otherSender: SenderIdentity = { id: 8, url: "app://nexus/index.html" };

interface WatchHarness {
  readonly callbacks: Array<(eventType: string, filename: string | Buffer | null) => void>;
  readonly closed: ReturnType<typeof vi.fn>;
}

function watchHarness(): WatchHarness & {
  factory: (root: string, callback: (eventType: string, filename: string | Buffer | null) => void) => { close(): void };
} {
  const callbacks: WatchHarness["callbacks"] = [];
  const closed = vi.fn();
  return {
    callbacks,
    closed,
    factory: (_root, callback) => {
      callbacks.push(callback);
      return { close: closed };
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function fixtureVault(): Promise<{ root: string; outside: string }> {
  const parent = await mkdtemp(path.join(tmpdir(), "nexus-broker-"));
  const root = path.join(parent, "vault");
  const outside = path.join(parent, "outside");
  await mkdir(path.join(root, "Notes"), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(root, "Notes", "A.md"), "alpha");
  await writeFile(path.join(outside, "secret.md"), "secret");
  return { root, outside };
}

function createBroker(options: {
  events?: PluginVaultChangeEvent[];
  trashItem?: (absolutePath: string) => Promise<void>;
  showItemInFolder?: (absolutePath: string) => void | Promise<void>;
  watch?: ReturnType<typeof watchHarness>;
  now?: () => number;
  statPath?: VaultBrokerOptions["statPath"];
  lstatPath?: VaultBrokerOptions["lstatPath"];
  realpathPath?: VaultBrokerOptions["realpathPath"];
  openPath?: VaultBrokerOptions["openPath"];
} = {}): ElectronVaultBroker {
  let sessionCounter = 0;
  let operationCounter = 0;
  return new ElectronVaultBroker({
    isSenderAuthorized: (candidate) => candidate.url === "app://nexus/index.html" && [7, 8].includes(candidate.id),
    trashItem: options.trashItem ?? (async () => undefined),
    showItemInFolder: options.showItemInFolder,
    watchFactory: options.watch?.factory ?? (() => ({ close() {} })),
    onChange: (_senderId, event) => options.events?.push(event),
    sessionId: () => `11111111-1111-4111-8111-${String(++sessionCounter).padStart(12, "0")}`,
    operationId: () => `operation-${++operationCounter}`,
    now: options.now,
    statPath: options.statPath,
    lstatPath: options.lstatPath,
    realpathPath: options.realpathPath,
    openPath: options.openPath,
  });
}

describe("normalizeVaultRelativePath", () => {
  it.each(["../secret.md", "Notes/../secret.md", "/tmp/a.md", "C:/a.md", "Notes\\A.md", "Notes//A.md"])(
    "rejects non-canonical or absolute path %s",
    (value) => expect(() => normalizeVaultRelativePath(value)).toThrowError(PluginHostBrokerError),
  );

  it("accepts canonical POSIX paths only", () => {
    expect(normalizeVaultRelativePath("Notes/A.md")).toBe("Notes/A.md");
  });
});

describe("ElectronExternalNavigationBroker", () => {
  function createNavigationBroker(policies: Readonly<Record<string, {
    declaredPermissions: readonly (typeof PLUGIN_HOST_PERMISSIONS)[keyof typeof PLUGIN_HOST_PERMISSIONS][];
    grantedPermissions: readonly (typeof PLUGIN_HOST_PERMISSIONS)[keyof typeof PLUGIN_HOST_PERMISSIONS][];
  }>> = {
    fixture: {
      declaredPermissions: [PLUGIN_HOST_PERMISSIONS.externalUrl, PLUGIN_HOST_PERMISSIONS.externalProtocol],
      grantedPermissions: [PLUGIN_HOST_PERMISSIONS.externalUrl, PLUGIN_HOST_PERMISSIONS.externalProtocol],
    },
  }) {
    const openExternal = vi.fn(async (_url: string) => undefined);
    let capabilityCounter = 0;
    const broker = new ElectronExternalNavigationBroker({
      isSenderAuthorized: (candidate) =>
        candidate.url === "app://nexus/index.html" && [7, 8].includes(candidate.id),
      openExternal,
      resolvePluginPolicy: (pluginId) => policies[pluginId] ?? null,
      instanceCapability: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++capabilityCounter).padStart(12, "0")}`,
    });
    return { broker, openExternal };
  }

  it("rejects unauthorized senders before invoking the platform opener", async () => {
    const { broker, openExternal } = createNavigationBroker();
    const capability = broker.activatePlugin(sender, "fixture");

    await expect(broker.open({ id: 99, url: sender.url }, capability, "https://example.com"))
      .rejects.toMatchObject({ code: "sender-not-authorized" });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("allows HTTPS and mailto only when their independent permissions are granted", async () => {
    const { broker, openExternal } = createNavigationBroker();
    const capability = broker.activatePlugin(sender, "fixture");

    await expect(broker.open(sender, capability, "https://example.com/docs?q=1")).resolves.toBeUndefined();
    await expect(broker.open(sender, capability, "mailto:hello@example.com?subject=Nexus")).resolves.toBeUndefined();
    expect(openExternal).toHaveBeenNthCalledWith(1, "https://example.com/docs?q=1");
    expect(openExternal).toHaveBeenNthCalledWith(2, "mailto:hello@example.com?subject=Nexus");
  });

  it("keeps external navigation grants isolated between BrowserWindow senders", async () => {
    const { broker, openExternal } = createNavigationBroker({
      https: {
        declaredPermissions: [PLUGIN_HOST_PERMISSIONS.externalUrl],
        grantedPermissions: [PLUGIN_HOST_PERMISSIONS.externalUrl],
      },
      mail: {
        declaredPermissions: [PLUGIN_HOST_PERMISSIONS.externalProtocol],
        grantedPermissions: [PLUGIN_HOST_PERMISSIONS.externalProtocol],
      },
    });
    const httpsCapability = broker.activatePlugin(sender, "https");
    const mailCapability = broker.activatePlugin(otherSender, "mail");

    await expect(broker.open(sender, httpsCapability, "https://example.com/window-a")).resolves.toBeUndefined();
    await expect(broker.open(sender, httpsCapability, "mailto:a@example.com"))
      .rejects.toMatchObject({ code: "host-permission-denied" });
    await expect(broker.open(otherSender, mailCapability, "mailto:b@example.com")).resolves.toBeUndefined();
    await expect(broker.open(otherSender, mailCapability, "https://example.com/window-b"))
      .rejects.toMatchObject({ code: "host-permission-denied" });
    await expect(broker.open(otherSender, httpsCapability, "https://example.com/stolen"))
      .rejects.toMatchObject({ code: "host-permission-denied" });
    expect(openExternal).toHaveBeenCalledTimes(2);
  });

  it.each([
    "http://example.com",
    "file:///tmp/secret",
    "javascript:alert(1)",
    "nexus-vault://resource/token",
    "obsidian://open?vault=private",
  ])("rejects the unapproved external scheme in %s", async (url) => {
    const { broker, openExternal } = createNavigationBroker();
    const capability = broker.activatePlugin(sender, "fixture");

    await expect(broker.open(sender, capability, url)).rejects.toMatchObject({ code: "external-protocol-denied" });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("rejects malformed external URLs before invoking the platform opener", async () => {
    const { broker, openExternal } = createNavigationBroker();
    const capability = broker.activatePlugin(sender, "fixture");

    await expect(broker.open(sender, capability, "not an absolute URL"))
      .rejects.toMatchObject({ code: "external-url-invalid" });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("denies missing grants and removes them when the plugin or window closes", async () => {
    const { broker, openExternal } = createNavigationBroker({
      fixture: {
        declaredPermissions: [PLUGIN_HOST_PERMISSIONS.externalUrl],
        grantedPermissions: [PLUGIN_HOST_PERMISSIONS.externalUrl],
      },
    });
    const firstCapability = broker.activatePlugin(sender, "fixture");

    await expect(broker.open(sender, firstCapability, "mailto:hello@example.com"))
      .rejects.toMatchObject({ code: "host-permission-denied" });
    broker.revokePlugin(sender, firstCapability);
    await expect(broker.open(sender, firstCapability, "https://example.com"))
      .rejects.toMatchObject({ code: "host-permission-denied" });
    const secondCapability = broker.activatePlugin(sender, "fixture");
    expect(secondCapability).not.toBe(firstCapability);
    broker.closeSender(sender.id);
    await expect(broker.open(sender, secondCapability, "https://example.com"))
      .rejects.toMatchObject({ code: "sender-not-authorized" });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("reports generic system shell as unsupported and never grants it", () => {
    const { broker } = createNavigationBroker({
      fixture: {
        declaredPermissions: [PLUGIN_HOST_PERMISSIONS.systemShell],
        grantedPermissions: [PLUGIN_HOST_PERMISSIONS.systemShell],
      },
    });

    expect(broker.permissionStatus(sender, "missing", PLUGIN_HOST_PERMISSIONS.systemShell)).toBe("unsupported");
    expect(() => broker.activatePlugin(sender, "fixture"))
      .toThrowError(expect.objectContaining({ code: "host-operation-unsupported" }));
  });

  it("never grants a permission that the plugin did not declare", async () => {
    const { broker, openExternal } = createNavigationBroker({
      fixture: {
        declaredPermissions: [PLUGIN_HOST_PERMISSIONS.externalUrl],
        grantedPermissions: [PLUGIN_HOST_PERMISSIONS.externalProtocol],
      },
    });

    expect(() => broker.activatePlugin(sender, "fixture"))
      .toThrowError(expect.objectContaining({ code: "host-permission-denied" }));
    expect(() => broker.activatePlugin(sender, "renderer-invented-plugin"))
      .toThrowError(expect.objectContaining({ code: "host-permission-denied" }));
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe("ElectronVaultBroker", () => {
  it("reveals only a path authorized by the owning Vault session", async () => {
    const { root } = await fixtureVault();
    const showItemInFolder = vi.fn();
    const broker = createBroker({ showItemInFolder });
    const session = await broker.openSession(sender, root);

    await broker.showItemInFolder(sender, session.sessionId, "Notes/A.md");
    expect(showItemInFolder).toHaveBeenCalledWith(await realpath(path.join(root, "Notes", "A.md")));
    await expect(broker.showItemInFolder(sender, session.sessionId, "../outside/secret.md"))
      .rejects.toMatchObject({ code: "vault-path-invalid" });
    expect(showItemInFolder).toHaveBeenCalledTimes(1);
  });

  it("does not publish a session or watcher when its sender closes during stat", async () => {
    const { root } = await fixtureVault();
    const waitingStat = deferred<Awaited<ReturnType<typeof stat>>>();
    const watcher = watchHarness();
    const broker = createBroker({
      watch: watcher,
      statPath: (() => waitingStat.promise) as typeof stat,
    });
    const opening = broker.openSession(sender, root);

    broker.closeSender(sender.id);
    waitingStat.resolve(await stat(root));

    await expect(opening).rejects.toMatchObject({ code: "vault-session-invalid" });
    expect(broker.activeSessionCount()).toBe(0);
    expect(watcher.callbacks).toHaveLength(0);
  });

  it("closes a watcher created during a closeSender interleave before publishing the session", async () => {
    const { root } = await fixtureVault();
    const watcherClosed = vi.fn();
    let broker!: ElectronVaultBroker;
    broker = createBroker({
      watch: {
        callbacks: [],
        closed: watcherClosed,
        factory: (_root, _callback) => {
          broker.closeSender(sender.id);
          return { close: watcherClosed };
        },
      },
    });

    await expect(broker.openSession(sender, root)).rejects.toMatchObject({ code: "vault-session-invalid" });
    expect(broker.activeSessionCount()).toBe(0);
    expect(watcherClosed).toHaveBeenCalledOnce();
  });

  it("invalidates every pending open when closeAll races with realpath", async () => {
    const { root } = await fixtureVault();
    const waitingRealpath = deferred<string>();
    const watcher = watchHarness();
    const broker = createBroker({
      watch: watcher,
      realpathPath: (() => waitingRealpath.promise) as unknown as typeof realpath,
    });
    const opening = broker.openSession(sender, root);
    await vi.waitFor(() => expect(broker.activeSessionCount()).toBe(0));

    broker.closeAll();
    waitingRealpath.resolve(await realpath(root));

    await expect(opening).rejects.toMatchObject({ code: "vault-session-invalid" });
    expect(watcher.callbacks).toHaveLength(0);
  });

  it("binds sessions to the authorized sender and exposes only relative paths", async () => {
    const { root } = await fixtureVault();
    const broker = createBroker();
    const session = await broker.openSession(sender, root);

    const nodes = await broker.list(sender, session.sessionId);
    expect(nodes).toEqual([{
      name: "Notes",
      path: "Notes",
      kind: "folder",
      children: [{ name: "A.md", path: "Notes/A.md", kind: "file" }],
    }]);
    await expect(broker.read(otherSender, session.sessionId, "Notes/A.md")).rejects.toMatchObject({
      code: "vault-session-invalid",
    });
    expect(JSON.stringify(nodes)).not.toContain(root);
  });

  it("rejects traversal and symlink escape for existing and new leaves", async () => {
    const { root, outside } = await fixtureVault();
    await symlink(outside, path.join(root, "linked-outside"));
    const broker = createBroker();
    const session = await broker.openSession(sender, root);

    await expect(broker.read(sender, session.sessionId, "../outside/secret.md")).rejects.toMatchObject({
      code: "vault-path-invalid",
    });
    await expect(broker.read(sender, session.sessionId, "linked-outside/secret.md")).rejects.toMatchObject({
      code: "vault-path-escape",
    });
    await expect(broker.write(sender, session.sessionId, "linked-outside/new.md", "nope")).rejects.toMatchObject({
      code: "vault-path-escape",
    });
  });

  it("rejects a read when the authorized leaf is swapped to an outside symlink before open", async () => {
    const { root, outside } = await fixtureVault();
    const target = await realpath(path.join(root, "Notes", "A.md"));
    let leafStats = 0;
    const broker = createBroker({
      lstatPath: (async (...args: Parameters<typeof lstat>) => {
        const info = await lstat(...args);
        if (path.resolve(args[0].toString()) === target && ++leafStats === 2) {
          await unlink(target);
          await symlink(path.join(outside, "secret.md"), target);
        }
        return info;
      }) as typeof lstat,
    });
    const session = await broker.openSession(sender, root);

    await expect(broker.read(sender, session.sessionId, "Notes/A.md"))
      .rejects.toMatchObject({ code: "vault-path-escape" });
    expect(leafStats).toBe(2);
    await expect(readFile(path.join(outside, "secret.md"), "utf8")).resolves.toBe("secret");
  });

  it("rejects a write when its authorized parent is swapped to an outside symlink", async () => {
    const { root, outside } = await fixtureVault();
    const notes = path.join(root, "Notes");
    const movedNotes = path.join(root, "Notes.authorized");
    const canonicalNotes = await realpath(notes);
    let notesRealpaths = 0;
    const broker = createBroker({
      realpathPath: (async (target) => {
        const resolvedTarget = path.resolve(target.toString());
        const result = await realpath(target);
        if (resolvedTarget === canonicalNotes && ++notesRealpaths === 3) {
          await rename(notes, movedNotes);
          await symlink(outside, notes);
        }
        return result;
      }) as typeof realpath,
    });
    const session = await broker.openSession(sender, root);

    await expect(broker.write(sender, session.sessionId, "Notes/new.md", "escape"))
      .rejects.toMatchObject({ code: "vault-path-escape" });
    expect(notesRealpaths).toBe(3);
    await expect(readFile(path.join(outside, "new.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(movedNotes, "A.md"), "utf8")).resolves.toBe("alpha");
  });

  it("rejects a write when the authorized leaf is swapped to an outside symlink", async () => {
    const { root, outside } = await fixtureVault();
    const target = await realpath(path.join(root, "Notes", "A.md"));
    let leafStats = 0;
    const broker = createBroker({
      lstatPath: (async (...args: Parameters<typeof lstat>) => {
        const info = await lstat(...args);
        if (path.resolve(args[0].toString()) === target && ++leafStats === 2) {
          await unlink(target);
          await symlink(path.join(outside, "secret.md"), target);
        }
        return info;
      }) as typeof lstat,
    });
    const session = await broker.openSession(sender, root);

    await expect(broker.write(sender, session.sessionId, "Notes/A.md", "escape"))
      .rejects.toMatchObject({ code: "vault-path-escape" });
    expect(leafStats).toBe(3);
    await expect(readFile(path.join(outside, "secret.md"), "utf8")).resolves.toBe("secret");
  });

  it("rejects rename when its authorized source leaf is swapped to an outside symlink", async () => {
    const { root, outside } = await fixtureVault();
    const source = await realpath(path.join(root, "Notes", "A.md"));
    let sourceStats = 0;
    const broker = createBroker({
      lstatPath: (async (...args: Parameters<typeof lstat>) => {
        const info = await lstat(...args);
        if (path.resolve(args[0].toString()) === source && ++sourceStats === 2) {
          await unlink(source);
          await symlink(path.join(outside, "secret.md"), source);
        }
        return info;
      }) as typeof lstat,
    });
    const session = await broker.openSession(sender, root);

    await expect(broker.rename(sender, session.sessionId, "Notes/A.md", "Notes/B.md"))
      .rejects.toMatchObject({ code: "vault-path-escape" });
    expect(sourceStats).toBe(3);
    await expect(readFile(path.join(outside, "secret.md"), "utf8")).resolves.toBe("secret");
    await expect(lstat(path.join(root, "Notes", "B.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects trash when its authorized leaf is swapped and never invokes the provider", async () => {
    const { root, outside } = await fixtureVault();
    const source = await realpath(path.join(root, "Notes", "A.md"));
    let sourceStats = 0;
    const trashItem = vi.fn(async (_absolutePath: string) => undefined);
    const broker = createBroker({
      trashItem,
      lstatPath: (async (...args: Parameters<typeof lstat>) => {
        const info = await lstat(...args);
        if (path.resolve(args[0].toString()) === source && ++sourceStats === 2) {
          await unlink(source);
          await symlink(path.join(outside, "secret.md"), source);
        }
        return info;
      }) as typeof lstat,
    });
    const session = await broker.openSession(sender, root);

    await expect(broker.trash(sender, session.sessionId, "Notes/A.md"))
      .rejects.toMatchObject({ code: "vault-path-escape" });
    expect(sourceStats).toBe(3);
    expect(trashItem).not.toHaveBeenCalled();
    await expect(readFile(path.join(outside, "secret.md"), "utf8")).resolves.toBe("secret");
  });

  it("rejects trash when its parent is swapped after authorization", async () => {
    const { root, outside } = await fixtureVault();
    const notes = path.join(root, "Notes");
    const movedNotes = path.join(root, "Notes.authorized");
    const canonicalNotes = await realpath(notes);
    let notesRealpaths = 0;
    const trashItem = vi.fn(async (_absolutePath: string) => undefined);
    const broker = createBroker({
      trashItem,
      realpathPath: (async (target) => {
        const resolvedTarget = path.resolve(target.toString());
        const result = await realpath(target);
        if (resolvedTarget === canonicalNotes && ++notesRealpaths === 3) {
          await rename(notes, movedNotes);
          await symlink(outside, notes);
        }
        return result;
      }) as typeof realpath,
    });
    const session = await broker.openSession(sender, root);

    await expect(broker.trash(sender, session.sessionId, "Notes/A.md"))
      .rejects.toMatchObject({ code: "vault-path-escape" });
    expect(notesRealpaths).toBe(3);
    expect(trashItem).not.toHaveBeenCalled();
    await expect(readFile(path.join(movedNotes, "A.md"), "utf8")).resolves.toBe("alpha");
    await expect(readFile(path.join(outside, "secret.md"), "utf8")).resolves.toBe("secret");
  });

  it("performs atomic writes and rejects stale expected versions", async () => {
    const { root } = await fixtureVault();
    const events: PluginVaultChangeEvent[] = [];
    const broker = createBroker({ events });
    const session = await broker.openSession(sender, root);
    const initial = await broker.read(sender, session.sessionId, "Notes/A.md");

    const changed = await broker.write(sender, session.sessionId, "Notes/A.md", "beta", {
      expectedVersion: initial.version,
    });
    expect(await readFile(path.join(root, "Notes", "A.md"), "utf8")).toBe("beta");
    expect(changed.version).not.toBe(initial.version);
    await expect(broker.write(sender, session.sessionId, "Notes/A.md", "stale", {
      expectedVersion: initial.version,
    })).rejects.toMatchObject({ code: "vault-version-conflict" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ origin: "host", operationId: "operation-1" });
  });

  it("coalesces the watcher echo for a host write but reports later external changes", async () => {
    const { root } = await fixtureVault();
    const events: PluginVaultChangeEvent[] = [];
    const watcher = watchHarness();
    const broker = createBroker({ events, watch: watcher });
    const session = await broker.openSession(sender, root);
    await broker.write(sender, session.sessionId, "Notes/A.md", "beta");

    watcher.callbacks[0]("change", "Notes/A.md");
    await Promise.resolve();
    expect(events).toHaveLength(1);

    await writeFile(path.join(root, "Notes", "A.md"), "external");
    watcher.callbacks[0]("change", "Notes/A.md");
    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(events[1]).toMatchObject({ origin: "external", kind: "modify", path: "Notes/A.md" });
  });

  it("coalesces atomic-write temp and repeated target watcher events without hiding a new version", async () => {
    const { root } = await fixtureVault();
    const events: PluginVaultChangeEvent[] = [];
    const watcher = watchHarness();
    const broker = createBroker({ events, watch: watcher });
    const session = await broker.openSession(sender, root);
    await broker.write(sender, session.sessionId, "Notes/A.md", "beta");

    watcher.callbacks[0]("rename", "Notes/.A.md.11111111-1111-4111-8111-111111111111.tmp");
    watcher.callbacks[0]("change", "Notes/.A.md.11111111-1111-4111-8111-111111111111.tmp");
    watcher.callbacks[0]("rename", "Notes/A.md");
    watcher.callbacks[0]("change", "Notes/A.md");
    await vi.waitFor(() => expect(events).toHaveLength(1));

    await writeFile(path.join(root, "Notes", "A.md"), "external");
    watcher.callbacks[0]("change", "Notes/A.md");
    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(events[1]).toMatchObject({ origin: "external", kind: "modify", path: "Notes/A.md" });
  });

  it("preserves external rename identity instead of degrading it to a rescan", async () => {
    const { root } = await fixtureVault();
    const events: PluginVaultChangeEvent[] = [];
    const watcher = watchHarness();
    const broker = createBroker({ events, watch: watcher });
    await broker.openSession(sender, root);

    await rename(path.join(root, "Notes", "A.md"), path.join(root, "Notes", "B.md"));
    watcher.callbacks[0]("rename", "Notes/A.md");

    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({
      origin: "external",
      kind: "rename",
      oldPath: "Notes/A.md",
      path: "Notes/B.md",
    });
  });

  it("commits only a live sender-owned session", async () => {
    const { root } = await fixtureVault();
    const broker = createBroker();
    const session = await broker.openSession(sender, root);

    expect(broker.commitSession(sender, session.sessionId)).toEqual({ root });
    expect(() => broker.commitSession(otherSender, session.sessionId))
      .toThrowError(expect.objectContaining({ code: "vault-session-invalid" }));
    broker.closeSession(sender, session.sessionId);
    expect(() => broker.commitSession(sender, session.sessionId))
      .toThrowError(expect.objectContaining({ code: "vault-session-invalid" }));
  });

  it("does not emit delete success when trash fails and closes all sender resources", async () => {
    const { root } = await fixtureVault();
    const events: PluginVaultChangeEvent[] = [];
    const watcher = watchHarness();
    const broker = createBroker({
      events,
      watch: watcher,
      trashItem: async () => { throw new Error("trash unavailable"); },
    });
    const session = await broker.openSession(sender, root);
    await broker.createResourceUrl(sender, session.sessionId, "Notes/A.md");

    await expect(broker.trash(sender, session.sessionId, "Notes/A.md")).rejects.toThrow("trash unavailable");
    await expect(readFile(path.join(root, "Notes", "A.md"), "utf8")).resolves.toBe("alpha");
    expect(events).toHaveLength(0);
    expect(broker.activeSessionCount()).toBe(1);
    broker.closeSender(sender.id);
    expect(broker.activeSessionCount()).toBe(0);
    expect(watcher.closed).toHaveBeenCalledOnce();
  });

  it("isolates the authorized inode before invoking recoverable trash", async () => {
    const { root } = await fixtureVault();
    let trashedPath = "";
    const trashItem = vi.fn(async (absolutePath: string) => {
      trashedPath = absolutePath;
      expect(path.basename(absolutePath)).toMatch(/^\.nexus-trash-[a-f0-9-]+-A\.md$/i);
      await expect(readFile(absolutePath, "utf8")).resolves.toBe("alpha");
      await unlink(absolutePath);
    });
    const broker = createBroker({ trashItem });
    const session = await broker.openSession(sender, root);

    await expect(broker.trash(sender, session.sessionId, "Notes/A.md")).resolves.toMatchObject({
      path: "Notes/A.md",
      recoverable: true,
    });
    expect(trashItem).toHaveBeenCalledOnce();
    expect(path.dirname(trashedPath)).toBe(await realpath(path.join(root, "Notes")));
    await expect(lstat(path.join(root, "Notes", "A.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reads an opaque resource URL through a verified handle and revokes it within its owning session", async () => {
    const { root } = await fixtureVault();
    const broker = createBroker({ events: [], watch: watchHarness() });
    const session = await broker.openSession(sender, root);
    const resource = await broker.createResourceUrl(sender, session.sessionId, "Notes/A.md");
    const [, sessionCapability, token] = new URL(resource.url).pathname.split("/");

    const resolved = await broker.readResource(sender.id, sessionCapability, token);
    expect(resolved?.path).toBe(await realpath(path.join(root, "Notes", "A.md")));
    expect(Buffer.from(resolved?.content ?? []).toString("utf8")).toBe("alpha");
    broker.revokeResourceUrl(sender, session.sessionId, resource.registrationId);
    await expect(broker.readResource(sender.id, sessionCapability, token)).resolves.toBeNull();
    expect(() => broker.revokeResourceUrl(sender, session.sessionId, resource.registrationId))
      .toThrow(/missing or belongs/);
  });

  it("opens resource files nonblocking and compares bigint file identities", async () => {
    const { root } = await fixtureVault();
    let openedFlags = 0;
    let handleStatOptions: unknown;
    let pathStatOptions: unknown;
    const statWithOptions = (async (...args: Parameters<typeof stat>) => {
      if (args.length > 1) pathStatOptions = args[1];
      return stat(...args);
    }) as typeof stat;
    const openWithOptions = (async (
      file: Parameters<typeof open>[0],
      flags: Parameters<typeof open>[1],
      mode?: Parameters<typeof open>[2],
    ) => {
      openedFlags = flags as number;
      const handle = await open(file, flags, mode);
      return {
        stat: (options?: Parameters<typeof handle.stat>[0]) => {
          handleStatOptions = options;
          return handle.stat(options as { bigint: true });
        },
        readFile: handle.readFile.bind(handle),
        close: handle.close.bind(handle),
      } as unknown as Awaited<ReturnType<typeof open>>;
    }) as typeof open;
    const broker = createBroker({
      events: [],
      watch: watchHarness(),
      statPath: statWithOptions,
      openPath: openWithOptions,
    });
    const session = await broker.openSession(sender, root);
    const resource = await broker.createResourceUrl(sender, session.sessionId, "Notes/A.md");
    const [, sessionCapability, token] = new URL(resource.url).pathname.split("/");

    await expect(broker.readResource(sender.id, sessionCapability, token)).resolves.not.toBeNull();
    expect(openedFlags & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
    if (constants.O_NOFOLLOW !== undefined) {
      expect(openedFlags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
    }
    expect(handleStatOptions).toEqual({ bigint: true });
    expect(pathStatOptions).toEqual({ bigint: true });
  });

  it("does not publish a resource token when its session closes during path validation", async () => {
    const { root } = await fixtureVault();
    const waitingRealpath = deferred<string>();
    const resourcePath = path.join(root, "Notes", "A.md");
    const broker = createBroker({
      events: [],
      watch: watchHarness(),
      realpathPath: (async (target) =>
        path.resolve(target.toString()) === resourcePath
          ? waitingRealpath.promise
          : realpath(target)) as typeof realpath,
    });
    const session = await broker.openSession(sender, root);

    const creating = broker.createResourceUrl(sender, session.sessionId, "Notes/A.md");
    broker.closeSession(sender, session.sessionId);
    waitingRealpath.resolve(await realpath(resourcePath));

    await expect(creating).rejects.toMatchObject({ code: "vault-session-invalid" });
    expect((broker as unknown as { resources: Map<string, unknown> }).resources.size).toBe(0);
  });

  it("does not publish a resource token when its sender closes during path validation", async () => {
    const { root } = await fixtureVault();
    const waitingRealpath = deferred<string>();
    const resourcePath = path.join(root, "Notes", "A.md");
    const broker = createBroker({
      events: [],
      watch: watchHarness(),
      realpathPath: (async (target) =>
        path.resolve(target.toString()) === resourcePath
          ? waitingRealpath.promise
          : realpath(target)) as typeof realpath,
    });
    const session = await broker.openSession(sender, root);

    const creating = broker.createResourceUrl(sender, session.sessionId, "Notes/A.md");
    broker.closeSender(sender.id);
    waitingRealpath.resolve(await realpath(resourcePath));

    await expect(creating).rejects.toMatchObject({ code: "sender-not-authorized" });
    expect((broker as unknown as { resources: Map<string, unknown> }).resources.size).toBe(0);
  });

  it("binds resource URLs to their sender and revokes them with the Vault session", async () => {
    const { root } = await fixtureVault();
    const broker = createBroker({ events: [], watch: watchHarness() });
    const session = await broker.openSession(sender, root);
    const resource = await broker.createResourceUrl(sender, session.sessionId, "Notes/A.md");
    const [, sessionCapability, token] = new URL(resource.url).pathname.split("/");

    await expect(broker.readResource(sender.id, sessionCapability, token))
      .resolves.toMatchObject({ path: await realpath(path.join(root, "Notes", "A.md")) });
    await expect(broker.readResource(otherSender.id, sessionCapability, token)).resolves.toBeNull();
    broker.closeSession(sender, session.sessionId);
    await expect(broker.readResource(sender.id, sessionCapability, token)).resolves.toBeNull();
  });

  it("does not let another Vault session revoke or resolve an existing resource registration", async () => {
    const { root } = await fixtureVault();
    const broker = createBroker({ events: [], watch: watchHarness() });
    const first = await broker.openSession(sender, root);
    const second = await broker.openSession(sender, root);
    const resource = await broker.createResourceUrl(sender, first.sessionId, "Notes/A.md");
    const secondResource = await broker.createResourceUrl(sender, second.sessionId, "Notes/A.md");
    const [, firstCapability, firstToken] = new URL(resource.url).pathname.split("/");
    const [, secondCapability, secondToken] = new URL(secondResource.url).pathname.split("/");

    expect(() => broker.revokeResourceUrl(sender, second.sessionId, resource.registrationId))
      .toThrowError(expect.objectContaining({ code: "vault-session-invalid" }));
    await expect(broker.readResource(sender.id, firstCapability, firstToken)).resolves.not.toBeNull();
    await expect(broker.readResource(sender.id, secondCapability, firstToken)).resolves.toBeNull();
    await expect(broker.readResource(sender.id, firstCapability, secondToken)).resolves.toBeNull();
    broker.closeSender(sender.id);
    await expect(broker.readResource(sender.id, firstCapability, firstToken)).resolves.toBeNull();
  });

  it("revalidates a resource path after a symlink swap", async () => {
    const { root, outside } = await fixtureVault();
    const broker = createBroker({ events: [], watch: watchHarness() });
    const session = await broker.openSession(sender, root);
    const resource = await broker.createResourceUrl(sender, session.sessionId, "Notes/A.md");
    const [, sessionCapability, token] = new URL(resource.url).pathname.split("/");

    await unlink(path.join(root, "Notes", "A.md"));
    await symlink(path.join(outside, "secret.md"), path.join(root, "Notes", "A.md"));

    await expect(broker.readResource(sender.id, sessionCapability, token)).resolves.toBeNull();
  });

  it("reads an in-vault symlink resource through its canonical target", async () => {
    const { root } = await fixtureVault();
    await symlink(path.join(root, "Notes", "A.md"), path.join(root, "alias.md"));
    const broker = createBroker({ events: [], watch: watchHarness() });
    const session = await broker.openSession(sender, root);
    const resource = await broker.createResourceUrl(sender, session.sessionId, "alias.md");
    const [, sessionCapability, token] = new URL(resource.url).pathname.split("/");

    const resolved = await broker.readResource(sender.id, sessionCapability, token);
    expect(resolved?.path).toBe(await realpath(path.join(root, "Notes", "A.md")));
    expect(Buffer.from(resolved?.content ?? []).toString("utf8")).toBe("alpha");
  });

  it("treats revocation during resource resolution as a barrier", async () => {
    const { root } = await fixtureVault();
    const resourcePath = path.join(root, "Notes", "A.md");
    const waitingRealpath = deferred<string>();
    let resourceRealpathCalls = 0;
    const broker = createBroker({
      events: [],
      watch: watchHarness(),
      realpathPath: (async (target) => {
        if (path.resolve(target.toString()) === resourcePath && ++resourceRealpathCalls === 3) {
          return waitingRealpath.promise;
        }
        return realpath(target);
      }) as typeof realpath,
    });
    const session = await broker.openSession(sender, root);
    const resource = await broker.createResourceUrl(sender, session.sessionId, "Notes/A.md");
    const [, sessionCapability, token] = new URL(resource.url).pathname.split("/");

    const reading = broker.readResource(sender.id, sessionCapability, token);
    await vi.waitFor(() => expect(resourceRealpathCalls).toBe(3));
    broker.revokeResourceUrl(sender, session.sessionId, resource.registrationId);
    waitingRealpath.resolve(await realpath(resourcePath));

    await expect(reading).resolves.toBeNull();
  });

  it("treats revocation during handle reads as a return barrier", async () => {
    const { root } = await fixtureVault();
    const waitingRead = deferred<Buffer>();
    const readStarted = deferred<void>();
    const openWithDeferredRead = (async (
      file: Parameters<typeof open>[0],
      flags: Parameters<typeof open>[1],
      mode?: Parameters<typeof open>[2],
    ) => {
      const handle = await open(file, flags, mode);
      return {
        stat: handle.stat.bind(handle),
        readFile: () => {
          readStarted.resolve();
          return waitingRead.promise;
        },
        close: handle.close.bind(handle),
      } as unknown as Awaited<ReturnType<typeof open>>;
    }) as typeof open;
    const broker = createBroker({ events: [], watch: watchHarness(), openPath: openWithDeferredRead });
    const session = await broker.openSession(sender, root);
    const resource = await broker.createResourceUrl(sender, session.sessionId, "Notes/A.md");
    const [, sessionCapability, token] = new URL(resource.url).pathname.split("/");

    const reading = broker.readResource(sender.id, sessionCapability, token);
    await readStarted.promise;
    broker.revokeResourceUrl(sender, session.sessionId, resource.registrationId);
    waitingRead.resolve(Buffer.from("alpha"));

    await expect(reading).resolves.toBeNull();
  });

  it("treats sender close during handle reads as a return barrier", async () => {
    const { root } = await fixtureVault();
    const waitingRead = deferred<Buffer>();
    const readStarted = deferred<void>();
    const openWithDeferredRead = (async (
      file: Parameters<typeof open>[0],
      flags: Parameters<typeof open>[1],
      mode?: Parameters<typeof open>[2],
    ) => {
      const handle = await open(file, flags, mode);
      return {
        stat: handle.stat.bind(handle),
        readFile: () => {
          readStarted.resolve();
          return waitingRead.promise;
        },
        close: handle.close.bind(handle),
      } as unknown as Awaited<ReturnType<typeof open>>;
    }) as typeof open;
    const broker = createBroker({ events: [], watch: watchHarness(), openPath: openWithDeferredRead });
    const session = await broker.openSession(sender, root);
    const resource = await broker.createResourceUrl(sender, session.sessionId, "Notes/A.md");
    const [, sessionCapability, token] = new URL(resource.url).pathname.split("/");

    const reading = broker.readResource(sender.id, sessionCapability, token);
    await readStarted.promise;
    broker.closeSender(sender.id);
    waitingRead.resolve(Buffer.from("alpha"));

    await expect(reading).resolves.toBeNull();
  });

  it("rejects a resource whose path is replaced after the file handle opens", async () => {
    const { root } = await fixtureVault();
    const absolutePath = path.join(root, "Notes", "A.md");
    const movedPath = path.join(root, "Notes", "A.opened.md");
    let swapped = false;
    const openWithSwap = (async (
      file: Parameters<typeof open>[0],
      flags: Parameters<typeof open>[1],
      mode?: Parameters<typeof open>[2],
    ) => {
      const handle = await open(file, flags, mode);
      await rename(absolutePath, movedPath);
      await writeFile(absolutePath, "replacement");
      swapped = true;
      return handle;
    }) as typeof open;
    const broker = createBroker({
      events: [],
      watch: watchHarness(),
      openPath: openWithSwap,
    });
    const session = await broker.openSession(sender, root);
    const resource = await broker.createResourceUrl(sender, session.sessionId, "Notes/A.md");
    const [, sessionCapability, token] = new URL(resource.url).pathname.split("/");

    await expect(broker.readResource(sender.id, sessionCapability, token)).resolves.toBeNull();
    expect(swapped).toBe(true);
    await expect(readFile(absolutePath, "utf8")).resolves.toBe("replacement");
  });
});

describe("ElectronPluginStorageBroker", () => {
  it("partitions data, serializes writes, and restores it in a new broker", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nexus-storage-"));
    const first = new ElectronPluginStorageBroker(root);

    await expect(first.save("plugin.one", 0, { count: 1 })).resolves.toEqual({ ok: true, revision: 1 });
    await expect(first.save("plugin.two", 0, { count: 20 })).resolves.toEqual({ ok: true, revision: 1 });
    await expect(first.save("plugin.one", 0, { count: 2 })).resolves.toEqual({ ok: false, revision: 1 });
    await first.drain();

    const restarted = new ElectronPluginStorageBroker(root);
    await expect(restarted.load("plugin.one")).resolves.toEqual({
      found: true,
      revision: 1,
      data: { count: 1 },
    });
    await expect(restarted.load("plugin.two")).resolves.toEqual({
      found: true,
      revision: 1,
      data: { count: 20 },
    });
  });

  it("rejects path-like IDs and quarantines corrupt data", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nexus-storage-corrupt-"));
    const broker = new ElectronPluginStorageBroker(root, () => 123);
    expect(() => broker.save("../escape", 0, {})).toThrowError(
      expect.objectContaining({ code: "plugin-id-invalid" }),
    );

    await mkdir(path.join(root, "fixture"), { recursive: true });
    await writeFile(path.join(root, "fixture", "data.json"), "{broken");
    await expect(broker.load("fixture")).resolves.toEqual({ found: false, revision: 0, data: null });
    expect(await readFile(path.join(root, "fixture", "data.json.corrupt-123"), "utf8")).toBe("{broken");
  });
});
