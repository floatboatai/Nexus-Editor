import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { decodeDocumentBytes, encodeDocumentText, TextCodecError, type DocumentTextFormat, type TextEncoding } from "@floatboat/nexus-text-codec";
import { legacyTextCodec } from "@floatboat/nexus-text-codec/legacy";
import { rewriteAssetReferences } from "@floatboat/nexus-document/assets";
import type { AssetResource } from "@floatboat/nexus-core";
import type { PublicDocumentSource, PublicDocumentSaved, PublicDocumentRead, PublicSearchDocumentInspection } from "../src/shared/public-capabilities-ipc";
import { PUBLIC_DOCUMENT_SEARCH_MAX_BYTES } from "../src/shared/public-capabilities-policy";
import type { IpcContentVersion, VaultSessionId } from "../src/shared/plugin-ipc";
import { contentVersion, ElectronVaultBroker, PluginHostBrokerError, type SenderIdentity } from "./plugin-host-broker";
import { PublicDocumentHistory } from "./public-document-history";

const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const ASSET_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "image/avif": "avif", "image/svg+xml": "svg", "image/bmp": "bmp",
};

export interface PublicCapabilitiesServicesOptions {
  readonly broker: ElectronVaultBroker;
  readonly history: PublicDocumentHistory;
  readonly isEnabled: (sender: SenderIdentity) => boolean;
  readonly chooseImport: (sender: SenderIdentity) => Promise<string | null>;
  readonly chooseSave: (sender: SenderIdentity, name: string, html: boolean) => Promise<string | null>;
  readonly chooseResourceDirectory: (sender: SenderIdentity) => Promise<string | null>;
}

interface Location {
  readonly senderId: number;
  readonly sessionId: VaultSessionId;
  readonly path: string;
  readonly name: string;
  readonly absolutePath?: string;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid public capabilities request");
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, max = 4096): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0")) throw new TypeError(`Invalid ${name}`);
  return value;
}
function bytes(value: unknown, max: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength > max) throw new TypeError("Invalid or oversized bytes");
  return new Uint8Array(value);
}
function assetDigest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function bodyText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length > MAX_DOCUMENT_BYTES) throw new TypeError(`Invalid or oversized ${name}`);
  return value;
}
function selectedEncoding(value: unknown): TextEncoding | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !["utf-8", "utf-16le", "utf-16be", "gbk", "gb18030", "big5", "shift_jis"].includes(value)) {
    throw new TypeError("Unsupported encoding");
  }
  return value as TextEncoding;
}
function format(value: unknown): DocumentTextFormat {
  const input = record(value);
  const encoding = selectedEncoding(input.encoding);
  if (!encoding || typeof input.bom !== "boolean" || !["lf", "crlf", "cr", "mixed", "none"].includes(String(input.eol))) {
    throw new TypeError("Invalid document format");
  }
  return { encoding, bom: input.bom, eol: input.eol as DocumentTextFormat["eol"] };
}

/** Only native dialogs and already-authorized Vault sessions establish file grants. */
export class PublicCapabilitiesServices {
  private readonly selected = new Map<string, Location>();
  private readonly formats = new Map<string, { readonly version: string; readonly format: DocumentTextFormat }>();
  private readonly ownedAssets = new Map<string, Set<string>>();
  private readonly resourceDirectories = new Map<string, { readonly senderId: number; readonly sessionId: VaultSessionId; readonly root: string }>();
  constructor(private readonly options: PublicCapabilitiesServicesOptions) {}

  closeSender(senderId: number): void {
    for (const [id, location] of this.selected) if (location.senderId === senderId) this.selected.delete(id);
    for (const key of this.formats.keys()) if (key.startsWith(`${senderId}:`)) this.formats.delete(key);
    for (const key of this.ownedAssets.keys()) if (key.startsWith(`${senderId}:`)) this.ownedAssets.delete(key);
    for (const [key, grant] of this.resourceDirectories) if (grant.senderId === senderId) this.resourceDirectories.delete(key);
  }

  decodeVaultText(sender: SenderIdentity, sessionId: VaultSessionId, path: string, data: Uint8Array): string {
    if (!this.options.isEnabled(sender)) return Buffer.from(data).toString("utf8");
    const result = this.decode(sender, { senderId: sender.id, sessionId, path, name: path }, data);
    if (result.status !== "decoded") throw new Error("Choose the document encoding before opening this file");
    return result.text;
  }

