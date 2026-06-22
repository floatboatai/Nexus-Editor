import { describe, expect, it } from "vitest";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { scanWikiLinks } from "@floatboat/nexus-core";
import { LinkIndex, findAnchorPosition, parseAnchor } from "../src/renderer/link-index";

const VAULT_ROOT = path.resolve(__dirname, "../sample-vault");
const SUPPORTED = new Set([".md", ".markdown", ".txt"]);
const SKIP_DIRS = new Set(["node_modules", ".git"]);

function normalizeTestPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function vaultPath(relPath: string): string {
  return normalizeTestPath(path.join(VAULT_ROOT, relPath));
}

function vaultRelative(filePath: string): string {
  return normalizeTestPath(path.relative(VAULT_ROOT, filePath));
}

async function collect(dir: string, acc: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      await collect(p, acc);
    } else if (e.isFile() && SUPPORTED.has(path.extname(e.name).toLowerCase())) {
      acc.push(p);
    }
  }
}

async function buildIndex(): Promise<LinkIndex> {
  const paths: string[] = [];
  await collect(VAULT_ROOT, paths);
  const files = await Promise.all(
    paths.map(async (p) => ({ path: p, content: await readFile(p, "utf-8") }))
  );
  const idx = new LinkIndex();
  idx.rebuild(files);
  return idx;
}

async function readFixtureFiles(): Promise<Array<{ path: string; content: string }>> {
  const paths: string[] = [];
  await collect(VAULT_ROOT, paths);
  return Promise.all(paths.map(async (p) => ({ path: p, content: await readFile(p, "utf-8") })));
}

/**
 * These tests verify that the sample vault ships a topology that exercises
 * every wiki-link behavior we care about: resolved/unresolved, aliases,
 * globally-unique basenames, same-directory collisions, and the hub note.
 * If a maintainer breaks the fixture content, these tests fail.
 */
