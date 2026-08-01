import type { TocEntry } from "@floatboat/nexus-core";
import type { BacklinkHit } from "./link-index";
import { normalizeSlashes } from "./path-utils";

export interface AIContextStats {
  characters: number;
  words: number;
  lines: number;
}

export interface BuildAIContextOptions {
  activeFile: string | null;
  vaultPath: string | null;
  document: string;
  selectedText: string;
  outline: TocEntry[];
  stats: AIContextStats;
  backlinks: BacklinkHit[];
  unlinkedMentions: BacklinkHit[];
  maxMentions?: number;
  maxOutlineEntries?: number;
  maxSnippetLength?: number;
}

const DEFAULT_MAX_MENTIONS = 8;
const DEFAULT_MAX_OUTLINE_ENTRIES = 24;
const DEFAULT_MAX_SNIPPET_LENGTH = 140;

function basename(path: string): string {
  const norm = normalizeSlashes(path);
  const slash = norm.lastIndexOf("/");
  return slash >= 0 ? norm.slice(slash + 1) : norm;
}

export function formatContextPath(path: string | null, vaultPath: string | null): string {
  if (!path) return "Untitled";
  const normPath = normalizeSlashes(path);
  if (!vaultPath) return normPath;

  const normVault = normalizeSlashes(vaultPath).replace(/\/+$/, "");
  if (normPath === normVault) return basename(normPath);
  if (normPath.startsWith(`${normVault}/`)) return normPath.slice(normVault.length + 1);
  return normPath;
}

function truncate(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function markdownFenceFor(value: string): string {
  const matches = value.match(/`+/g) ?? [];
  const longest = matches.reduce((max, match) => Math.max(max, match.length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

function appendFencedMarkdown(lines: string[], value: string, language = "markdown"): void {
  const fence = markdownFenceFor(value);
  lines.push(`${fence}${language}`, value, fence);
}

function appendOutline(lines: string[], outline: TocEntry[], maxEntries: number): void {
  if (outline.length === 0) {
    lines.push("None");
    return;
  }

  for (const entry of outline.slice(0, maxEntries)) {
    const indent = "  ".repeat(Math.max(0, entry.level - 1));
    lines.push(`${indent}- H${entry.level} ${entry.text}`);
  }

  if (outline.length > maxEntries) {
    lines.push(`... and ${outline.length - maxEntries} more headings`);
  }
}

function appendMentions(
  lines: string[],
  hits: BacklinkHit[],
  vaultPath: string | null,
  maxMentions: number,
  maxSnippetLength: number
): void {
  if (hits.length === 0) {
    lines.push("None");
    return;
  }

  for (const hit of hits.slice(0, maxMentions)) {
    const source = formatContextPath(hit.sourcePath, vaultPath);
    const snippet = truncate(hit.snippet || "(empty)", maxSnippetLength);
    lines.push(`- ${source}: ${snippet}`);
  }

  if (hits.length > maxMentions) {
    lines.push(`... and ${hits.length - maxMentions} more mentions`);
  }
}

export function buildAIContext(options: BuildAIContextOptions): string {
  const {
    activeFile,
    vaultPath,
    document,
    selectedText,
    outline,
    stats,
    backlinks,
    unlinkedMentions,
    maxMentions = DEFAULT_MAX_MENTIONS,
    maxOutlineEntries = DEFAULT_MAX_OUTLINE_ENTRIES,
    maxSnippetLength = DEFAULT_MAX_SNIPPET_LENGTH,
  } = options;

  const lines: string[] = [
    "# Nexus AI Context",
    "",
    "## Active Note",
    `- Path: ${formatContextPath(activeFile, vaultPath)}`,
    `- Words: ${stats.words}`,
    `- Lines: ${stats.lines}`,
    `- Characters: ${stats.characters}`,
  ];

  const trimmedSelection = selectedText.trim();
  if (trimmedSelection) {
    lines.push("", "## Selected Text");
    appendFencedMarkdown(lines, trimmedSelection);
  }

  lines.push("", "## Outline");
  appendOutline(lines, outline, maxOutlineEntries);

  lines.push("", `## Linked Mentions (${backlinks.length})`);
  appendMentions(lines, backlinks, vaultPath, maxMentions, maxSnippetLength);

  lines.push("", `## Unlinked Mentions (${unlinkedMentions.length})`);
  appendMentions(lines, unlinkedMentions, vaultPath, maxMentions, maxSnippetLength);

  lines.push("", "## Markdown");
  appendFencedMarkdown(lines, document);

  return lines.join("\n");
}
