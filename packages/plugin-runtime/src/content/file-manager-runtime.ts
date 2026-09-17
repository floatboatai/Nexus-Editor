import type {
  AttachmentLocationRequest,
  ContentWriteResult,
  FileManagerService,
  FileMoveOptions,
  MarkdownLinkOptions,
  MutableJsonObject,
  NexusAbstractFile,
  NexusFile,
  ResourceOwner,
  ServiceResult,
  TrashOptions,
  VaultPath,
} from "@floatboat/nexus-plugin-api";

import { parseFrontmatterDocument, serializeFrontmatterDocument } from "./frontmatter";
import {
  resolveWikiLinkTarget,
  type WikiLinkFile,
  type WikiLinkFileLookup,
} from "./link-resolution";
import { VaultPathPolicy } from "./path-policy";
import { MemoryVaultRuntime } from "./vault-runtime";

export interface MemoryFileManagerOptions {
  readonly vault: MemoryVaultRuntime;
  readonly attachmentFolder?: string;
  readonly updateLinksByDefault?: boolean;
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index + 1);
}

function stemOf(name: string): string {
  const extension = extensionOf(name);
  return extension ? name.slice(0, -(extension.length + 1)) : name;
}

function escapeLinkPart(value: string): string {
  return value.replace(/([\\|\]#^])/g, "\\$1");
}

interface WikiLinkFileSnapshot extends WikiLinkFile {
  readonly file: NexusFile;
}

function rewriteWikiLinks(
  source: string,
  sourcePath: VaultPath,
  movedFile: WikiLinkFileSnapshot,
  newPath: VaultPath,
  lookup: WikiLinkFileLookup<WikiLinkFileSnapshot>,
): string {
  const replacement = newPath.replace(/\.md$/i, "");
  return source.replace(
    /(?<!\\)(!?)\[\[([^\[\]\n|]+?)(\|[^\[\]\n]+?)?\]\]/g,
    (whole, embed: string, rawTarget: string, alias: string | undefined) => {
      const anchorIndex = rawTarget.search(/[#^]/);
      const pathPart = (anchorIndex < 0 ? rawTarget : rawTarget.slice(0, anchorIndex)).trim();
      const anchor = anchorIndex < 0 ? "" : rawTarget.slice(anchorIndex);
      if (!pathPart) return whole;
      if (resolveWikiLinkTarget(rawTarget, sourcePath, lookup) !== movedFile) return whole;
      return `${embed}[[${replacement}${anchor}${alias ?? ""}]]`;
    },
  );
}

export class MemoryFileManagerRuntime {
  private readonly vault: MemoryVaultRuntime;
  private readonly pathPolicy = new VaultPathPolicy();
  private readonly attachmentFolder: VaultPath;
  private readonly updateLinksByDefault: boolean;
  private moveTail: Promise<void> = Promise.resolve();

  constructor(options: MemoryFileManagerOptions) {
    this.vault = options.vault;
    this.attachmentFolder = this.pathPolicy.normalize(options.attachmentFolder ?? "attachments");
    this.updateLinksByDefault = options.updateLinksByDefault ?? true;
  }

  createService(owner: ResourceOwner): FileManagerService {
    const vaultService = this.vault.createService(owner, () => undefined);
    const service: FileManagerService = {
      getAvailableAttachmentPath: (request) => this.getAvailableAttachmentPath(request),
      moveFile: (file, destination, options) =>
        this.enqueueMove(() => this.moveFile(vaultService, file, destination, options)),
      renameFile: (file, name, options) => {
        if (
          name.includes("/") ||
          name.includes("\\") ||
          !name.trim() ||
          name === "." ||
          name === ".."
        ) {
          return Promise.resolve({
            ok: false,
            diagnostic: {
              code: "path-outside-authorized-root",
              severity: "error",
              phase: "runtime",
              message: "File name must be a single non-empty path segment",
            },
          });
        }
        return this.enqueueMove(async () => {
          try {
            const directory = dirname(file.path);
            const destination = this.pathPolicy.normalize(
              directory ? `${directory}/${name}` : name,
            );
            return this.moveFile(vaultService, file, destination, options);
          } catch (error) {
            return {
              ok: false,
              diagnostic: {
                code: "path-outside-authorized-root",
                severity: "error",
                phase: "runtime",
                message: error instanceof Error ? error.message : "File name is invalid",
              },
            };
          }
        });
      },
      trashFile: async (file, options) => {
        if (options?.permanent) {
          const result = await vaultService.delete(file, { permanent: true });
          return result.ok
            ? { ok: true, value: { recoverable: false as const } }
            : result;
        }
        return vaultService.trash(file);
      },
      generateMarkdownLink: (file, options) => this.generateMarkdownLink(file, options),
      processFrontmatter: (file, transform) =>
        this.processFrontmatter(vaultService, file, transform),
    };
    return Object.freeze(service);
  }

  private async getAvailableAttachmentPath(
    request: AttachmentLocationRequest,
  ): Promise<VaultPath> {
    const name = request.name.trim();
    if (!name || name.includes("/") || name.includes("\\")) {
      throw new RangeError("Attachment name must be a single non-empty path segment");
    }
    const preferredFolder = request.sourcePath
      ? dirname(this.pathPolicy.normalize(request.sourcePath))
      : this.attachmentFolder;
    const base = preferredFolder ? `${preferredFolder}/${name}` : name;
    if (!this.vault.getAbstractFileByPath(base)) return this.pathPolicy.normalize(base);
    const extension = extensionOf(name);
    const stem = stemOf(name);
    for (let suffix = 1; suffix < Number.MAX_SAFE_INTEGER; suffix += 1) {
      const candidateName = extension
        ? `${stem} ${suffix}.${extension}`
        : `${stem} ${suffix}`;
      const candidate = preferredFolder
        ? `${preferredFolder}/${candidateName}`
        : candidateName;
      if (!this.vault.getAbstractFileByPath(candidate)) {
        return this.pathPolicy.normalize(candidate);
      }
    }
    throw new Error("No attachment path is available");
  }

  private async moveFile(
    service: ReturnType<MemoryVaultRuntime["createService"]>,
    file: NexusAbstractFile,
    destination: VaultPath,
    options: FileMoveOptions = {},
  ): Promise<ServiceResult<NexusAbstractFile>> {
    const oldPath = file.path;
    const shouldUpdate = options.updateLinks === "always" ||
      (options.updateLinks !== "never" && this.updateLinksByDefault);
    const shouldRewriteLinks = shouldUpdate &&
      file.kind === "file" &&
      oldPath.toLocaleLowerCase().endsWith(".md");
    const snapshots = shouldRewriteLinks
      ? this.vault.listFiles().map<WikiLinkFileSnapshot>((candidate) => ({
          file: candidate,
          path: candidate.path,
          basename: candidate.basename,
        }))
      : [];
    const snapshotByFile = new Map(snapshots.map((snapshot) => [snapshot.file, snapshot]));
    const snapshotByPath = new Map(snapshots.map((snapshot) => [snapshot.path, snapshot]));
    const movedFile = file.kind === "file" ? snapshotByFile.get(file) : undefined;
    const lookup: WikiLinkFileLookup<WikiLinkFileSnapshot> = {
      getFileByPath: (path) => snapshotByPath.get(path) ?? null,
      listFiles: () => snapshots,
    };
    const result = await service.rename(file, destination, {
      ...(options.expectedVersion ? { expectedVersion: options.expectedVersion } : {}),
      origin: "file-manager-move",
    });
    if (!result.ok) return result;
    if (movedFile) {
      const failures: string[] = [];
      for (const source of this.vault.listFiles()) {
        if (!source.path.toLocaleLowerCase().endsWith(".md")) continue;
        if (!snapshotByFile.has(source)) continue;
        const sourcePath = source === movedFile.file ? movedFile.path : source.path;
        const transformed = await service.process(source, (current) =>
          rewriteWikiLinks(
            current,
            sourcePath,
            movedFile,
            result.value.path,
            lookup,
          ));
        if (!transformed.ok) failures.push(source.path);
      }
      if (failures.length > 0) {
        return {
          ok: false,
          diagnostic: {
            code: "unsupported-operation",
            severity: "error",
            phase: "runtime",
            message: "File moved, but one or more Markdown references could not be updated",
            details: { moved: true, failedFiles: failures },
          },
        };
      }
    }
    return result;
  }

  private enqueueMove<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.moveTail.then(operation, operation);
    this.moveTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private generateMarkdownLink(
    file: NexusFile,
    options: MarkdownLinkOptions = {},
  ): string {
    if (!file.valid) throw new RangeError("Cannot link to an invalid file reference");
    let target = file.extension.toLocaleLowerCase() === "md"
      ? file.path.slice(0, -(file.extension.length + 1))
      : file.path;
    if (options.subpath) target += options.subpath;
    const alias = options.alias ? `|${escapeLinkPart(options.alias)}` : "";
    return `${options.embed ? "!" : ""}[[${escapeLinkPart(target)}${alias}]]`;
  }

  private processFrontmatter(
    service: ReturnType<MemoryVaultRuntime["createService"]>,
    file: NexusFile,
    transform: (frontmatter: MutableJsonObject) => void,
  ): Promise<ContentWriteResult> {
    return service.process(file, (source) => {
      const parsed = parseFrontmatterDocument(source);
      const result = transform(parsed.frontmatter) as unknown;
      if (
        result !== null &&
        (typeof result === "object" || typeof result === "function") &&
        "then" in result
      ) {
        throw new TypeError("Frontmatter transforms must be synchronous");
      }
      return serializeFrontmatterDocument(parsed.frontmatter, parsed.body, parsed.newline);
    }, { origin: "frontmatter" });
  }
}
