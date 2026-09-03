import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import type { TokenRevocationStore } from "./auth";

const SNAPSHOT_MAGIC = Buffer.from("NEXUSC1\n", "ascii");
const HEADER_SIZE = SNAPSHOT_MAGIC.byteLength + 4 + 4 + 32;
const DEFAULT_MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_ID_BYTES = 1_024;

export class DocumentStoreCorruptionError extends Error {
  constructor(
    readonly documentId: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DocumentStoreCorruptionError";
  }
}

export interface FileDocumentStore {
  fetch(documentId: string): Promise<Uint8Array | null>;
  store(documentId: string, state: Uint8Array): Promise<void>;
  ensureReady(): Promise<void>;
}

export interface FileDocumentStoreOptions {
  readonly directory: string;
  readonly maxDocumentBytes?: number;
}

function validateDirectory(directory: string): string {
  if (!directory || directory.trim() !== directory) {
    throw new TypeError("A non-empty absolute storage directory is required");
  }
  return resolve(directory);
}

function validateDocumentId(documentId: string): Buffer {
  const bytes = Buffer.from(documentId, "utf8");
  if (
    documentId.length === 0
    || documentId.trim() !== documentId
    || bytes.byteLength > MAX_DOCUMENT_ID_BYTES
    || /[\u0000-\u001f\u007f]/u.test(documentId)
  ) {
    throw new TypeError("Invalid DocumentId");
  }
  return bytes;
}

function snapshotFilename(documentId: string): string {
  return `${createHash("sha256").update(documentId, "utf8").digest("hex")}.nxc`;
}

