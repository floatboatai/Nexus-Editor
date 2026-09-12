# Change: Independent Selection Toolbar

## Why

Place formatting actions next to selected text and let applications enable each toolbar independently. Extract formatting from the original toolbar to avoid coupling UI lifecycles or duplicating implementations.

## What Changes

- Add `plugin-formatting` for shared formatting functions, commands, shortcuts, and color decorations.
- Add `plugin-selection-toolbar` for an independent floating UI with host-configured actions.
- Keep the global UI and compatibility entrypoints in `plugin-toolbar`, using shared formatting.
- Add cancellation to the existing command service; configure formatting and both toolbars independently in the demo.

See the [design](design.md) for architecture and core changes.

## Impact

Add two packages and update plugin API/runtime, reference-plugin configuration, and Electron demo integration. Core APIs remain unchanged. The demo provides link, inline code, and a text-color picker for one desktop body selection. New formatting semantics, tables, block code, touch selection, and additional secondary panels are outside its scope.
