import { existsSync } from "node:fs";
import path from "node:path";

import type { VaultSessionId } from "../src/shared/plugin-ipc";
import {
  ElectronVaultBroker,
  PluginHostBrokerError,
  type SenderIdentity,
  type VaultBrokerOptions,
} from "./plugin-host-broker";

export interface LegacyVaultNode {
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly children?: readonly LegacyVaultNode[];
}

interface LegacyVaultSession {
  readonly id: VaultSessionId;
  readonly root: string;
}

export interface LegacyVaultBrokerOptions extends Omit<VaultBrokerOptions, "onChange"> {
  readonly onLegacyChange?: (senderId: number, root: string) => void;
}

/** Adapts the legacy absolute-path API to the hardened relative-path Vault broker. */
export class LegacyVaultBroker {
  private readonly broker: ElectronVaultBroker;
  private readonly sessions = new Map<number, LegacyVaultSession>();
  private readonly onLegacyChange?: LegacyVaultBrokerOptions["onLegacyChange"];

  constructor(options: LegacyVaultBrokerOptions) {
    this.onLegacyChange = options.onLegacyChange;
    this.broker = new ElectronVaultBroker({
      ...options,
      onChange: (senderId) => {
        const session = this.sessions.get(senderId);
        if (session) this.onLegacyChange?.(senderId, session.root);
      },
    });
  }

  async open(sender: SenderIdentity, root: string): Promise<readonly LegacyVaultNode[]> {
    const previous = this.sessions.get(sender.id);
    const absoluteRoot = path.resolve(root);
    const opened = await this.broker.openSession(sender, absoluteRoot);
    this.broker.commitSession(sender, opened.sessionId);
    if (previous) this.broker.closeSession(sender, previous.id);
    this.sessions.set(sender.id, { id: opened.sessionId, root: absoluteRoot });
    return this.list(sender);
  }

  async list(sender: SenderIdentity): Promise<readonly LegacyVaultNode[]> {
    const session = this.requireSession(sender);
    const nodes = await this.broker.list(sender, session.id);
    const mapNode = (node: (typeof nodes)[number]): LegacyVaultNode | null => {
      const children = node.children?.map(mapNode).filter((child) => child !== null);
      if (node.kind === "folder" && children?.length === 0) return null;
      return Object.freeze({
        name: node.name,
        path: this.absolutePath(session, node.path),
        kind: node.kind === "folder" ? "directory" : "file",
        ...(children ? { children: Object.freeze(children) } : {}),
      });
    };
    return Object.freeze(nodes.map(mapNode).filter((node) => node !== null));
  }

  async read(sender: SenderIdentity, absolutePath: string): Promise<{ path: string; content: string }> {
    const session = this.requireSession(sender);
    const relativePath = this.relativePath(session, absolutePath);
    const file = await this.broker.read(sender, session.id, relativePath);
    return { path: this.absolutePath(session, file.path), content: file.content };
  }

  async readAll(sender: SenderIdentity): Promise<readonly { path: string; content: string }[]> {
    const session = this.requireSession(sender);
    const files = await this.broker.readAll(sender, session.id);
    return Object.freeze(files.map((file) => Object.freeze({
      path: this.absolutePath(session, file.path),
      content: file.content,
    })));
  }

  async write(sender: SenderIdentity, absolutePath: string, content: string): Promise<{ path: string }> {
    const session = this.requireSession(sender);
    const relativePath = this.relativePath(session, absolutePath);
    const mutation = await this.broker.write(sender, session.id, relativePath, content);
    return { path: this.absolutePath(session, mutation.path) };
  }

