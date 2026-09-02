# Change: Add Slash Command ID Ranking

## Why

Slash command search currently considers display titles and keywords but ignores
the stable command `id`. Plugin authors therefore have to duplicate an id such as
`insert-table` or `heading-1` in `keywords` before users can discover the command
with that identifier. Treating ids as a first-class searchable field makes custom
and namespaced commands discoverable without redundant metadata.

## What Changes

- Match slash queries against command ids case-insensitively.
- Rank exact and prefix id matches alongside the equivalent title tiers, and id
  substring matches alongside title substring matches.
- Preserve empty-query registration order, deterministic tie-breaking, result
  limits, command objects, and input-array immutability.
- Document the expanded ranking contract and cover it in core and plugin tests.

## Impact

- Affected specs: editor-core slash command ranking
- Affected code:
  - `packages/core/src/slash-state.ts`
  - `packages/core/test/slash-state.test.ts`
  - `packages/plugin-slash/test/plugin-slash.test.ts`
  - `packages/plugin-slash/README.md`
- Compatibility: additive behavior only; public types and function signatures are
  unchanged.
