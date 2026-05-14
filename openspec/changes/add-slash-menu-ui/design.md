# Design — Slash Command Floating Menu

## Context

The slash subsystem in this repository has two halves:

1. **State machine** (`packages/core/src/slash-state.ts` + emission in `packages/core/src/editor.ts`): detects `/query` at the caret, filters command metadata, and emits `slashMenuChange` with caret coordinates from `view.coordsAtPos(...)`. This is fully working and unit-tested.
2. **Plugin shell** (`packages/plugin-slash`): re-exports a near-duplicate of the same helpers plus a `createSlashPlugin(commands)` factory whose only job is to plant a `slashCommands` array on a `NexusPlugin`.

What does not exist:
- An executable `run` field on `SlashCommandDef` — host applications must keep their own `id → handler` registry.
- A UI consumer of the `slashMenuChange` event.
- Ranking / capping of the filtered list. With many registered commands the menu would either render everything or rely on lexicographic order; both are bad UX.
- Any consumer (electron demo or framework binding) that actually registers slash commands. The `plugin-toolbar` already implements every formatting action as an `(editor) => boolean` function but never declares them as slash commands.

`ROADMAP.md` row #3 — "Slash command sorting + limit" — has been parked as `P0 / planned` for the same reason: it cannot land in isolation while the surface is unused.

## Goals / Non-Goals

### Goals
- Restore the round-trip: typing `/h2⏎` inserts a `## ` heading at the caret position in the electron demo.
- Provide a single floating menu UI that is framework-agnostic, works in plain DOM, and is consumed identically from the React/Vue bindings once they pick it up.
- Implement deterministic ranking + a configurable result cap so that hosts with 30+ commands stay responsive and predictable.
- Allow each plugin to ship its slash commands self-contained (metadata + `run`) so the demo registers the toolbar without a side-band action map.
- Keep the change backward compatible: every new field is optional; every existing test contract holds.

### Non-Goals
- Mobile / touch interactions (the demo is Electron desktop).
- Slash menu rendering inside live-preview widgets such as table cells.
- Persistent "recents" sorting (requires storage hooks not yet specified).
- Replacing or unifying the duplicated `slash-state` helpers between `core` and `plugin-slash` — left in lock-step deliberately; future PR can DRY this up after `core` exports `computeSlashState`.

## Decisions

### Decision 1: Where does `run` live?

Adopted: **Optional `run?: (editor: EditorAPI) => boolean | void` on `SlashCommandDef`**.

Rationale:
- Mirrors the existing `shortcuts: Array<{ key, run: (editor) => boolean }>` shape on `NexusPlugin`. Hosts already understand that pattern.
- Stays optional so the existing tests (which pass commands without `run`) continue to pass.
- The menu UI accepts a host-level `onCommand(cmd, ctx)` override; when neither is provided, the menu simply closes after replacing the trigger text — matching the headless principle.

Alternatives considered:
- A separate `slashHandlers` map on `NexusPlugin` keyed by `id`. Rejected: two arrays must stay in sync, more boilerplate at plugin authoring time.
- Host-only action map. Rejected: the demo would have to duplicate every formatting helper signature, defeating the point of bundling slash commands inside `plugin-toolbar`.

### Decision 2: Ranking algorithm

Adopted: a deterministic five-tier score, computed in `O(commands)` per emission.

```
score(cmd, query):
  q = query.toLowerCase()
  title = cmd.title.toLowerCase()
  if q is empty:                       return [0, registration_index]   (keep input order)
  if title === q:                      return [500, 0]                  (exact)
  if title.startsWith(q):              return [400, title.length]       (title prefix; shorter wins)
  for kw in cmd.keywords:
    if kw.toLowerCase() === q:         return [350, 0]                  (exact keyword)
  if title.includes(q):                return [300, title.indexOf(q)]   (title substring; earlier wins)
  for kw in cmd.keywords:
    if kw.toLowerCase().startsWith(q): return [200, kw.length]          (keyword prefix)
  for kw in cmd.keywords:
    if kw.toLowerCase().includes(q):   return [100, kw.indexOf(q)]      (keyword substring)
  return null                          (filter out)
```

