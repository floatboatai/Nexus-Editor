import type { VaultPath } from "@floatboat/nexus-plugin-api";

import { normalizeVaultPath } from "./path-policy";

export interface WikiLinkFile {
  readonly path: VaultPath;
  readonly basename: string;
}

export interface WikiLinkFileLookup<TFile extends WikiLinkFile> {
  getFileByPath(path: VaultPath): TFile | null;
  listFiles(): readonly TFile[];
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? path : path.slice(index + 1);
}

function stripMarkdownExtension(path: string): string {
  return path.replace(/\.md$/i, "");
}

function stripLinkAnchor(target: string): string {
  const hash = target.indexOf("#");
  const caret = target.indexOf("^");
  const indexes = [hash, caret].filter((index) => index >= 0);
  return (indexes.length === 0 ? target : target.slice(0, Math.min(...indexes))).trim();
}

export function resolveWikiLinkTarget<TFile extends WikiLinkFile>(
  target: string,
  sourcePath: VaultPath | undefined,
  lookup: WikiLinkFileLookup<TFile>,
): TFile | null {
  const bare = stripLinkAnchor(target);
  if (!bare && sourcePath) return lookup.getFileByPath(sourcePath);
  if (!bare) return null;

  let normalized: VaultPath;
  try {
    normalized = normalizeVaultPath(bare);
  } catch {
    return null;
  }

  const variants = normalized.toLocaleLowerCase().endsWith(".md")
    ? [normalized]
    : [normalized, `${normalized}.md` as VaultPath];
  for (const candidate of variants) {
    const exact = lookup.getFileByPath(candidate);
    if (exact) return exact;
  }

  if (sourcePath) {
    const directory = dirname(sourcePath);
    for (const candidate of variants) {
      const relativePath = (directory ? `${directory}/${candidate}` : candidate) as VaultPath;
      const relative = lookup.getFileByPath(relativePath);
      if (relative) return relative;
    }
  }

  const needle = stripMarkdownExtension(basename(normalized)).toLocaleLowerCase();
  const matches = lookup.listFiles().filter(
    (file) => file.basename.toLocaleLowerCase() === needle,
  );
  return matches.length === 1 ? matches[0] : null;
}
