# Plugin: Word Color

Adds configurable per-word text coloring via a CodeMirror ViewPlugin.

Usage:

```ts
import { createWordColorPlugin } from "@floatboat/nexus-plugin-word-color";

const plugin = createWordColorPlugin({ initial: { words: { important: '#d73a49' }, caseSensitive: false } });

// Add to editor plugins
```