# @floatboat/nexus-plugin-mermaid

Mermaid diagram rendering plugin for [Nexus-Editor](https://github.com/floatboatai/Nexus-Editor).

Renders fenced `mermaid` code blocks as SVG diagrams with hover-to-edit controls.

## Installation

```bash
pnpm add @floatboat/nexus-plugin-mermaid
```

## Usage

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createMermaidPlugin } from "@floatboat/nexus-plugin-mermaid";

const mermaidPlugin = createMermaidPlugin({
  theme: "default", // "default" | "dark" | "forest" | "neutral"
});

const editor = createEditor({
  container: document.getElementById("editor"),
  initialValue: "# Hello\n\n```mermaid\ngraph TD\n  A --> B\n```",
  plugins: [mermaidPlugin],
});
```

## Configuration

### `MermaidPluginOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `theme` | `"default" \| "dark" \| "forest" \| "neutral"` | `"default"` | Mermaid theme preset |
| `mermaidConfig` | `Record<string, unknown>` | — | Low-level [mermaid.initialize()](https://mermaid.js.org/config/schema-docs/config.html) overrides. Takes precedence over `theme`. |

### Runtime theme switching

Call `reconfigureMermaid()` when the host switches between light/dark mode:

```ts
import { reconfigureMermaid } from "@floatboat/nexus-plugin-mermaid";

// On theme change:
reconfigureMermaid({ theme: "dark" });
```

## How it works

- The plugin matches fenced `code` nodes where `lang === "mermaid"` via the widget system.
- On cursor-away, the code block is replaced by the rendered SVG diagram.
- Clicking the diagram (or its ✎ edit button) moves the cursor back into the source, revealing the raw mermaid text for editing.
- Invalid diagrams show an inline error message instead of crashing.

## License

MIT
