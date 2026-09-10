import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MemoryDocumentVersionStore,
  type AppendDocumentVersion,
  type AppendDocumentVersionResult,
  type DocumentHistorySnapshot,
} from "@floatboat/nexus-document-history";
import type { DocumentTextFormat } from "@floatboat/nexus-text-codec";
import { withFileWriteLock } from "./file-write-lock";
import { PUBLIC_DOCUMENT_HISTORY_POLICY } from "../src/shared/public-capabilities-policy";

const MAX_BYTES = 500 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = 80 * 1024 * 1024;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface RawVersion {
  readonly bytes: string;
  readonly format: DocumentTextFormat;
  readonly byteVersion: string;
}
interface HistoryEnvelope {
  readonly schemaVersion: 1;
  readonly snapshot: DocumentHistorySnapshot;
  readonly raw: Readonly<Record<string, RawVersion>>;
}

/** Opt-in host storage: expiry/count pruning is explicit here, never inside the public store. */
export class PublicDocumentHistory {
  constructor(private readonly root: string, private readonly now: () => number = Date.now) {}

  async read(documentKey: string): Promise<{ readonly snapshot: DocumentHistorySnapshot; readonly head: string | null }> {
    const envelope = await this.load(documentKey);
    const store = this.store(envelope.snapshot);
    return { snapshot: store.exportSnapshot(), head: (await store.list(documentKey, { limit: 1 })).head };
  }

  async append(
    documentKey: string,
    record: AppendDocumentVersion,
    expectedHead?: string | null,
    raw?: { readonly bytes: Uint8Array; readonly format: DocumentTextFormat },
    onlyIfEmpty = false,
  ): Promise<AppendDocumentVersionResult> {
    const target = this.target(documentKey);
    return withFileWriteLock(path.join(this.root, "history-quota"), async () => {
      const envelope = await this.load(documentKey);
      const previous = this.store(envelope.snapshot);
      const head = (await previous.list(documentKey, { limit: 1 })).head;
      if ((expectedHead !== undefined && expectedHead !== head) || (onlyIfEmpty && head !== null)) {
        return { status: "conflict", currentHead: head };
      }
      const recent = envelope.snapshot.versions
        .filter((version) => version.createdAt >= this.now() - MAX_AGE_MS)
        .slice(-(PUBLIC_DOCUMENT_HISTORY_POLICY.maxVersionsPerDocument - 1));
      const store = this.store({ schemaVersion: 1, versions: recent });
      const result = await store.append(documentKey, record);
      if (result.status !== "appended") return result;
      // The memory reference store can reuse pruned numeric IDs after hydration.
      // Persistent host identities must never point an old selection at a newer record.
      const appended = Object.freeze({ ...result.version, id: randomUUID() });
      const snapshot: DocumentHistorySnapshot = {
        schemaVersion: 1,
        versions: store.exportSnapshot().versions.map((version) => version.id === result.version.id ? appended : version),
      };
      const ids = new Set(snapshot.versions.map((version) => version.id));
      const savedRaw = Object.fromEntries(Object.entries(envelope.raw).filter(([id]) => ids.has(id)));
      if (raw) savedRaw[appended.id] = {
        bytes: Buffer.from(raw.bytes).toString("base64"),
        format: { ...raw.format },
        byteVersion: createHash("sha256").update(raw.bytes).digest("hex"),
      };
      const encoded = JSON.stringify({ schemaVersion: 1, snapshot, raw: savedRaw } satisfies HistoryEnvelope);
      const bytes = Buffer.byteLength(encoded);
      if (bytes > MAX_ENVELOPE_BYTES) throw new Error("History document storage quota exceeded");
      await mkdir(this.root, { recursive: true });
      let total = bytes;
      for (const name of await readdir(this.root)) {
        if (!/^[a-f0-9]{64}\.json$/.test(name) || path.join(this.root, name) === target) continue;
        total += (await stat(path.join(this.root, name))).size;
      }
      if (total > MAX_BYTES) throw new Error("History storage reached its 500 MiB limit");
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, encoded, { flag: "wx", mode: 0o600 });
        await rename(temporary, target);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
      return { status: "appended", version: appended };
    });
  }

  private store(snapshot: DocumentHistorySnapshot): MemoryDocumentVersionStore {
    return new MemoryDocumentVersionStore({
      ...PUBLIC_DOCUMENT_HISTORY_POLICY,
      now: this.now, snapshot,
    });
  }

  private target(documentKey: string): string {
    if (!/^[a-f0-9]{64}$/.test(documentKey)) throw new Error("Invalid history document identity");
    return path.join(this.root, `${documentKey}.json`);
  }

  private async load(documentKey: string): Promise<HistoryEnvelope> {
    const target = this.target(documentKey);
    let source: string;
    try {
      if ((await stat(target)).size > MAX_ENVELOPE_BYTES) throw new Error("History file exceeds its size limit");
      source = await readFile(target, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, snapshot: { schemaVersion: 1, versions: [] }, raw: {} };
      throw error;
    }
    const value: unknown = JSON.parse(source);
    if (!value || typeof value !== "object" || !("schemaVersion" in value) || value.schemaVersion !== 1 ||
      !("snapshot" in value) || !("raw" in value) || !value.raw || typeof value.raw !== "object" || Array.isArray(value.raw)) {
      throw new Error("Unsupported history file; existing data was not overwritten");
    }
    const store = new MemoryDocumentVersionStore({
      ...PUBLIC_DOCUMENT_HISTORY_POLICY,
      snapshot: value.snapshot,
    });
    const snapshot = store.exportSnapshot();
    if (snapshot.versions.some((version) => version.documentKey !== documentKey)) throw new Error("History belongs to another document");
    return {
      schemaVersion: 1,
      snapshot: { schemaVersion: 1, versions: snapshot.versions.filter((version) => version.createdAt >= this.now() - MAX_AGE_MS) },
      raw: value.raw as Record<string, RawVersion>,
    };
  }
}