async function ensureOwnedDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Storage path is not an owned directory: ${path}`);
  }
}

function encodeSnapshot(documentId: string, state: Uint8Array): Buffer {
  const documentBytes = validateDocumentId(documentId);
  const stateBytes = Buffer.from(state);
  const checksum = createHash("sha256").update(documentBytes).update(stateBytes).digest();
  const encoded = Buffer.allocUnsafe(HEADER_SIZE + documentBytes.byteLength + stateBytes.byteLength);
  SNAPSHOT_MAGIC.copy(encoded, 0);
  encoded.writeUInt32BE(documentBytes.byteLength, SNAPSHOT_MAGIC.byteLength);
  encoded.writeUInt32BE(stateBytes.byteLength, SNAPSHOT_MAGIC.byteLength + 4);
  checksum.copy(encoded, SNAPSHOT_MAGIC.byteLength + 8);
  documentBytes.copy(encoded, HEADER_SIZE);
  stateBytes.copy(encoded, HEADER_SIZE + documentBytes.byteLength);
  return encoded;
}

function decodeSnapshot(documentId: string, encoded: Buffer, maxDocumentBytes: number): Uint8Array {
  try {
    if (encoded.byteLength < HEADER_SIZE || !encoded.subarray(0, SNAPSHOT_MAGIC.length).equals(SNAPSHOT_MAGIC)) {
      throw new Error("invalid snapshot header");
    }
    const documentLength = encoded.readUInt32BE(SNAPSHOT_MAGIC.byteLength);
    const stateLength = encoded.readUInt32BE(SNAPSHOT_MAGIC.byteLength + 4);
    if (documentLength === 0 || documentLength > MAX_DOCUMENT_ID_BYTES || stateLength > maxDocumentBytes) {
      throw new Error("snapshot length exceeds configured bounds");
    }
    if (encoded.byteLength !== HEADER_SIZE + documentLength + stateLength) {
      throw new Error("snapshot length does not match its header");
    }
    const checksum = encoded.subarray(SNAPSHOT_MAGIC.byteLength + 8, HEADER_SIZE);
    const documentBytes = encoded.subarray(HEADER_SIZE, HEADER_SIZE + documentLength);
    const state = encoded.subarray(HEADER_SIZE + documentLength);
    if (documentBytes.toString("utf8") !== documentId) {
      throw new Error("snapshot DocumentId does not match its storage key");
    }
    const actualChecksum = createHash("sha256").update(documentBytes).update(state).digest();
    if (!checksum.equals(actualChecksum)) throw new Error("snapshot checksum mismatch");
    return new Uint8Array(state);
  } catch (cause) {
    throw new DocumentStoreCorruptionError(
      documentId,
      `Stored collaboration snapshot is corrupt for ${documentId}`,
      cause,
    );
  }
}

async function atomicWrite(path: string, contents: Uint8Array): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path);
    const directoryHandle = await open(resolve(path, ".."), "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export function createFileDocumentStore(options: FileDocumentStoreOptions): FileDocumentStore {
  const root = validateDirectory(options.directory);
  const documentsDirectory = join(root, "documents");
  const maxDocumentBytes = options.maxDocumentBytes ?? DEFAULT_MAX_DOCUMENT_BYTES;
  if (!Number.isSafeInteger(maxDocumentBytes) || maxDocumentBytes < 1) {
    throw new TypeError("maxDocumentBytes must be a positive integer");
  }
  const writeQueues = new Map<string, Promise<void>>();
  let ready: Promise<void> | null = null;

  const ensureReady = (): Promise<void> => {
    ready ??= (async () => {
      await ensureOwnedDirectory(root);
      await ensureOwnedDirectory(documentsDirectory);
    })();
    return ready;
  };

  return {
    ensureReady,
    async fetch(documentId) {
      validateDocumentId(documentId);
      await ensureReady();
      const path = join(documentsDirectory, snapshotFilename(documentId));
      try {
        const encoded = await readFile(path);
        return decodeSnapshot(documentId, encoded, maxDocumentBytes);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
        if (cause instanceof DocumentStoreCorruptionError) throw cause;
        throw new DocumentStoreCorruptionError(
          documentId,
          `Could not read stored collaboration snapshot for ${documentId}`,
          cause,
        );
      }
    },
    async store(documentId, state) {
      validateDocumentId(documentId);
      if (state.byteLength > maxDocumentBytes) {
        throw new RangeError(`Collaboration snapshot exceeds the ${maxDocumentBytes}-byte maximum`);
      }
      await ensureReady();
      const path = join(documentsDirectory, snapshotFilename(documentId));
      const encoded = encodeSnapshot(documentId, state);
      const previous = writeQueues.get(documentId) ?? Promise.resolve();
      const current = previous.catch(() => undefined).then(() => atomicWrite(path, encoded));
      writeQueues.set(documentId, current);
      try {
        await current;
      } finally {
        if (writeQueues.get(documentId) === current) writeQueues.delete(documentId);
      }
    },
  };
}

interface RevocationFile {
  readonly version: 1;
  readonly records: Record<string, number | null>;
}

export interface FileTokenRevocationStoreOptions {
  readonly directory: string;
  readonly now?: () => number;
}

export function createFileTokenRevocationStore(
  options: FileTokenRevocationStoreOptions,
): TokenRevocationStore {
  const root = validateDirectory(options.directory);
  const authDirectory = join(root, "auth");
  const file = join(authDirectory, "revocations.json");
  const now = options.now ?? (() => Math.floor(Date.now() / 1_000));
  const records = new Map<string, number | null>();
  let loaded: Promise<void> | null = null;
  let writes = Promise.resolve();

  const pruneExpired = (): boolean => {
    const currentTime = now();
    if (!Number.isSafeInteger(currentTime)) {
      throw new TypeError("Revocation clock must return an integer Unix timestamp");
    }
    let changed = false;
    for (const [tokenId, expiresAt] of records) {
      if (expiresAt !== null && expiresAt <= currentTime) {
        records.delete(tokenId);
        changed = true;
      }
    }
    return changed;
  };

  const load = (): Promise<void> => {
    loaded ??= (async () => {
      await ensureOwnedDirectory(root);
      await ensureOwnedDirectory(authDirectory);
      try {
        const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<RevocationFile>;
        if (parsed.version !== 1 || !parsed.records || typeof parsed.records !== "object") {
          throw new Error("invalid revocation file schema");
        }
        for (const [tokenId, expiresAt] of Object.entries(parsed.records)) {
          validateDocumentId(tokenId);
          if (expiresAt !== null && !Number.isSafeInteger(expiresAt)) {
            throw new Error("invalid revocation expiry");
          }
          records.set(tokenId, expiresAt);
        }
        if (pruneExpired()) await persist();
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
        throw new Error("Token revocation store is corrupt", { cause });
      }
    })();
    return loaded;
  };

  const persist = async (): Promise<void> => {
    pruneExpired();
    const serialized: RevocationFile = {
      version: 1,
      records: Object.fromEntries(records),
    };
    await atomicWrite(file, Buffer.from(JSON.stringify(serialized), "utf8"));
  };

  const enqueuePersist = (): Promise<void> => {
    const current = writes.catch(() => undefined).then(persist);
    writes = current;
    return current;
  };

  return {
    async has(tokenId) {
      validateDocumentId(tokenId);
      await load();
      if (pruneExpired()) await enqueuePersist();
      else if (!records.has(tokenId)) await writes;
      return records.has(tokenId);
    },
    async add(tokenId, expiresAt) {
      validateDocumentId(tokenId);
      if (expiresAt !== undefined && !Number.isSafeInteger(expiresAt)) {
        throw new TypeError("expiresAt must be an integer Unix timestamp");
      }
      await load();
      records.set(tokenId, expiresAt ?? null);
      await enqueuePersist();
    },
  };
}