describe("sample-vault fixture — end-to-end wiki-link behavior", () => {
  it("the vault directory exists and contains the hub", async () => {
    const st = await stat(path.join(VAULT_ROOT, "index.md"));
    expect(st.isFile()).toBe(true);
  });

  it("every note links back to index.md (hub topology)", async () => {
    const idx = await buildIndex();
    const hub = path.join(VAULT_ROOT, "index.md");
    const hits = idx.getBacklinks(hub);
    const sources = new Set(hits.map((h) => vaultRelative(h.sourcePath)));
    // README is documentation, not a note that must link in; every *other*
    // markdown file should.
    const expected = [
      "Daily/2026-04-20.md",
      "People/Alice.md",
      "People/Bob.md",
      "Projects/Ideas.md",
      "Projects/Nexus-Editor.md",
      "Topics/AI.md",
      "Topics/Testing.md",
      "ghost-demo.md",
      "personal/Diary.md",
      "personal/Meeting.md",
      "work/Inbox.md",
      "work/Meeting.md",
    ];
    for (const e of expected) expect(sources.has(e)).toBe(true);
  });

  it("[[AI]] from Daily resolves to Topics/AI.md (globally unique basename)", async () => {
    const idx = await buildIndex();
    const daily = path.join(VAULT_ROOT, "Daily/2026-04-20.md");
    expect(normalizeTestPath(idx.resolve("AI", daily) ?? "")).toBe(vaultPath("Topics/AI.md"));
  });

  it("[[Meeting]] from work/Inbox.md resolves to work/Meeting.md (same-dir wins)", async () => {
    const idx = await buildIndex();
    const inbox = path.join(VAULT_ROOT, "work/Inbox.md");
    expect(normalizeTestPath(idx.resolve("Meeting", inbox) ?? "")).toBe(vaultPath("work/Meeting.md"));
  });

  it("[[Meeting]] from personal/Diary.md resolves to personal/Meeting.md (symmetric)", async () => {
    const idx = await buildIndex();
    const diary = path.join(VAULT_ROOT, "personal/Diary.md");
    expect(normalizeTestPath(idx.resolve("Meeting", diary) ?? "")).toBe(vaultPath("personal/Meeting.md"));
  });

  it("[[Ghost Note]] in ghost-demo.md is unresolved (creates-on-click scenario)", async () => {
    const idx = await buildIndex();
    const ghost = path.join(VAULT_ROOT, "ghost-demo.md");
    expect(idx.resolve("Ghost Note", ghost)).toBeNull();
    expect(idx.resolve("NonExistent", ghost)).toBeNull();
  });

  it("escape sequence \\[[NotALink]] is not indexed", async () => {
    const idx = await buildIndex();
    // NotALink should not be resolvable via any rule — it must never appear
    // as a valid target because the scanner skipped it.
    expect(idx.resolve("NotALink", path.join(VAULT_ROOT, "ghost-demo.md"))).toBeNull();
    // And no file's forward edges include a "NotALink" target.
    for (const source of idx.getAllFiles()) {
      const hits = idx.getBacklinks(source);
      for (const h of hits) {
        expect(h.target).not.toBe("NotALink");
      }
    }
  });

  it("aliased links still resolve by target, not alias", async () => {
    const idx = await buildIndex();
    const files = await readFixtureFiles();
    const resolvedAliasLinks = files.flatMap((file) =>
      scanWikiLinks(file.content)
        .filter((match) => match.alias && match.alias !== match.target)
        .map((match) => ({ file, match, resolved: idx.resolve(match.target, file.path) }))
        .filter((entry): entry is typeof entry & { resolved: string } => entry.resolved != null)
    );

    // This validates the fixture behavior without binding the test to one
    // easy-to-edit note such as Daily/2026-04-20.md. The sample vault only
    // needs at least one resolvable alias link; whichever one exists must be
    // indexed as a backlink to the target side, never the display alias.
    expect(resolvedAliasLinks.length).toBeGreaterThan(0);
    for (const { file, match, resolved } of resolvedAliasLinks) {
      const hits = idx.getBacklinks(resolved);
      expect(hits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourcePath: normalizeTestPath(file.path),
            target: match.target,
          }),
        ])
      );
    }
  });

  it("Testing.md shows linked backlinks from current sample-vault references", async () => {
    const idx = await buildIndex();
    const testingPath = path.join(VAULT_ROOT, "Topics/Testing.md");
    const linked = idx.getBacklinks(testingPath).map((m) => vaultRelative(m.sourcePath));
    expect(linked.length).toBeGreaterThan(0);
    expect(linked).toContain("Projects/Nexus-Editor.md");
  });

  it("Bob.md has an unlinked mention in Alice.md (plain text 'Bob' outside brackets)", async () => {
    const idx = await buildIndex();
    const bob = path.join(VAULT_ROOT, "People/Bob.md");
    const mentions = idx.getUnlinkedMentions(bob);
    const sources = mentions.map((m) => vaultRelative(m.sourcePath));
    expect(sources).toContain("People/Alice.md");
  });

  it("AI.md has an unlinked mention in Alice.md and Daily/2026-04-20.md has a linked one", async () => {
    const idx = await buildIndex();
    const ai = path.join(VAULT_ROOT, "Topics/AI.md");
    const unlinked = idx.getUnlinkedMentions(ai).map((m) => vaultRelative(m.sourcePath));
    const linked = idx.getBacklinks(ai).map((m) => vaultRelative(m.sourcePath));
    expect(unlinked).toContain("People/Alice.md"); // plain text "AI" in Alice.md
    expect(linked).toContain("Daily/2026-04-20.md"); // [[AI]] in the daily
  });

  it("v2-shaped anchors in Ideas.md resolve to the underlying file, not ghosts", async () => {
    const idx = await buildIndex();
    const ideas = path.join(VAULT_ROOT, "Projects/Ideas.md");
    expect(normalizeTestPath(idx.resolve("Projects/Nexus-Editor#Context", ideas) ?? "")).toBe(
      vaultPath("Projects/Nexus-Editor.md")
    );
    expect(normalizeTestPath(idx.resolve("Projects/Nexus-Editor^some-block", ideas) ?? "")).toBe(
      vaultPath("Projects/Nexus-Editor.md")
    );
  });

  it("#Context anchor in Ideas.md points into the real Context heading of Nexus-Editor.md", async () => {
    const nexus = path.join(VAULT_ROOT, "Projects/Nexus-Editor.md");
    const content = await readFile(nexus, "utf-8");
    const { anchor } = parseAnchor("Projects/Nexus-Editor#Context");
    expect(anchor).not.toBeNull();
    const pos = findAnchorPosition(content, anchor!);
    expect(pos).not.toBeNull();
    // Position must start with the Context heading line.
    expect(content.slice(pos!).startsWith("## Context")).toBe(true);
  });

  it("^some-block anchor in Ideas.md points into the tagged paragraph", async () => {
    const nexus = path.join(VAULT_ROOT, "Projects/Nexus-Editor.md");
    const content = await readFile(nexus, "utf-8");
    const { anchor } = parseAnchor("Projects/Nexus-Editor^some-block");
    expect(anchor).not.toBeNull();
    const pos = findAnchorPosition(content, anchor!);
    expect(pos).not.toBeNull();
    // Line should contain the block ref marker.
    const lineEnd = content.indexOf("\n", pos!);
    const line = content.slice(pos!, lineEnd === -1 ? undefined : lineEnd);
    expect(line).toContain("^some-block");
  });

  it("getAllNoteNames lists unique basenames including Meeting only once", async () => {
    const idx = await buildIndex();
    const names = idx.getAllNoteNames();
    // Duplicates dedup'd — "Meeting" (work vs personal) must appear once.
    expect(names.filter((n) => n === "Meeting")).toHaveLength(1);
    // Key notes present.
    for (const n of ["index", "AI", "Alice", "Bob", "Nexus-Editor", "Ideas", "ghost-demo"]) {
      expect(names).toContain(n);
    }
  });
});
