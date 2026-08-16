import { existsSync } from "node:fs";
import { readFile, rename } from "node:fs/promises";

import { atomicWriteFile } from "./atomic-file";

const MAX_RECENTS = 10;

export interface VaultState {
  readonly lastVault: string | null;
  readonly recents: readonly string[];
}

interface DiskState {
  readonly state: VaultState;
  readonly canonical: boolean;
}

interface VaultStateStoreOptions {
  readonly now?: () => number;
  readonly pathExists?: (candidate: string) => boolean;
  readonly atomicWriter?: (target: string, data: string | Uint8Array) => Promise<void>;
  readonly renameFile?: (source: string, destination: string) => Promise<void>;
}

function snapshot(lastVault: string | null, recents: readonly string[]): VaultState {
  return Object.freeze({ lastVault, recents: Object.freeze([...recents]) });
}

function emptyState(): VaultState {
  return snapshot(null, []);
}

function normalizeObject(value: Record<string, unknown>): DiskState {
  const lastVault = typeof value.lastVault === "string" ? value.lastVault : null;
  const input = Array.isArray(value.recents) ? value.recents : [];
  const recents: string[] = [];
  const seen = new Set<string>();
  for (const candidate of input) {
    if (typeof candidate !== "string" || seen.has(candidate)) continue;
    seen.add(candidate);
    recents.push(candidate);
    if (recents.length === MAX_RECENTS) break;
  }
  const canonical =
    (value.lastVault === null || typeof value.lastVault === "string") &&
    Array.isArray(value.recents) &&
    value.recents.length === recents.length &&
    value.recents.every((candidate, index) => candidate === recents[index]);
  return { state: snapshot(lastVault, recents), canonical };
}

function sameState(left: VaultState, right: VaultState): boolean {
  return left.lastVault === right.lastVault &&
    left.recents.length === right.recents.length &&
    left.recents.every((candidate, index) => candidate === right.recents[index]);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export class VaultStateStore {
  private tail: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly pathExists: (candidate: string) => boolean;
  private readonly atomicWriter: (target: string, data: string | Uint8Array) => Promise<void>;
  private readonly renameFile: (source: string, destination: string) => Promise<void>;

  constructor(
    private readonly filePath: string,
    options: VaultStateStoreOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.pathExists = options.pathExists ?? existsSync;
    this.atomicWriter = options.atomicWriter ?? atomicWriteFile;
    this.renameFile = options.renameFile ?? rename;
  }

  read(): Promise<VaultState> {
    return this.enqueue(async () => (await this.readFromDisk()).state);
  }

  recordRecent(vaultPath: string): Promise<VaultState> {
    if (typeof vaultPath !== "string" || vaultPath.length === 0) {
      return Promise.reject(new TypeError("Vault path must be a non-empty string."));
    }
    return this.enqueue(async () => {
      const { state } = await this.readFromDisk();
      const recents = [vaultPath, ...state.recents.filter((entry) => entry !== vaultPath)]
        .slice(0, MAX_RECENTS);
      const next = snapshot(vaultPath, recents);
      await this.write(next);
      return next;
    });
  }

  pruneUnavailable(): Promise<VaultState> {
    return this.enqueue(async () => {
      const current = await this.readFromDisk();
      const recents = current.state.recents.filter((candidate) => this.pathExists(candidate));
      const lastVault = current.state.lastVault && this.pathExists(current.state.lastVault)
        ? current.state.lastVault
        : null;
      const next = snapshot(lastVault, recents);
      if (!current.canonical || !sameState(current.state, next)) await this.write(next);
      return next;
    });
  }

  drain(): Promise<void> {
    return this.tail;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readFromDisk(): Promise<DiskState> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return { state: emptyState(), canonical: true };
      const quarantined = await this.quarantine();
      return { state: emptyState(), canonical: quarantined };
    }

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      const quarantined = await this.quarantine();
      return { state: emptyState(), canonical: quarantined };
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      const quarantined = await this.quarantine();
      return { state: emptyState(), canonical: quarantined };
    }
    return normalizeObject(value as Record<string, unknown>);
  }

  private async quarantine(): Promise<boolean> {
    try {
      await this.renameFile(this.filePath, `${this.filePath}.corrupt-${this.now()}`);
      return true;
    } catch {
      // Recent-Vault metadata is recoverable; leave the source in place when quarantine fails.
      return false;
    }
  }

  private write(state: VaultState): Promise<void> {
    return this.atomicWriter(this.filePath, JSON.stringify(state, null, 2));
  }
}
