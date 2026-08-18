# Change: Add debounced auto-save plugin

## Why
Hosts wiring Nexus-Editor into a notes / CMS backend must persist edits.
The core README already warns that `onChange` needs manual debouncing,
so every integrator re-implements the same timer dance. A first-party
`plugin-autosave` removes that boilerplate and gives one tested,
documented primitive.

## What Changes
- Add `@floatboat/nexus-plugin-autosave` exporting `createAutoSavePlugin`.
- Debounces document changes by a configurable `delay` (default 1000ms).
- Calls `onSave(markdown)` with the latest source; `flush()` forces an
  immediate save; `destroy()` cancels pending work.
- No new runtime dependencies (only `@floatboat/nexus-core` via workspace).

## Impact
- Affected specs: autosave
- Affected code: `packages/plugin-autosave`
