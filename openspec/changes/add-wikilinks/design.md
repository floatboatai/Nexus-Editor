# Design: Wiki Links

## Context

Nexus core is intentionally path-agnostic — it operates on markdown strings and an mdast AST, not on filesystem resources. Wiki links, by contrast, are resource references: `[[MyNote]]` only has meaning inside a vault. The design challenge is to keep the core extension resource-agnostic (pure rendering + callbacks) while the Electron host supplies vault-specific resolution and navigation behavior.

An additional constraint comes from the recent live-preview click-drift invariants (see `CLAUDE.md` + commits `3cf8c6b` / `5ec8daf` / `b73abef`): decorations MUST be height-neutral. Any new inline rendering for `[[...]]` must therefore use `Decoration.mark` (never `Decoration.replace` with a custom widget that has a different line-height than surrounding text).

## Goals / Non-Goals

Goals:
- `[[target]]` and `[[target|alias]]` render as inline pills with resolved/unresolved styling.
- Cursor on the wikilink's line reveals `[[ ]]` brackets; cursor off hides them.
- Click navigates via host-supplied callback; unresolved clicks create the target file.
- Autocomplete triggers after `[[` and suggests from a host-supplied candidate list.
- Vault-wide backlinks panel shows who links to the currently-open file, with a one-line context snippet.
- Incremental updates: editing the active buffer updates the index immediately; file-watch events trigger index diff.

Non-goals (explicit for this change):
- `[[target#heading]]` heading anchors.
- `[[target^block-id]]` block references.
- Renaming a file propagating to all `[[...]]` references across the vault.
- Graph view.
- Frontmatter aliases.

## Decisions

### D1 — Regex-based scanner, not an mdast extension
**Decision:** Parse `[[...]]` with a single document-wide regex inside `wikilinks.ts` rather than adding a remark/micromark extension.

**Rationale:**
- mdast extension requires adding micromark-extension-wiki-link (new dep, maintained by a third party), and would wire into the shared AST used by TOC / widgets / export.
- We only need the offsets for decorations — we don't need wikilinks to appear as mdast nodes elsewhere in the editor (HTML export deliberately falls back to bare `[[...]]` text for v1; can switch to a real mdast node later without breaking consumers).
- Matches the existing precedent: `collectImageRanges` in `live-preview-ranges.ts:68-94` also uses a regex scanner rather than going through mdast.

**Pattern:**
```
/(?<!\\)\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]+))?\]\]/g
```
- Disallow newlines and nested brackets in target/alias.
- Backslash escape (`\[[`) skips the match.

### D2 — `Decoration.mark` only, no block widget
**Decision:** Render resolved/unresolved state via mark decorations. Hide `[[` / `]]` via `Decoration.replace` with an empty replace (zero-width), matching the pattern used for bold/italic markers in `live-preview.ts:549-560`.

**Rationale:** Preserves the height-neutral invariant documented in `live-preview.ts:283-293`. Any widget-replace would change line height and trigger the click-drift pathology that was fixed last week.

### D3 — Resolver + navigator are callbacks, not hardcoded
**Decision:** `createWikilinksExtension({ resolve, onNavigate, suggest })` where each option is an optional function. The core package contains zero filesystem logic.

**Rationale:**
- Keeps core package pure (matches `add-note-vault` proposal: "No changes to @floatboat/nexus-core — the core editor remains path-agnostic; vault is host-side only").
- Enables alternative hosts (browser-only, web, iOS) to inject their own resolution strategies.

### D4 — Resolution order matches Obsidian's "shortest path when possible"
**Decision:** `resolve(name, fromPath)` tries, in order:
1. Exact absolute path equals `name`.
2. Path joined with `dirname(fromPath)` matches an indexed file.
3. Basename (with or without `.md` extension) uniquely identifies one file globally.
4. Basename matches a file in the same directory as `fromPath`.
5. Otherwise unresolved.

**Rationale:** Obsidian's default. Users expect `[[MyNote]]` to "just work" when globally unique, with disambiguation via relative-path only when needed.

### D5 — Live index update on editor change, not only on file save
**Decision:** `onChange` in editor-shell calls `linkIndex.updateFile(activeFile, content)` on every keystroke (debounced via the existing `parseDelayMs`).

**Rationale:** Users expect the backlinks panel to react immediately when typing `[[...]]`, not only after save. The extra CPU cost is bounded — the scanner runs in O(n) over the single buffer, and the index update is a hash swap per file.

### D6 — Seed the index via a one-shot `vault:read-all` IPC
**Decision:** On vault open, read every markdown file's contents once through a single IPC roundtrip, not N round-trips via `vault:read`.

**Rationale:** A vault of 1000 notes × a single IPC per note is ~100 ms of measurable UI block. One bulk call amortizes that. Watcher events still use targeted reads.

## Risks / Trade-offs

- **Regex misses edge cases.** Nested `[[[[...]]]]` or markdown code spans containing `[[...]]` will still be detected. Mitigation: the decoration is still a mark (non-destructive), so the worst case is a spurious click target inside a code block — acceptable for v1, resolvable in v2 by checking `inlineCode` ranges from the existing mdast before emitting decorations.
- **Large vault perf.** Index rebuild is O(total markdown bytes). Mitigation: `vault:read-all` runs once at startup; incremental updates are O(single-file size). For >5k files we would move to Web Worker; tracked as a v2 follow-up, not blocking.
- **Widget-less unresolved style.** Unresolved links use a dashed-underline mark instead of a distinct block element. Users might not notice the visual difference as quickly as in Obsidian. Mitigation: accent color difference (muted red) + distinct cursor style (pointer for resolved, help for unresolved) should be enough for MVP feedback.
- **File creation on unresolved click.** Auto-creating the file when the user clicks an unresolved link is convenient but changes filesystem state. Mitigation: route through existing `vault:create-file` which validates path-escape and handles name collisions; the visible tree refreshes via the existing watcher.

## Migration Plan

None required — the change is purely additive. Existing editors without the plugin behave identically to today.

## Open Questions

- Should unresolved click auto-create, or prompt first? MVP: auto-create in the directory of the currently-active file. Rationale: matches Obsidian default. Escape hatch: user can delete the file after accidental creation via the vault panel's existing delete-to-trash.
- Should the backlinks panel position be bottom (Obsidian) or right-side like the outline? MVP: follow the outline pattern (right-side secondary panel) for consistency with existing UI. Can re-theme later.
