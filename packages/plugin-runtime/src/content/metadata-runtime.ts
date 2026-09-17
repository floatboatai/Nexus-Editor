import { scanWikiLinks } from "@floatboat/nexus-core";
import type {
  ContentVersion,
  FileId,
  FileMetadata,
  ManagedResource,
  MarkdownLocation,
  MetadataBlock,
  MetadataEventMap,
  MetadataHeading,
  MetadataLink,
  MetadataService,
  NexusDiagnostic,
  NexusFile,
  ResolvedLink,
  ResourceOwner,
  TypedEvents,
  UnresolvedLink,
  VaultPath,
} from "@floatboat/nexus-plugin-api";

import { TypedEventRegistry } from "../events/typed-event-registry";
import { freezeFrontmatter, parseFrontmatterDocument } from "./frontmatter";
import { resolveWikiLinkTarget } from "./link-resolution";
import { MemoryVaultRuntime, type VaultCommit } from "./vault-runtime";

interface ParsedIndexEntry {
  readonly metadata: FileMetadata;
  readonly source: NexusFile;
}

interface VersionWaiter {
  readonly version: ContentVersion;
  readonly resolve: (metadata: FileMetadata) => void;
  readonly reject: (error: Error) => void;
}

export interface MemoryMetadataRuntimeOptions {
  readonly vault: MemoryVaultRuntime;
  readonly reportDiagnostic?: (diagnostic: NexusDiagnostic) => void;
}

