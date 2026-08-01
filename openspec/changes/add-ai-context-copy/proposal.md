# Change: Add AI context copy action

## Why
The Electron demo already models a local-first Markdown vault with outline and backlink context, but users still need to manually gather that context before asking an AI assistant for help. A one-click context bundle makes the demo better express Nexus as an AI-native writing surface without introducing an external AI dependency.

## What Changes
- Add an Electron demo toolbar action for copying the active note's AI-ready context.
- Include the active note path, document stats, selected text, outline, backlinks, unlinked mentions, and Markdown source.
- Keep the feature host-side only: no public core API changes and no network calls.

## Impact
- Affected specs: `electron-demo`
- Affected code: `apps/electron-demo/src/renderer/app.ts`, `apps/electron-demo/src/renderer/ai-context.ts`, `apps/electron-demo/electron/preload.ts`, `apps/electron-demo/src/renderer/bridge.d.ts`
