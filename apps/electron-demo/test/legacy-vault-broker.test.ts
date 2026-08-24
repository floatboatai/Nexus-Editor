// @vitest-environment node

import { mkdtemp, mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LegacyVaultBroker } from "../electron/legacy-vault-broker";
import { PluginHostBrokerError, type SenderIdentity } from "../electron/plugin-host-broker";

const sender: SenderIdentity = { id: 7, url: "app://nexus/index.html" };

async function fixtureVault(): Promise<{ root: string; outside: string }> {
  const parent = await mkdtemp(path.join(tmpdir(), "nexus-legacy-vault-"));
  const root = path.join(parent, "vault");
  const outside = path.join(parent, "outside");
  await mkdir(path.join(root, "Notes"), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(root, "Notes", "A.md"), "alpha");
  await writeFile(path.join(outside, "secret.md"), "secret");
  return { root, outside };
}

function createBroker(trashItem: (absolutePath: string) => Promise<void> = unlink): LegacyVaultBroker {
  let sessionCounter = 0;
  let operationCounter = 0;
  return new LegacyVaultBroker({
    isSenderAuthorized: (candidate) => candidate.id === sender.id,
    trashItem,
    watchFactory: () => ({ close() {} }),
    sessionId: () => `11111111-1111-4111-8111-${String(++sessionCounter).padStart(12, "0")}`,
    operationId: () => `operation-${++operationCounter}`,
  });
}

describe("LegacyVaultBroker", () => {
  it("preserves the legacy absolute-path API for authorized files", async () => {
    const { root } = await fixtureVault();
    const broker = createBroker();

    const nodes = await broker.open(sender, root);
    expect(nodes[0]).toMatchObject({
      name: "Notes",
      path: path.join(root, "Notes"),
      children: [{ name: "A.md", path: path.join(root, "Notes", "A.md") }],
    });

    const filePath = path.join(root, "Notes", "A.md");
    await expect(broker.read(sender, filePath)).resolves.toEqual({ path: filePath, content: "alpha" });
    await expect(broker.write(sender, filePath, "updated")).resolves.toEqual({ path: filePath });
    await expect(readFile(filePath, "utf8")).resolves.toBe("updated");

    const existingTarget = path.join(root, "Notes", "B.md");
    await writeFile(existingTarget, "preserved");
    await expect(broker.rename(sender, filePath, "B.md")).rejects.toBeInstanceOf(PluginHostBrokerError);
    await expect(readFile(existingTarget, "utf8")).resolves.toBe("preserved");
  });

  it("keeps the current session when opening another Vault fails", async () => {
    const { root, outside } = await fixtureVault();
    const broker = createBroker();
    await broker.open(sender, root);

    await expect(broker.open(sender, path.join(outside, "secret.md")))
      .rejects.toBeInstanceOf(PluginHostBrokerError);
    await expect(broker.read(sender, path.join(root, "Notes", "A.md")))
      .resolves.toMatchObject({ content: "alpha" });
  });

  it("rejects reads and writes through a parent symlink that escapes the Vault", async () => {
    const { root, outside } = await fixtureVault();
    await symlink(outside, path.join(root, "linked-outside"));
    const broker = createBroker();
    await broker.open(sender, root);
    const escapedPath = path.join(root, "linked-outside", "secret.md");

    await expect(broker.read(sender, escapedPath)).rejects.toBeInstanceOf(PluginHostBrokerError);
    await expect(broker.write(sender, escapedPath, "overwritten")).rejects.toBeInstanceOf(PluginHostBrokerError);
    await expect(broker.createFile(sender, path.join(root, "linked-outside"), "created.md"))
      .rejects.toBeInstanceOf(PluginHostBrokerError);
    await expect(readFile(path.join(outside, "secret.md"), "utf8")).resolves.toBe("secret");
  });

  it("rejects rename and trash when the leaf is an outside symlink", async () => {
    const { root, outside } = await fixtureVault();
    const link = path.join(root, "outside.md");
    await symlink(path.join(outside, "secret.md"), link);
    const broker = createBroker();
    await broker.open(sender, root);

    await expect(broker.rename(sender, link, "renamed.md")).rejects.toBeInstanceOf(PluginHostBrokerError);
    await expect(broker.trash(sender, link)).rejects.toBeInstanceOf(PluginHostBrokerError);
    await expect(readFile(path.join(outside, "secret.md"), "utf8")).resolves.toBe("secret");
  });
});