  encodeVaultText(sender: SenderIdentity, sessionId: VaultSessionId, path: string, value: string, previous: Uint8Array | null): Uint8Array {
    if (!this.options.isEnabled(sender)) return Buffer.from(value);
    const original = previous === null ? null : this.decode(sender, { senderId: sender.id, sessionId, path, name: path }, previous);
    if (original?.status === "needs-encoding") throw new Error("Choose the original file encoding before saving");
    return encodeDocumentText(value, { format: original?.status === "decoded" ? original.format : undefined, legacyCodec: legacyTextCodec });
  }

  async invoke(sender: SenderIdentity, payload: unknown): Promise<unknown> {
    this.assert(sender);
    const input = record(payload);
    switch (input.operation) {
      case "pick-import": {
        const chosen = await this.options.chooseImport(sender);
        this.assert(sender);
        if (!chosen) return null;
        const granted = await this.grant(sender, chosen);
        const file = await this.options.broker.readBinary(sender, granted.location.sessionId, granted.location.path, { maxBytes: MAX_DOCUMENT_BYTES });
        return { source: granted.source, name: granted.location.name, bytes: file.content, version: file.version };
      }
      case "read": {
        const source = this.source(input.source);
        const location = this.location(sender, source);
        const file = await this.options.broker.readBinary(sender, location.sessionId, location.path, { maxBytes: MAX_DOCUMENT_BYTES });
        const encoding = selectedEncoding(input.encoding);
        const result = this.decode(sender, location, file.content, encoding);
        if (encoding !== undefined && source.kind === "vault") this.options.broker.notifyRescan(sender, source.sessionId);
        return result;
      }
      case "inspect-search-document": {
        if (input.includeContent !== undefined && typeof input.includeContent !== "boolean") {
          throw new TypeError("Search content inclusion must be explicit");
        }
        return this.inspectSearchDocument(sender, this.source(input.source), input.includeContent === true, selectedEncoding(input.encoding));
      }
      case "asset": return this.readAsset(sender, this.source(input.source), text(input.reference, "asset reference"));
      case "grant-resource-directory": {
        const source = this.source(input.source);
        this.location(sender, source);
        if (source.kind === "vault") {
          await this.options.broker.documentStorageKey(sender, source.sessionId, source.path);
          return true;
        }
        const chosen = await this.options.chooseResourceDirectory(sender);
        this.location(sender, source);
        if (!chosen) return false;
        const root = await realpath(chosen);
        const session = await this.options.broker.openSession(sender, root, { watch: false });
        const previous = this.resourceDirectories.get(source.id);
        this.resourceDirectories.set(source.id, { senderId: sender.id, sessionId: session.sessionId, root });
        if (previous) this.options.broker.closeSession(sender, previous.sessionId);
        return true;
      }
      case "save": return this.save(sender, record(input.request));
      case "history": {
        const location = this.location(sender, this.source(input.source));
        const documentKey = await this.options.broker.documentStorageKey(sender, location.sessionId, location.path);
        return { documentKey, ...await this.options.history.read(documentKey) };
      }
      case "append-history": {
        const location = this.location(sender, this.source(input.source));
        this.requireEditable(location);
        const entry = record(input.record);
        if (entry.reason !== "checkpoint" && entry.reason !== "before-restore") throw new TypeError("Saved history records are main-process owned");
        if (input.expectedHead !== undefined && input.expectedHead !== null) text(input.expectedHead, "history head", 1024);
        const documentKey = await this.options.broker.documentStorageKey(sender, location.sessionId, location.path);
        return this.options.history.append(documentKey, {
          markdown: bodyText(entry.markdown, "history Markdown"),
          reason: entry.reason,
          ...(entry.label === undefined ? {} : { label: text(entry.label, "history label", 1024) }),
        }, input.expectedHead as string | null | undefined);
      }
      case "export-html": {
        const data = bytes(input.bytes, 32 * 1024 * 1024);
        const name = path.basename(text(input.name, "export name", 255));
        const chosen = await this.options.chooseSave(sender, name, true);
        this.assert(sender);
        if (!chosen) return false;
        if (path.extname(chosen).toLowerCase() !== ".html") throw new Error("HTML export needs an .html destination");
        const granted = await this.grant(sender, chosen);
        let expectedVersion: IpcContentVersion | undefined;
        if (await this.options.broker.fileExists(sender, granted.location.sessionId, granted.location.path)) {
          expectedVersion = (await this.options.broker.readBinary(sender, granted.location.sessionId, granted.location.path)).version;
        }
        await this.options.broker.write(sender, granted.location.sessionId, granted.location.path, data, { expectedVersion, requireAbsent: expectedVersion === undefined });
        return true;
      }
      default: throw new TypeError("Unknown public capabilities operation");
    }
  }