function versionNumber(version: ContentVersion): number {
  const parsed = Number.parseInt(version.replace(/^v/, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positionAt(source: string, offset: number): { line: number; column: number; offset: number } {
  let line = 0;
  let lineStart = 0;
  for (let index = source.indexOf("\n"); index >= 0 && index < offset; index = source.indexOf("\n", index + 1)) {
    line += 1;
    lineStart = index + 1;
  }
  return { line, column: offset - lineStart, offset };
}

function location(source: string, from: number, to: number): MarkdownLocation {
  return Object.freeze({
    start: Object.freeze(positionAt(source, from)),
    end: Object.freeze(positionAt(source, to)),
  });
}

function metadataDiagnostic(
  file: NexusFile,
  message: string,
  cause: unknown,
): NexusDiagnostic {
  return Object.freeze({
    code: "callback-failed",
    severity: "error",
    phase: "runtime",
    message,
    resourceId: `nexus.metadata:file:${file.id}`,
    details: { fileId: file.id, path: file.path, version: file.version },
    cause: cause instanceof Error
      ? { name: cause.name, message: cause.message }
      : { message: String(cause) },
  });
}

function parseMetadata(file: NexusFile, source: string): FileMetadata {
  const parsedDocument = parseFrontmatterDocument(source);
  const frontmatter = parsedDocument.hasFrontmatter
    ? freezeFrontmatter(parsedDocument.frontmatter)
    : null;
  const headings: MetadataHeading[] = [];
  const blocks: Record<string, MetadataBlock> = Object.create(null) as Record<string, MetadataBlock>;
  const tags = new Set<string>();

  const headingPattern = /^( {0,3})(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
  for (const match of source.matchAll(headingPattern)) {
    const offset = match.index ?? 0;
    headings.push(Object.freeze({
      heading: match[3],
      level: match[2].length,
      position: location(source, offset, offset + match[0].length),
    }));
  }

  const blockPattern = /(?:^|[ \t])\^([A-Za-z0-9-]+)(?=[ \t]*$)/gm;
  for (const match of source.matchAll(blockPattern)) {
    const offset = (match.index ?? 0) + match[0].indexOf("^");
    const id = match[1];
    blocks[id] = Object.freeze({
      id,
      position: location(source, offset, offset + id.length + 1),
    });
  }

  const tagPattern = /(^|[\s([{>])#([\p{L}\p{N}_/-]+)/gmu;
  for (const match of source.matchAll(tagPattern)) tags.add(`#${match[2]}`);

  const links: MetadataLink[] = [];
  const embeds: MetadataLink[] = [];
  for (const match of scanWikiLinks(source)) {
    const embed = match.from > 0 && source[match.from - 1] === "!";
    const item = Object.freeze({
      link: match.target,
      ...(match.alias ? { displayText: match.alias } : {}),
      embed,
      position: location(source, embed ? match.from - 1 : match.from, match.to),
    });
    (embed ? embeds : links).push(item);
  }

  return Object.freeze({
    fileId: file.id,
    version: file.version,
    frontmatter,
    headings: Object.freeze(headings),
    blocks: Object.freeze(blocks),
    tags: Object.freeze([...tags]),
    links: Object.freeze(links),
    embeds: Object.freeze(embeds),
  });
}

/** Versioned, eventually-consistent metadata graph driven by Vault commits. */
export class MemoryMetadataRuntime implements ManagedResource {
  private readonly vault: MemoryVaultRuntime;
  private readonly reportDiagnostic: (diagnostic: NexusDiagnostic) => void;
  private readonly eventRegistry: TypedEventRegistry<MetadataEventMap>;
  private readonly entries = new Map<FileId, ParsedIndexEntry>();
  private readonly waiters = new Map<FileId, VersionWaiter[]>();
  private resolvedLinks: readonly ResolvedLink[] = Object.freeze([]);
  private unresolvedLinks: readonly UnresolvedLink[] = Object.freeze([]);
  private resolutionVersion = 0;
  private readonly unsubscribeVault: () => void;
  private disposed = false;

  constructor(options: MemoryMetadataRuntimeOptions) {
    this.vault = options.vault;
    this.reportDiagnostic = options.reportDiagnostic ?? (() => undefined);
    this.eventRegistry = new TypedEventRegistry<MetadataEventMap>({
      serviceId: "nexus.metadata.events",
      events: { changed: null, resolved: null, error: null },
      reportDiagnostic: this.reportDiagnostic,
    });
    for (const file of this.vault.listFiles()) this.indexInitial(file);
    this.rebuildResolutionGraph();
    this.unsubscribeVault = this.vault.onCommit((commit) => this.handleCommit(commit));
  }

  createService(
    owner: ResourceOwner,
    registerResource: (resource: ManagedResource) => void,
  ): MetadataService {
    const events = this.eventRegistry.createEvents(owner, registerResource);
    const service: MetadataService = {
      events,
      getFileCache: (file) => this.getFileCache(file),
      waitForVersion: (file, version) => this.waitForVersion(file, version),
      resolveLink: (target, sourcePath) => this.resolveLink(target, sourcePath),
      getResolvedLinks: (file) => this.getResolvedLinks(file),
      getUnresolvedLinks: (file) => this.getUnresolvedLinks(file),
      getBacklinks: (file) => this.getBacklinks(file),
    };
    return Object.freeze(service);
  }

  getFileCache(file: NexusFile): FileMetadata | null {
    if (!this.vault.ownsFile(file)) return null;
    return this.entries.get(file.id)?.metadata ?? null;
  }

  waitForVersion(file: NexusFile, version: ContentVersion): Promise<FileMetadata> {
    if (!this.vault.ownsFile(file)) {
      return Promise.reject(new Error("File reference does not belong to this Vault"));
    }
    const cached = this.entries.get(file.id)?.metadata;
    if (cached && versionNumber(cached.version) >= versionNumber(version)) {
      return Promise.resolve(cached);
    }
    return new Promise<FileMetadata>((resolve, reject) => {
      const list = this.waiters.get(file.id) ?? [];
      list.push({ version, resolve, reject });
      this.waiters.set(file.id, list);
    });
  }

  resolveLink(target: string, sourcePath?: VaultPath): NexusFile | null {
    return resolveWikiLinkTarget(target, sourcePath, this.vault);
  }

  getResolvedLinks(file?: NexusFile): readonly ResolvedLink[] {
    if (file && !this.vault.ownsFile(file)) return Object.freeze([]);
    return file
      ? Object.freeze(this.resolvedLinks.filter((link) => link.source.id === file.id))
      : this.resolvedLinks;
  }

  getUnresolvedLinks(file?: NexusFile): readonly UnresolvedLink[] {
    if (file && !this.vault.ownsFile(file)) return Object.freeze([]);
    return file
      ? Object.freeze(this.unresolvedLinks.filter((link) => link.source.id === file.id))
      : this.unresolvedLinks;
  }

  getBacklinks(file: NexusFile): readonly ResolvedLink[] {
    if (!this.vault.ownsFile(file)) return Object.freeze([]);
    return Object.freeze(this.resolvedLinks.filter((link) => link.target.id === file.id));
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeVault();
    for (const waiters of this.waiters.values()) {
      for (const waiter of waiters) waiter.reject(new Error("Metadata runtime was disposed"));
    }
    this.waiters.clear();
  }

  private indexInitial(file: NexusFile): void {
    if (!file.path.toLocaleLowerCase().endsWith(".md")) return;
    try {
      const source = new TextDecoder("utf-8", { fatal: true }).decode(
        this.vault.readBytesSnapshot(file),
      );
      this.entries.set(file.id, { metadata: parseMetadata(file, source), source: file });
    } catch (error) {
      this.reportDiagnostic(metadataDiagnostic(file, "Initial metadata indexing failed", error));
    }
  }

  private handleCommit(commit: VaultCommit): void {
    if (this.disposed) return;
    if (commit.type === "delete") {
      this.entries.delete(commit.fileId);
      this.rejectWaiters(commit.fileId, "File was deleted before indexing completed");
      this.finishResolution([...this.entries.keys()]);
      return;
    }

    const file = commit.file;
    if (file.kind !== "file") {
      this.finishResolution([]);
      return;
    }
    if (!file.path.toLocaleLowerCase().endsWith(".md")) {
      this.entries.delete(file.id);
      this.finishResolution([]);
      return;
    }
    try {
      const bytes = commit.bytes ?? this.vault.readBytesSnapshot(file);
      const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const metadata = parseMetadata(file, source);
      this.entries.set(file.id, { metadata, source: file });
      this.eventRegistry.emit("changed", { file, version: metadata.version, metadata });
      this.finishResolution([file.id]);
      this.resolveWaiters(file.id, metadata);
    } catch (error) {
      const item = metadataDiagnostic(file, "Metadata indexing failed", error);
      this.reportDiagnostic(item);
      this.eventRegistry.emit("error", { file, version: file.version, diagnostic: item });
      this.rejectWaiters(file.id, item.message);
    }
  }

  private finishResolution(changedFiles: readonly FileId[]): void {
    this.rebuildResolutionGraph();
    this.eventRegistry.emit("resolved", {
      version: ++this.resolutionVersion,
      changedFiles: Object.freeze([...changedFiles]),
    });
  }

  private rebuildResolutionGraph(): void {
    const resolved: ResolvedLink[] = [];
    const unresolved: UnresolvedLink[] = [];
    for (const entry of this.entries.values()) {
      const candidates = [...entry.metadata.links, ...entry.metadata.embeds];
      for (const link of candidates) {
        const target = this.resolveLink(link.link, entry.source.path);
        if (target) {
          resolved.push(Object.freeze({
            source: entry.source,
            target,
            original: link.link,
          }));
        } else {
          unresolved.push(Object.freeze({ source: entry.source, target: link.link }));
        }
      }
    }
    this.resolvedLinks = Object.freeze(resolved);
    this.unresolvedLinks = Object.freeze(unresolved);
  }

  private resolveWaiters(fileId: FileId, metadata: FileMetadata): void {
    const pending = this.waiters.get(fileId);
    if (!pending) return;
    const remaining: VersionWaiter[] = [];
    for (const waiter of pending) {
      if (versionNumber(metadata.version) >= versionNumber(waiter.version)) {
        waiter.resolve(metadata);
      } else {
        remaining.push(waiter);
      }
    }
    if (remaining.length > 0) this.waiters.set(fileId, remaining);
    else this.waiters.delete(fileId);
  }

  private rejectWaiters(fileId: FileId, message: string): void {
    const pending = this.waiters.get(fileId);
    if (!pending) return;
    this.waiters.delete(fileId);
    for (const waiter of pending) waiter.reject(new Error(message));
  }
}
