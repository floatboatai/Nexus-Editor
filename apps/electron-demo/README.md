# Nexus Electron Demo

This Electron demo includes an optional macOS-only inline completion path backed by Apple's Foundation Models framework.

## Foundation Models inline suggestions

Supported native completion: macOS 26+, Apple Silicon, and Apple Intelligence/Foundation Models available for the current user.

Prerequisites:

- Xcode Command Line Tools
- Swift toolchain
- `NODE_INCLUDE` set to the directory containing `node_api.h`

Example:

```bash
export NODE_INCLUDE="$(node -p 'const path=require(\"node:path\"); path.join(path.dirname(process.execPath), \"..\", \"include\", \"node\")')"
```

Build the native addon:

```bash
pnpm --filter @floatboat/nexus-electron-demo native:build
```

Run the app:

```bash
pnpm dev:electron-demo
```

The Electron demo build includes the native build step:

```bash
pnpm --filter @floatboat/nexus-electron-demo build
```

The build script cleans `dist-electron` first, then rebuilds the native addon, then runs the renderer build. That keeps the copied `.node` file in the packaged output.

Fallback behavior:

- non-macOS hides the setting;
- unsupported macOS disables the setting with a reason;
- a missing or failed native addon never blocks startup.

## Manual verification

On a supported Mac:

1. Build the addon with `pnpm --filter @floatboat/nexus-electron-demo native:build`.
2. Run `pnpm dev:electron-demo`.
3. Type at the end of a normal prose paragraph and wait 500 ms.
4. Confirm the suggestion appears inline in muted gray text after the paragraph.
5. Press Tab and confirm the suggestion is inserted into the document.
6. Confirm Undo removes the accepted suggestion in one step.
7. Confirm Escape clears a visible suggestion.
8. Confirm moving the cursor or editing before a late result returns does not show a stale suggestion.
9. Confirm Tab behavior is unchanged when no suggestion is visible, when text is selected, or when multiple cursors are active.
10. Disable Foundation Models suggestions in Settings and confirm no request/suggestion appears.
11. Confirm unavailable/null native results do not render a suggestion.
12. Open another document and confirm any previous suggestion is cleared.
13. Quit the application cleanly.
