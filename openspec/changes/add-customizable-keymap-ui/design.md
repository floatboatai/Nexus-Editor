## Context

Keybindings today live in three places (`NexusPlugin.shortcuts[]`, `EditorCommand.hotkey`, the built-in markdown keymap) and are resolved at editor construction. Users can't rebind anything without forking the plugin that owns the shortcut, and hosts can't build an "Obsidian-style hotkey settings" panel because they have no way to enumerate the current bindings or inject overrides.

Roadmap #14 (P2, `docs/ROADMAP.md`) blocks the SDK-level settings UI on "expose keymap register / query API first" — this proposal is that API.

## Goals / Non-Goals

**Goals**
- Enumerate every active binding with a stable identifier and its source (which plugin / command / built-in module contributed it).
- Let hosts apply a user-override layer on top of the plugin defaults without touching plugin code.
- Emit an event when overrides change so the settings UI can stay in sync.
- Keep existing plugin authoring model working unchanged when no overrides are set.

**Non-goals**
- Rendering the settings UI itself (React/Vue components ship in a separate proposal once the core API is stable).
- Persisting user overrides. The core accepts a snapshot per call; hosts persist wherever they persist the rest of their settings.
- Chord / multi-step bindings.
- Command-palette / fuzzy search over bindings (a natural next step, but orthogonal).

## Decisions

**Decision 1: Override layer instead of a mutable registry.**
Overrides are applied as a merge on top of the immutable "plugin-declared" layer, not by mutating the plugin data. Rationale: plugins may be re-registered (hot reload — Roadmap #11), and treating the plugin layer as immutable keeps that story clean. `setUserKeybindings([])` restores defaults with one call.

Alternatives considered:
- Mutable registry with `addBinding` / `removeBinding` — flexible but every consumer would need to reason about interleaving. Rejected.
- Per-plugin override endpoint — locks users to whatever plugins choose to expose. Rejected.

**Decision 2: Stable id is `plugin:name/command:id` (or `plugin:name/shortcut:index` when a plugin declares raw shortcuts without an id).**
Deterministic, human-readable in a settings UI, and stable across editor recreations. Alternatives (opaque UUIDs, integer indices) either look bad in URLs / settings JSON or drift when plugins are reordered.

**Decision 3: Conflicts are surfaced, not resolved silently.**
When two entries map to the same key after override merge, both entries carry the other in a `conflicts` array. The dispatch path still needs a winner — we keep the current "last-registered wins" tiebreak because changing it would silently break existing plugins — but the settings UI can now warn the user.

**Decision 4: `getKeybindings()` returns a fresh array each call.**
Cheap (bindings are tens, not thousands, and the array is a fresh flat map), and it sidesteps the whole "did I mutate cached state?" class of host bugs. If profiling shows this becomes hot for a large plugin set, we can memoize until the next `keybindingsChange`.

## Risks / Trade-offs

- **CM6 keymap recompilation cost on every override change.** Using `Compartment.reconfigure` is the intended path and CM6 handles this cheaply; still worth benchmarking with the full default plugin set before merging. Mitigation: batch multiple overrides into one `setUserKeybindings` call (the API already forces a snapshot rather than incremental adds).
- **Silent dispatch tiebreak semantics preserved.** Some users may expect "the override wins deterministically" — we do that for the *override* layer but not for plugin-vs-plugin ties. Documented explicitly in the spec.
- **`id` format is public surface.** Once shipped, changing the id scheme breaks persisted user overrides. Called out in the spec so future refactors don't drift.

## Migration Plan

None — additive change. Existing consumers of `shortcuts` / `commands[].hotkey` see identical behavior when no overrides are set. Plugins that currently rely on collision-by-order will surface as `conflicts` entries but continue to dispatch the same way.

## Open Questions

- Should `getKeybindings()` include the built-in markdown keymap (Enter list continuation, tab indent) as read-only entries, or hide them from override entirely? Leaning **include, mark `override: false`** so the settings UI is honest about what's not rebindable, but flagging for review.
- How do we surface CodeMirror's platform normalization (`Mod-` → `Cmd-`/`Ctrl-`)? Return the raw declared string and let the UI render; alternate is to return both. Punt to implementation.
