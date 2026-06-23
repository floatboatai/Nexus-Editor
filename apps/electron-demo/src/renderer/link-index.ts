import { scanWikiLinks, type WikiLinkMatch } from "@floatboat/nexus-core";
import { normalizeSlashes, joinPath } from "./path-utils";

/** Prefer requestIdleCallback for yielding; fall back to a macrotask otherwise. */
function yieldToIdle(): Promise<void> {
  return new Promise((resolve) => {
    const ric: ((cb: () => void, opts?: { timeout: number }) => number) | undefined = (
      globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }
    ).requestIdleCallback;
    if (typeof ric === "function") {
      ric(() => resolve(), { timeout: 50 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export interface BacklinkHit {
  sourcePath: string;
  target: string;
  from: number;
  to: number;
  snippet: string;
}

export type LinkIndexListener = () => void;

interface IndexSnapshot {
  forward: Map<string, WikiLinkMatch[]>;
  backward: Map<string, BacklinkHit[]>;
  contents: Map<string, string>;
  byBasename: Map<string, Set<string>>;
}

interface RebuildAsyncOptions {
  onProgress?: (done: number, total: number) => void;
  isCancelled?: () => boolean;
}

function basename(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const slash = norm.lastIndexOf("/");
  return slash >= 0 ? norm.slice(slash + 1) : norm;
}

function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function dirname(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const slash = norm.lastIndexOf("/");
  return slash >= 0 ? norm.slice(0, slash) : "";
}

/**
 * Strip Obsidian-style anchors from a link target:
 *   "Foo"              → "Foo"
 *   "Foo#Heading"      → "Foo"
 *   "Foo^block-id"     → "Foo"
 *   "Foo/Bar#Heading"  → "Foo/Bar"
 * An empty bare target (e.g. "#Heading") returns empty.
 */
export function stripAnchor(target: string): string {
  const hash = target.indexOf("#");
  const caret = target.indexOf("^");
  const cuts = [hash, caret].filter((i) => i >= 0);
  if (cuts.length === 0) return target.trim();
  const cut = Math.min(...cuts);
  return target.slice(0, cut).trim();
}

export type LinkAnchor =
  | { kind: "heading"; value: string }
  | { kind: "block"; value: string };

/**
 * Split a wiki-link target into the bare path part and its Obsidian anchor
 * (if any). Heading anchors use `#`, block refs use `^`.
 */
export function parseAnchor(target: string): { bare: string; anchor: LinkAnchor | null } {
  const bare = stripAnchor(target);
  const hash = target.indexOf("#");
  const caret = target.indexOf("^");
  if (hash < 0 && caret < 0) return { bare, anchor: null };
  // Whichever marker appears first wins; any subsequent `#` in a heading
  // anchor is legal Obsidian syntax (nested heading path), so keep the raw
  // substring after the first marker.
  if (hash >= 0 && (caret < 0 || hash < caret)) {
    return { bare, anchor: { kind: "heading", value: target.slice(hash + 1).trim() } };
  }
  return { bare, anchor: { kind: "block", value: target.slice(caret + 1).trim() } };
}

function normalizeHeadingText(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Find the character offset in `content` that corresponds to the given link
 * anchor, or null when no match. Offsets point at the start of the matching
 * line so `editor.setSelection(pos)` scrolls the heading/block into view.
 *
 * - Heading: matches any `# Heading` / `## Heading` line whose rendered text
 *   equals the anchor value under whitespace-collapsed, case-insensitive
 *   comparison. Obsidian also supports `#Parent#Child` (nested heading path)
 *   — for v1 we match on the LAST segment only, which is enough for the
 *   unambiguous case and degrades gracefully for duplicate sub-headings.
 * - Block: matches the first line that contains ` ^<id>` (possibly at EOL).
 */
export function findAnchorPosition(content: string, anchor: LinkAnchor): number | null {
  if (anchor.kind === "heading") {
    const segments = anchor.value.split("#").map((s) => s.trim()).filter(Boolean);
    if (segments.length === 0) return null;
    const needle = normalizeHeadingText(segments[segments.length - 1]);
    const lines = content.split("\n");
    let offset = 0;
    for (const line of lines) {
      const m = /^(\s{0,3})(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (m) {
        const headingText = normalizeHeadingText(m[3]);
        if (headingText === needle) return offset;
      }
      offset += line.length + 1; // +1 for the newline
    }
    return null;
  }
  // Block ref: ` ^<id>` preceded by whitespace or at line start, not part of a
  // longer word. Obsidian stores block IDs at end of a line by convention but
  // we're lenient about position.
  const id = anchor.value;
  if (!id) return null;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\s)\\^${escaped}(?=\\s|$)`, "m");
  const m = re.exec(content);
  if (!m) return null;
  // Return the start of the line containing the match.
  const matchIdx = m.index + (m[0].startsWith("^") ? 0 : 1);
  return content.lastIndexOf("\n", matchIdx - 1) + 1;
}

function snippetAround(content: string, from: number, to: number): string {
  const lineStart = content.lastIndexOf("\n", from - 1) + 1;
  const nl = content.indexOf("\n", to);
  const lineEnd = nl === -1 ? content.length : nl;
  return content.slice(lineStart, lineEnd).trim();
}

/**
 * Vault-scoped bidirectional wiki-link index.
 *
 * Keys are ABSOLUTE file paths as returned by the electron bridge. All match
 * offsets are absolute offsets inside the source file's content string.
 */
export class LinkIndex {
  /** Forward edges: source path → list of wiki links it contains. */
  private forward = new Map<string, WikiLinkMatch[]>();
  /** Reverse index: resolved target path → list of (source, match) pairs. */
  private backward = new Map<string, BacklinkHit[]>();
  /** Content cache — needed for recomputing snippets after active-file edits. */
  private contents = new Map<string, string>();
  /** basename (without extension, lowercase) → set of absolute paths. */
  private byBasename = new Map<string, Set<string>>();
  /** Memoized unlinked-mentions result per target; invalidated on any
   * contents/forward mutation. */
  private unlinkedCache = new Map<string, BacklinkHit[]>();

  private listeners = new Set<LinkIndexListener>();

  private invalidateUnlinkedCache(): void {
    if (this.unlinkedCache.size > 0) this.unlinkedCache.clear();
  }

  /** Replace the entire index with `files`. */
  rebuild(files: Array<{ path: string; content: string }>): void {
    const next = this.createEmptySnapshot();
    for (const f of files) {
      this.indexFileInto(next, f.path, f.content);
    }
    this.rebuildBackwardInto(next);
    this.commitSnapshot(next);
    this.notify();
  }

  /**
   * Async chunked rebuild — yields to the event loop every `CHUNK` files so the
   * UI thread stays responsive on large vaults. `notify()` fires once at the
   * end; callers that want progressive updates can pass `onProgress`.
   *
   * The rebuild happens against temporary maps and commits atomically at the
   * end. If a newer seed supersedes this run, `isCancelled` leaves the current
   * index untouched instead of exposing a partially rebuilt graph.
   */
  async rebuildAsync(
    files: Array<{ path: string; content: string }>,
    options: RebuildAsyncOptions = {},
  ): Promise<boolean> {
    const next = this.createEmptySnapshot();
    const CHUNK = 25;
    for (let i = 0; i < files.length; i += CHUNK) {
      if (options.isCancelled?.()) return false;
      const end = Math.min(i + CHUNK, files.length);
      for (let j = i; j < end; j++) {
        const f = files[j];
        this.indexFileInto(next, f.path, f.content);
      }
      options.onProgress?.(end, files.length);
      // Yield to the event loop so paint / input events can interleave.
      await yieldToIdle();
    }
    if (options.isCancelled?.()) return false;
    this.rebuildBackwardInto(next);
    if (options.isCancelled?.()) return false;
    this.commitSnapshot(next);
    this.notify();
    return true;
  }

  /** Incremental update for a single file's contents. */
  updateFile(path: string, content: string): void {
    this.removeFromBasenames(path);
    this.indexFile(path, content);
    this.invalidateUnlinkedCache();
    // Incremental reverse-index maintenance — only rewrites backward edges
    // whose `sourcePath` is this file. O(|edges of this file|) instead of
    // O(|total edges in the vault|). On keystroke-driven updates the previous
    // behavior scaled with vault size; now it only scales with this file.
    this.rebuildBackwardFor(normalizeSlashes(path));
    this.notify();
  }

  /** Drop a file and all its outgoing/incoming edges. */
  removeFile(path: string): void {
    this.removeFromBasenames(path);
    const norm = normalizeSlashes(path);
    this.forward.delete(norm);
    this.contents.delete(norm);
    this.invalidateUnlinkedCache();
    // Only purge edges whose sourcePath is this file.
    this.removeBackwardEdgesFrom(norm);
    this.notify();
  }

  /** Rename `oldPath` → `newPath`, preserving content. */
  renameFile(oldPath: string, newPath: string): void {
    const content = this.contents.get(normalizeSlashes(oldPath));
    if (content == null) return;
    this.removeFile(oldPath);
    this.updateFile(newPath, content);
  }

  /** All known note names (basename without extension), deduplicated. */
  getAllNoteNames(): string[] {
    const out = new Set<string>();
    for (const abs of this.forward.keys()) {
      out.add(stripExt(basename(abs)));
    }
    for (const abs of this.contents.keys()) {
      out.add(stripExt(basename(abs)));
    }
    return [...out].sort((a, b) => a.localeCompare(b));
  }

  /** Get inbound wiki-link references for an absolute target path. */
  getBacklinks(targetPath: string): BacklinkHit[] {
    return this.backward.get(normalizeSlashes(targetPath)) ?? [];
  }

  /**
   * Find plain-text occurrences of the target file's basename (sans extension)
   * across every other file in the vault, excluding any occurrence that falls
   * inside an existing wiki link. Case-insensitive, word-boundary matched.
   *
   * Corresponds to Obsidian's "Unlinked mentions" section.
   *
   * Result is cached per `targetPath` and invalidated on any forward/contents
   * change (see `indexFile` / `removeFromBasenames` / `updateFile`). This is
   * the hottest O(vault) path — before caching it ran on every
   * backlinks-panel refresh, including every keystroke's debounced
   * updateFile → notify → refresh chain.
   */
  getUnlinkedMentions(targetPath: string): BacklinkHit[] {
    const norm = normalizeSlashes(targetPath);
    const cached = this.unlinkedCache.get(norm);
    if (cached) return cached;

    const needle = stripExt(basename(norm));
    if (!needle) {
      this.unlinkedCache.set(norm, []);
      return [];
    }
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "gi");

    const out: BacklinkHit[] = [];
    for (const [source, content] of this.contents) {
      if (source === norm) continue; // skip self
      const wikiRanges = this.forward.get(source) ?? [];
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        // Skip if the match falls inside an existing wiki link range.
        const insideLink = wikiRanges.some((wl) => start >= wl.from && end <= wl.to);
        if (insideLink) continue;
        out.push({
          sourcePath: source,
          target: needle,
          from: start,
          to: end,
          snippet: snippetAround(content, start, end),
        });
      }
    }
    this.unlinkedCache.set(norm, out);
    return out;
  }

  /** All source files (absolute paths) currently in the index. */
  getAllFiles(): string[] {
    return [...this.contents.keys()];
  }

  /**
   * Resolve a wiki-link name from a source file to an absolute target path.
   * Order: exact match → relative to source dir → same-dir basename → global
   * unique basename. Returns null when no candidate fits.
   */
  resolve(name: string, fromPath: string | null | undefined): string | null {
    return this.resolveFromMaps(name, fromPath, this.contents, this.byBasename);
  }

  private resolveFromMaps(
    name: string,
    fromPath: string | null | undefined,
    contents: Map<string, string>,
    byBasename: Map<string, Set<string>>,
  ): string | null {
    if (!name) return null;
    // Strip Obsidian anchors — `#heading` and `^blockid` are navigation hints,
    // not part of the file identity. v1 resolves to the underlying file; v2
    // will honor the anchor. Without this strip, `[[Foo#Bar]]` is treated as
    // a literal filename and falsely reports unresolved.
    const bare = stripAnchor(name);
    if (!bare) return null;
    name = bare;
    const normFrom = fromPath ? normalizeSlashes(fromPath) : null;
    const candidates = contents;

    // Rule 1 — exact absolute path.
    if (candidates.has(name)) return name;
    const normName = normalizeSlashes(name);
    if (candidates.has(normName)) return normName;

    // Rule 2 — relative path joined with the source directory.
    if (normFrom) {
      const dir = dirname(normFrom);
      const joined = joinPath(dir, normName);
      if (candidates.has(joined)) return joined;
      const joinedMd = joined.endsWith(".md") ? joined : `${joined}.md`;
      if (candidates.has(joinedMd)) return joinedMd;
    }

    // Rule 3 — same-directory basename.
    if (normFrom) {
      const dir = dirname(normFrom);
      const bn = stripExt(basename(normName)).toLowerCase();
      const bucket = byBasename.get(bn);
      if (bucket) {
        for (const abs of bucket) {
          if (dirname(abs).toLowerCase() === dir.toLowerCase()) return abs;
        }
      }
    }

    // Rule 4 — globally unique basename.
    const bn = stripExt(basename(normName)).toLowerCase();
    const bucket = byBasename.get(bn);
    if (bucket && bucket.size === 1) {
      return [...bucket][0];
    }

    return null;
  }

  subscribe(listener: LinkIndexListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private createEmptySnapshot(): IndexSnapshot {
    return {
      forward: new Map(),
      backward: new Map(),
      contents: new Map(),
      byBasename: new Map(),
    };
  }

  private currentSnapshot(): IndexSnapshot {
    return {
      forward: this.forward,
      backward: this.backward,
      contents: this.contents,
      byBasename: this.byBasename,
    };
  }

  private commitSnapshot(next: IndexSnapshot): void {
    this.forward = next.forward;
    this.backward = next.backward;
    this.contents = next.contents;
    this.byBasename = next.byBasename;
    this.invalidateUnlinkedCache();
  }

  private notifyHandle: number | null = null;

  /**
   * Coalesce rapid notifications into a single rAF tick. Without this,
   * keystroke-driven updateFile calls would re-run every subscriber
   * (backlinks, suggestions, etc.) synchronously on every change — the
   * backlinks panel refresh then does heavy O(vault) work like
   * getUnlinkedMentions.
   */
  private notify(): void {
    if (this.notifyHandle != null) return;
    const raf: ((cb: () => void) => number) | undefined = (
      globalThis as { requestAnimationFrame?: (cb: () => void) => number }
    ).requestAnimationFrame;
    const schedule = raf ? (cb: () => void) => raf(cb) : (cb: () => void) => setTimeout(cb, 0) as unknown as number;
    this.notifyHandle = schedule(() => {
      this.notifyHandle = null;
      this.notifyNow();
    });
  }

  private notifyNow(): void {
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch {
        /* swallow */
      }
    }
  }

  private indexFile(rawPath: string, content: string): void {
    this.indexFileInto(this.currentSnapshot(), rawPath, content);
  }

  private indexFileInto(snapshot: IndexSnapshot, rawPath: string, content: string): void {
    const path = normalizeSlashes(rawPath);
    const matches = scanWikiLinks(content);
    snapshot.forward.set(path, matches);
    snapshot.contents.set(path, content);
    const bn = stripExt(basename(path)).toLowerCase();
    let bucket = snapshot.byBasename.get(bn);
    if (!bucket) {
      bucket = new Set();
      snapshot.byBasename.set(bn, bucket);
    }
    bucket.add(path);
  }

  private removeFromBasenames(rawPath: string): void {
    const path = normalizeSlashes(rawPath);
    const bn = stripExt(basename(path)).toLowerCase();
    const bucket = this.byBasename.get(bn);
    if (bucket) {
      bucket.delete(path);
      if (bucket.size === 0) this.byBasename.delete(bn);
    }
  }

  /**
   * Rebuild the backward map from scratch. O(E) where E is total outgoing
   * edges — used only by full `rebuild*` paths.
   */
  private rebuildBackward(): void {
    this.rebuildBackwardInto(this.currentSnapshot());
  }

  private rebuildBackwardInto(snapshot: IndexSnapshot): void {
    snapshot.backward.clear();
    for (const source of snapshot.forward.keys()) {
      this.addBackwardEdgesFromInto(snapshot, source);
    }
  }

  /**
   * Incremental: drop all backward edges originating from `source` and
   * re-emit them from the current `forward[source]`. Keeps per-keystroke
   * updates proportional to this file's link count.
   */
  private rebuildBackwardFor(source: string): void {
    this.removeBackwardEdgesFrom(source);
    this.addBackwardEdgesFrom(source);
  }

  private removeBackwardEdgesFrom(source: string): void {
    for (const [target, bucket] of this.backward) {
      const kept = bucket.filter((h) => h.sourcePath !== source);
      if (kept.length === 0) {
        this.backward.delete(target);
      } else if (kept.length !== bucket.length) {
        this.backward.set(target, kept);
      }
    }
  }

  private addBackwardEdgesFrom(source: string): void {
    this.addBackwardEdgesFromInto(this.currentSnapshot(), source);
  }

  private addBackwardEdgesFromInto(snapshot: IndexSnapshot, source: string): void {
    const matches = snapshot.forward.get(source);
    if (!matches) return;
    const content = snapshot.contents.get(source) ?? "";
    for (const m of matches) {
      const target = this.resolveFromMaps(m.target, source, snapshot.contents, snapshot.byBasename);
      if (!target) continue;
      let bucket = snapshot.backward.get(target);
      if (!bucket) {
        bucket = [];
        snapshot.backward.set(target, bucket);
      }
      bucket.push({
        sourcePath: source,
        target: m.target,
        from: m.from,
        to: m.to,
        snippet: snippetAround(content, m.from, m.to),
      });
    }
  }
}
