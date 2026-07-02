# Change: Update the Electron workspace shell

## Why
The Electron demo exposes the right editor capabilities, but its default browser-like styling does not present them as a cohesive desktop workspace. The supplied reference establishes a clearer hierarchy for file actions, panel controls, navigation, editing, outline, and backlinks.

## What Changes
- Restyle the Electron demo as a compact four-column writing workspace.
- Replace emoji utility controls with consistent monochrome SVG icons.
- Expose pressed state for panel toggle buttons.
- Align panel headers, empty states, editor toolbar, gutters, and status line with the reference layout.
- Preserve all existing file, vault, search, settings, outline, and backlink behavior.

## Impact
- Affected specs: electron-demo workspace shell
- Affected code: `apps/electron-demo/src/renderer/app.ts`, renderer panels, and `style.css`
- No changes to package APIs, persistence, or Electron IPC
