# Plugin Streaming Capability Spec

## Requirements

### R1: Token Stream Initialization
The plugin MUST allow starting a named streaming session at a specific document position.

#### Scenario: Initialize Session
- Given a CodeMirror editor instance
- When `startStream(view, "session-1", 10)` is invoked
- Then `streamingSessionField` MUST report `active: true` with `sessionId: "session-1"` and position `10`.

### R2: Delta Insertion
The plugin MUST append string chunks at the current stream head.

#### Scenario: Append Chunks
- Given an active streaming session at position `10`
- When `appendChunk(view, "session-1", "Hello")` is called
- Then document content at position `10` MUST be inserted with `"Hello"` and position mapped to `15`.

### R3: Typing Head Decoration
The plugin MUST render a visual typing cursor widget at the stream insertion head while active.

#### Scenario: Render Shimmer Widget
- Given an active streaming session
- When the view updates
- Then a widget decoration with class `.nexus-streaming-cursor` MUST be placed at `currentPos`.
