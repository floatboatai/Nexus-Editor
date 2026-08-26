# Design: Host keybinding registry

## Context
CodeMirror 6 resolves conflicting keymap handlers by extension precedence (earlier extensions win) and, within one `keymap.of`, by entry order. The editor already has three static keymap layers installed in a fixed array order (`markdownKeymap` at `Prec.high`, then plugin `shortcuts`, then command `hotkey`s), plus a dynamic contribution pipeline that appends owner-scoped `Compartment`s after all static extensions and defers reconfiguration during IME composition, mouse gestures, and table editing.

The new registry must answer two questions without breaking any of that:
1. Where do runtime host bindings sit in the precedence graph?
2. How can hosts learn what is effectively bound?

## Goals / Non-Goals
- Goals: owner-scoped register/dispose, deterministic duplicate-key resolution, a queryable unified snapshot, zero behavior change for non-users.
- Non-Goals: no UI, no user-facing settings surface (ROADMAP #14's second step), no rebinding of built-in Markdown semantics, no cross-instance coordination.

## Decisions

### Decision: reuse the dynamic contribution pipeline, not a new reconfiguration path
Keybindings live in their own compartment inside `DynamicEditorContributionSink` and flush through the existing version/waiter/scheduleFlush machinery. This inherits the interaction-deferral guarantees (IME composition, drag gestures, table editing sessions) that CLAUDE.md documents as hard-won — hand-rolling a second reconfiguration path would reintroduce exactly the mid-interaction DOM-teardown bugs the pipeline exists to prevent.

### Decision: two precedence buckets, mapped from the priority sign
- `priority > 0` → wrapped in `Prec.high`. Lands after the static `Prec.high` block (built-in Markdown Enter keeps winning ties by array position) but above all default-precedence static keymaps, so hosts can preempt plugin shortcuts for user remapping.
- `priority <= 0` (default 0) → plain `keymap.of` appended with dynamic contributions, i.e. below every static keymap. Opt-in behavior only; hosts that merely add bindings never disturb existing ones.

Alternatives considered:
- Single flat bucket with no preemption power — simpler, but cannot express "user overrode Mod-k", which is the primary roadmap use case.
- Fine-grained Prec mapping per numeric priority — CM6 has three named tiers; inventing a numeric illusion of continuum would document worse than it behaves. Sign-based split matches observable reality.

Within each bucket, entries sort by priority descending then registration sequence ascending — the same comparator convention as DOM-event hooks.

### Decision: allow duplicate keys, resolve deterministically
Two owners may register the same key. CM6 runs the highest-precedence handler first; a handler returning falsy falls through to the next. The snapshot exposes the effective order so conflict UI can be built by the host. Throwing on duplicates was rejected because legitimate coexistence (progressive enhancement by multiple plugins) is common and an exception would force hosts to track global state.

### Decision: query returns one flat ordered snapshot, not per-source maps
`getKeybindings()` returns builtin → host(positive) → plugin-shortcut → plugin-command → host(non-positive). That mirrors actual CM6 resolution order given the installation topology, so the array index *is* the precedence. Owners are attributed (`nexus-core`, plugin name, or caller-supplied `ownerId`). Snapshot entries are plain data — no live handles leak out.

## Risks / Trade-offs
- A host binding at positive priority shadowing a plugin hotkey can surprise plugin authors → mitigated by documentation plus the snapshot API making shadowing detectable.
- The snapshot is point-in-time; hosts mutating bindings should re-read after `ready` promises settle → documented on the method.

## Migration Plan
Purely additive. Rollback = revert the commit; no persisted state, no config schema changes.

## Open Questions
- None blocking; per-keybinding `scope` filtering (e.g. "only inside tables") is deliberately deferred until a concrete need appears.