  async createFile(sender: SenderIdentity, parentDir: string, name: string): Promise<{ path: string }> {
    const session = this.requireSession(sender);
    const safeInput = name.trim() || "untitled";
    const segments = safeInput.replace(/\\/g, "/").split("/").filter(Boolean);
    if (segments.length === 0) {
      throw new PluginHostBrokerError("vault-path-invalid", "Invalid file name.");
    }
    const baseNameRaw = segments.pop()!;
    const parentPath = this.relativePath(session, parentDir);
    const hasExtension = [".md", ".markdown", ".txt"].includes(path.extname(baseNameRaw).toLowerCase());
    const baseName = hasExtension ? baseNameRaw : `${baseNameRaw}.md`;
    const extension = path.extname(baseName);
    const stem = baseName.slice(0, baseName.length - extension.length);
    const subdirectory = segments.join("/");
    const targetParent = [parentPath, subdirectory].filter(Boolean).join("/");
    if (subdirectory) await this.ensureFolders(sender, session, parentPath, segments);

    let candidate = [targetParent, baseName].filter(Boolean).join("/");
    let suffix = 1;
    while (existsSync(this.absolutePath(session, candidate))) {
      candidate = [targetParent, `${stem}-${suffix}${extension}`].filter(Boolean).join("/");
      suffix += 1;
    }
    const mutation = await this.broker.write(sender, session.id, candidate, "");
    return { path: this.absolutePath(session, mutation.path) };
  }

  async createFolder(sender: SenderIdentity, parentDir: string, name: string): Promise<{ path: string }> {
    const session = this.requireSession(sender);
    const safeName = name.trim() || "new-folder";
    const relativePath = [this.relativePath(session, parentDir), safeName].filter(Boolean).join("/");
    const mutation = await this.broker.createFolder(sender, session.id, relativePath);
    return { path: this.absolutePath(session, mutation.path) };
  }

  async rename(sender: SenderIdentity, oldPath: string, newName: string): Promise<{ path: string }> {
    const session = this.requireSession(sender);
    const trimmed = newName.trim();
    if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) {
      throw new PluginHostBrokerError("vault-path-invalid", "New name is invalid.");
    }
    const source = this.relativePath(session, oldPath);
    const destination = path.posix.join(path.posix.dirname(source), trimmed);
    if (destination !== source && existsSync(this.absolutePath(session, destination))) {
      throw new PluginHostBrokerError("vault-path-invalid", "Rename target already exists.");
    }
    const mutation = await this.broker.rename(sender, session.id, source, destination);
    return { path: this.absolutePath(session, mutation.path) };
  }

  async trash(sender: SenderIdentity, absolutePath: string): Promise<{ ok: true }> {
    const session = this.requireSession(sender);
    await this.broker.trash(sender, session.id, this.relativePath(session, absolutePath));
    return { ok: true };
  }

  closeSender(senderId: number): void {
    this.sessions.delete(senderId);
    this.broker.closeSender(senderId);
  }

  closeAll(): void {
    this.sessions.clear();
    this.broker.closeAll();
  }

  private requireSession(sender: SenderIdentity): LegacyVaultSession {
    const session = this.sessions.get(sender.id);
    if (!session) {
      throw new PluginHostBrokerError("vault-session-invalid", "No legacy Vault session is open.");
    }
    return session;
  }

  private relativePath(session: LegacyVaultSession, target: string): string {
    const absolutePath = path.resolve(target);
    const relativePath = path.relative(session.root, absolutePath);
    if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
      return relativePath.split(path.sep).join("/");
    }
    throw new PluginHostBrokerError("vault-path-escape", "Vault path escapes its authorized root.");
  }

  private absolutePath(session: LegacyVaultSession, relativePath: string): string {
    return path.join(session.root, ...relativePath.split("/"));
  }

  private async ensureFolders(
    sender: SenderIdentity,
    session: LegacyVaultSession,
    parentPath: string,
    segments: readonly string[],
  ): Promise<void> {
    let current = parentPath;
    for (const segment of segments) {
      current = [current, segment].filter(Boolean).join("/");
      if (!existsSync(this.absolutePath(session, current))) {
        await this.broker.createFolder(sender, session.id, current);
      }
    }
  }
}