  private async inspectSearchDocument(
    sender: SenderIdentity,
    source: PublicDocumentSource,
    includeContent: boolean,
    encoding?: TextEncoding,
  ): Promise<PublicSearchDocumentInspection> {
    const location = this.location(sender, source);
    const unavailable = (
      code: Extract<PublicSearchDocumentInspection, { status: "unavailable" }>["code"],
      message: string,
    ): PublicSearchDocumentInspection => ({ status: "unavailable", name: location.name, code, message });
    try {
      const metadata = await this.options.broker.inspectFile(sender, location.sessionId, location.path);
      this.assert(sender);
      if (!includeContent) return { status: "available", name: location.name, ...metadata };
      if (metadata.size > PUBLIC_DOCUMENT_SEARCH_MAX_BYTES) {
        return unavailable("too-large", "文件超过 2 MiB 搜索限额，未读取正文");
      }
      const snapshot = await this.options.broker.readBinary(sender, location.sessionId, location.path, {
        maxBytes: PUBLIC_DOCUMENT_SEARCH_MAX_BYTES,
      });
      this.assert(sender);
      if (snapshot.metadataVersion === undefined || snapshot.size === undefined) {
        throw new Error("Search byte snapshot is missing its metadata observation");
      }
      // Search interpretation is determined by this request, not by another
      // caller's remembered codec choice. Its raw SHA remains the save CAS token.
      const decoded = this.decode(sender, location, snapshot.content, encoding, {
        useRememberedEncoding: false,
        rememberEncoding: encoding !== undefined,
      });
      if (decoded.status !== "decoded") return unavailable("encoding-required", "需要确认文本编码后才能搜索");
      return {
        status: "available",
        name: location.name,
        size: snapshot.size,
        metadataVersion: snapshot.metadataVersion,
        document: decoded,
      };
    } catch (error) {
      if (error instanceof PluginHostBrokerError) {
        if (error.code === "vault-path-invalid") return unavailable("missing", "文件不存在或不再是可读取的常规文件");
        if (error.code === "vault-path-escape" || error.code === "vault-version-conflict") {
          return unavailable("changed", "文件在读取期间变化或已离开授权范围");
        }
        // Revoked sessions and unauthorized senders are operation failures,
        // never a reason to retry through a less privileged file interface.
        throw error;
      }
      if (error instanceof RangeError) return unavailable("too-large", "文件超过搜索读取限额");
      if (error instanceof TextCodecError) return unavailable("encoding-required", "文件无法按当前编码无损读取");
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "ENOENT" || code === "ENOTDIR") return unavailable("missing", "文件已删除或目录已变化");
      if (code === "EACCES" || code === "EPERM") return unavailable("unreadable", "没有读取此文件的权限");
      throw error;
    }
  }

  private async save(sender: SenderIdentity, input: Record<string, unknown>): Promise<PublicDocumentSaved | null> {
    let source = input.source === null ? null : this.source(input.source);
    let markdown = bodyText(input.markdown, "Markdown");
    const requestedFormat = format(input.format);
    if (typeof input.history !== "boolean") throw new TypeError("History enablement must be explicit");
    let expected = input.expectedVersion === undefined ? undefined : text(input.expectedVersion, "byte version", 128);
    if (source === null) {
      const name = path.basename(input.name === undefined ? "Untitled.md" : text(input.name, "file name", 255));
      const chosen = await this.options.chooseSave(sender, name, false);
      this.assert(sender);
      if (!chosen) return null;
      const granted = await this.grant(sender, chosen);
      source = granted.source;
      if (await this.options.broker.fileExists(sender, granted.location.sessionId, granted.location.path)) {
        expected = (await this.options.broker.readBinary(sender, granted.location.sessionId, granted.location.path, { maxBytes: MAX_DOCUMENT_BYTES })).version;
      }
    } else if (expected === undefined) {
      throw new Error("Saving an existing source requires its original byte version");
    }
    const location = this.location(sender, source);
    this.requireEditable(location);
    const assets = input.assets === undefined ? [] : input.assets;
    if (!Array.isArray(assets) || assets.length > 100) throw new TypeError("Invalid attachment plan");
    let totalAssetBytes = 0;
    const seen = new Set<string>();
    const prepared = assets.map((value) => {
      const asset = record(value);
      const logical = text(asset.source, "logical asset reference", 2048);
      if (!logical.startsWith("nexus-asset:") || seen.has(logical)) throw new Error("Invalid or duplicate logical attachment");
      seen.add(logical);
      const data = bytes(asset.bytes, MAX_ASSET_BYTES);
      totalAssetBytes += data.byteLength;
      if (totalAssetBytes > 32 * 1024 * 1024) throw new Error("Attachment plan exceeds 32 MiB");
      const extension = ASSET_EXTENSIONS[text(asset.mimeType, "asset MIME type", 128)];
      if (!extension) throw new Error("Unsupported attachment image type");
      return { logical, data, name: `${assetDigest(data).slice(0, 32)}.${extension}` };
    });
    const destinations: Record<string, string> = {};
    const createdAssets: Array<{ readonly target: string; readonly version: IpcContentVersion }> = [];
    let data: Uint8Array;
    let decoded: Extract<ReturnType<typeof decodeDocumentBytes>, { status: "decoded" }>;
    let documentKey: string;
    let historyWarning: string | undefined;
    try {
      if (prepared.length) {
        const directory = path.posix.join(path.posix.dirname(location.path), "_assets");
        try { await this.options.broker.createFolder(sender, location.sessionId, directory); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
        for (const asset of prepared) {
          const target = `${directory}/${asset.name}`;
          let created = false;
          try {
            await this.options.broker.write(sender, location.sessionId, target, asset.data, { requireAbsent: true });
            created = true;
          } catch (error) {
            const existing = await this.options.broker.readBinary(sender, location.sessionId, target, { maxBytes: MAX_ASSET_BYTES });
            if (existing.version !== contentVersion(asset.data)) throw error;
          }
          if (created) createdAssets.push({ target, version: contentVersion(asset.data) });
          destinations[asset.logical] = `_assets/${asset.name}`;
          const key = this.formatKey(sender, location);
          const owned = this.ownedAssets.get(key) ?? new Set<string>();
          owned.add(target);
          this.ownedAssets.set(key, owned);
        }
      }
      if (markdown.includes("nexus-asset:")) markdown = rewriteAssetReferences(markdown, destinations);
      data = encodeDocumentText(markdown, { format: requestedFormat, legacyCodec: legacyTextCodec, maxBytes: MAX_DOCUMENT_BYTES });
      const decodedResult = decodeDocumentBytes(data, { encoding: requestedFormat.encoding, legacyCodec: legacyTextCodec });
      if (decodedResult.status !== "decoded") throw new Error("Encoded content cannot be decoded");
      decoded = decodedResult;
      documentKey = await this.options.broker.documentStorageKey(sender, location.sessionId, location.path);
      await this.options.broker.write(sender, location.sessionId, location.path, data, {
        ...(expected === undefined ? { requireAbsent: true } : { expectedVersion: expected as IpcContentVersion }),
        ...(input.history ? {
          beforeCommit: async (previous: Uint8Array | null) => {
            if (!previous) return;
            const baseline = this.decode(sender, location, previous);
            if (baseline.status !== "decoded") throw new Error("Choose the original encoding before creating its history baseline");
            await this.options.history.append(documentKey, { markdown: baseline.text, reason: "checkpoint", label: "Before first saved version" }, undefined, { bytes: previous, format: baseline.format }, true);
          },
          afterCommit: async () => {
            try { await this.options.history.append(documentKey, { markdown, reason: "saved" }, undefined, { bytes: data, format: decoded.format }); }
            catch (error) { historyWarning = error instanceof Error ? error.message : String(error); }
          },
        } : {}),
      });
    } catch (error) {
      await this.rollbackCreatedAssets(sender, location, createdAssets);
      throw error;
    }
    const savedVersion = contentVersion(data);
    this.formats.set(this.formatKey(sender, location), { version: savedVersion, format: decoded.format });
    return { source, name: location.name, markdown, format: decoded.format, version: savedVersion, ...(historyWarning ? { historyWarning } : {}) };
  }

  private async rollbackCreatedAssets(
    sender: SenderIdentity,
    location: Location,
    assets: readonly { readonly target: string; readonly version: IpcContentVersion }[],
  ): Promise<void> {
    const key = this.formatKey(sender, location);
    const owned = this.ownedAssets.get(key);
    for (const asset of assets) {
      try {
        const current = await this.options.broker.readBinary(sender, location.sessionId, asset.target, { maxBytes: MAX_ASSET_BYTES });
        if (current.version !== asset.version) continue;
        await this.options.broker.trash(sender, location.sessionId, asset.target);
        owned?.delete(asset.target);
      } catch {
        // Preserve the original save error; a failed cleanup remains recoverable in the Vault.
      }
    }
    if (owned?.size === 0) this.ownedAssets.delete(key);
  }

  private async readAsset(sender: SenderIdentity, source: PublicDocumentSource, reference: string): Promise<AssetResource | null> {
    const location = this.location(sender, source);
    let relative: string;
    try { relative = decodeURIComponent(reference.split(/[?#]/, 1)[0]); }
    catch { return null; }
    if (!relative || /^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(relative) || relative.includes("\\")) return null;
    let target = path.posix.join(path.posix.dirname(location.path), relative);
    let sessionId = location.sessionId;
    // Selecting one file is not a grant to enumerate or read its siblings.
    if (source.kind === "selected" && !this.ownedAssets.get(this.formatKey(sender, location))?.has(target)) {
      const grant = this.resourceDirectories.get(source.id);
      if (!grant || grant.senderId !== sender.id || !location.absolutePath) return null;
      const absolute = path.resolve(path.dirname(location.absolutePath), relative);
      const inside = path.relative(grant.root, absolute);
      if (!inside || inside === ".." || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) return null;
      target = inside.split(path.sep).join("/");
      sessionId = grant.sessionId;
    }
    const extension = path.posix.extname(relative).slice(1).toLowerCase();
    const mimeType = Object.entries(ASSET_EXTENSIONS).find(([, value]) => value === extension)?.[0] ?? (extension === "jpeg" ? "image/jpeg" : null);
    if (!mimeType) return null;
    try {
      const file = await this.options.broker.readBinary(sender, sessionId, target, { maxBytes: MAX_ASSET_BYTES });
      return { bytes: file.content, mimeType };
    } catch { return null; }
  }

  private decode(
    sender: SenderIdentity,
    location: Location,
    data: Uint8Array,
    encoding?: TextEncoding,
    policy: { readonly useRememberedEncoding?: boolean; readonly rememberEncoding?: boolean } = {},
  ): PublicDocumentRead {
    const byteVersion = contentVersion(data);
    const known = this.formats.get(this.formatKey(sender, location));
    const result = decodeDocumentBytes(data, {
      encoding: encoding ?? (policy.useRememberedEncoding !== false && known?.version === byteVersion ? known.format.encoding : undefined), legacyCodec: legacyTextCodec,
    });
    if (result.status === "decoded" && policy.rememberEncoding !== false) {
      this.formats.set(this.formatKey(sender, location), { version: byteVersion, format: result.format });
    }
    return { ...result, name: location.name, version: byteVersion };
  }

  private formatKey(sender: SenderIdentity, location: Location): string { return `${sender.id}:${location.sessionId}:${location.path}`; }
  private source(value: unknown): PublicDocumentSource {
    const input = record(value);
    if (input.kind === "selected") return { kind: "selected", id: text(input.id, "selected file id", 128) };
    if (input.kind === "vault") return { kind: "vault", sessionId: text(input.sessionId, "Vault session", 128) as VaultSessionId, path: text(input.path, "Vault path") };
    throw new TypeError("Invalid document source");
  }
  private location(sender: SenderIdentity, source: PublicDocumentSource): Location {
    this.assert(sender);
    if (source.kind === "vault") return { senderId: sender.id, sessionId: source.sessionId, path: source.path, name: path.posix.basename(source.path) };
    const location = this.selected.get(source.id);
    if (!location || location.senderId !== sender.id) throw new Error("Selected file is not authorized for this window");
    return location;
  }
  private requireEditable(location: Location): void {
    if (!TEXT_EXTENSIONS.has(path.extname(location.name).toLowerCase())) throw new Error("Converted input cannot be overwritten; save as a new Markdown document");
  }
  private async grant(sender: SenderIdentity, absolutePath: string): Promise<{ source: PublicDocumentSource; location: Location }> {
    this.assert(sender);
    const session = await this.options.broker.openSession(sender, path.dirname(absolutePath), { watch: false });
    this.assert(sender);
    const location = {
      senderId: sender.id, sessionId: session.sessionId,
      path: path.basename(absolutePath), name: path.basename(absolutePath),
      absolutePath: path.join(await realpath(path.dirname(absolutePath)), path.basename(absolutePath)),
    };
    const id = randomUUID();
    this.selected.set(id, location);
    return { source: { kind: "selected", id }, location };
  }
  private assert(sender: SenderIdentity): void {
    if (!this.options.isEnabled(sender)) throw new Error("Public capability demo is not enabled for this window");
  }
}
