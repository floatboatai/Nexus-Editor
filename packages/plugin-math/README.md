# @floatboat/nexus-plugin-math

KaTeX-powered inline and block math rendering for
[Nexus-Editor](https://github.com/floatboatai/Nexus-Editor).

## Install

```bash
pnpm add @floatboat/nexus-core @floatboat/nexus-plugin-math katex
```

KaTeX is a runtime dependency of the plugin, but applications that import its
stylesheet should also declare it directly. Import the stylesheet once from
your application entry point:

```ts
import "katex/dist/katex.min.css";
```

If your host does not bundle CSS imports, serve
`katex/dist/katex.min.css` as a regular stylesheet instead.

## Usage

```ts
import "katex/dist/katex.min.css";

import { createEditor } from "@floatboat/nexus-core";
import { createMathPlugin } from "@floatboat/nexus-plugin-math";

const editor = createEditor({
  container: document.getElementById("editor")!,
  initialValue: [
    "Euler's identity is $e^{i\\pi} + 1 = 0$.",
    "",
    "$$",
    "\\int_0^1 x^2 \\, dx = \\frac{1}{3}",
    "$$",
  ].join("\n"),
  livePreview: true,
  plugins: [createMathPlugin()],
});
```

The plugin registers `remark-math`, so both forms are parsed automatically:

```markdown
Inline: $E = mc^2$

$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
$$
```

## Editing formulas

- Inline formulas return to Markdown source when the editor cursor enters
  their source range.
- Block formulas expose an **Edit formula** button. It appears on pointer
  hover or keyboard focus and moves the cursor to the formula source.
- Invalid KaTeX input is rendered as an error instead of throwing from the
  editor render pipeline.

## Styling

The plugin adds these host classes in addition to KaTeX's own classes:

- `.nexus-math-inline`
- `.nexus-math-display`

They can be styled from the host application. The block edit button uses the
standard Nexus CSS variables `--nexus-bg`, `--nexus-border-subtle`, and
`--nexus-text-muted`, with built-in fallbacks.

## API

### `createMathPlugin(): NexusPlugin`

Creates a plugin containing the `remark-math` parser extension plus inline and
block widget definitions. The function has no options and does not mutate
global KaTeX configuration.

## License

MIT
