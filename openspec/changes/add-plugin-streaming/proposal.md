# Change: AI Token Streaming Delta Injection & Cursor Rendering (`add-plugin-streaming`)

## Why
Floatboat AI workflows requires low-latency, real-time token streaming from LLM backends (SSE / WebSockets) directly into Markdown document buffers. Nexus-Editor currently lacks a dedicated plugin to handle token delta insertions, animated shimmer typing cursors, and atomic history grouping.

## What Changes
- Add package `@floatboat/nexus-plugin-streaming` providing `createStreamingPlugin()`, `StreamingManager`, and `createStreamingExtension()`.
- Add CodeMirror `streamingSessionField` StateField for active session tracking and position mapping.
- Add `streamingDecorationPlugin` for rendering typing cursor widgets at insertion head.
- Add `appendChunk()` helper emitting atomic `userEvent: "ai-stream"` annotations for transaction grouping.

## Verification
- Run `pnpm test` ensuring `@floatboat/nexus-plugin-streaming` passes unit tests.
- Verify building with `pnpm --filter @floatboat/nexus-plugin-streaming build`.