Sorted descending by `score`, then ascending by tiebreaker, then ascending by title for stability. Pure function; no allocations beyond the result array; deterministic across runs (critical for snapshot-friendly tests).

Alternatives considered:
- **Fuzzy matching (fzy / fzf-style)**: powerful but introduces a dependency and a much higher cognitive load for a `P0` ticket whose name literally is "sorting + limit". Logged as a follow-up under ROADMAP P2 #17 ("Fuzzy search").
- **Levenshtein distance**: slow on long titles; unnecessary given the prefix/substring tiers above already cover the common case.

### Decision 3: Where does `limit` apply?

Adopted: **In core (`computeSlashState`) with a default of 8**, configurable via `EditorConfig.slashMenuLimit`. The UI does not re-trim.

Rationale: single source of truth. The `slashMenuChange` event always delivers exactly what the menu should render. Hosts that want a different cap configure the editor once.

Alternative considered: limit lives on the UI. Rejected — splits the contract across two packages and forces hosts to override in two places.

### Decision 4: Menu lifecycle

The UI subscribes to `slashMenuChange` on construction and to `blur`/window `resize` for dismissal. It owns one DOM root attached to `document.body` (or the `container` option) and never reparents — only toggles `display`. Items are recycled across renders to keep CSS transitions stable.

On confirm:
1. Replace the document range `[state.from, state.to]` with the empty string via `editor.replaceSelection` after re-selecting that range. The trigger `/query` text is removed before the command runs, so commands like "insert heading" don't have to know about the slash trigger.
2. Re-focus the editor.
3. Call `cmd.run(editor)` if present; otherwise call `options.onCommand?.(cmd, ctx)`; otherwise no-op.
4. Hide the menu.

The replace step uses `view.dispatch` indirectly via the public `EditorAPI` — no internal CM6 leakage.

### Decision 5: IME safety

`compositionstart` and `compositionend` are wired on `document` (not just the menu) because the input target is the editor's `contentDOM`, not the menu DOM. While `isComposing` is true the menu suppresses `keydown` handling entirely; once composition ends, the next `slashMenuChange` will refresh state from the post-composition document. This matches the pattern proven in `wikilinks.ts` autocomplete.

### Decision 6: Coordinate flipping

Default placement: top edge of the menu aligns with `state.coords.bottom + 4px`, left edge with `state.coords.left`. If `menu.getBoundingClientRect().bottom > window.innerHeight - 8`, flip to `state.coords.top - menu.height - 4px`. Horizontal overflow on the right edge clamps the left coordinate (subtract overflow, min 8px). No "smart middle" placement — desktop screens have plenty of room.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Duplicated `slash-state` helpers in `core` and `plugin-slash` drift apart | Both ship with the same ranking suite; we add a regression test that exercises the same fixture against both copies. A follow-up PR can re-export from core. |
| `view.coordsAtPos` returns null while the doc is mid-layout | Already guarded by `try/catch` in `editor.ts`; menu treats `coords === null` as "stay hidden this tick". |
| Long command lists explode rendering | Default `limit: 8` plus `O(commands)` ranking keeps the worst case bounded for any realistic registration count. |
| Confirming a command while live-preview replace decorations cover the trigger range | The trigger text `[from, to]` is always raw source (slash + query, never inside a widget), so the replace happens against source markdown and live-preview rebuilds on the next state update. Tested in `events.test.ts`. |
| Menu key handlers steal `Tab` from the editor's `indentWithTab` keymap | Menu only swallows `Tab` when `isOpen === true`, otherwise CM6 receives it normally. |

## Migration Plan

None — pure addition. Existing editors without slash commands behave exactly as today. Existing tests pass without modification (the optional `run` field has no effect on the comparison-by-value test in `plugin-slash.test.ts`; the new ranking changes the order of filtered results, so we extend that test fixture to assert the new ordering explicitly).

## Open Questions

- Should the menu close automatically when the user clicks into a different `BrowserWindow`? Current decision: yes via the editor's existing `blur` event. Worth confirming with the maintainer.
- Should `Tab` and `Enter` both confirm, or only `Enter`? Notion and Obsidian use both; VS Code only uses `Enter`. Going with both for muscle-memory parity; can be made configurable later.
