# @floatboat/nexus-plugin-mention

Headless `@mention` plugin for [Nexus-Editor](https://github.com/floatboatai/Nexus-Editor).

## Features

- **Trigger-based detection** — type `@` to open the mention menu
- **Async query** — debounced with `AbortController` cancellation
- **Full keyboard navigation** — `↑` `↓` `Enter` `Esc` `Tab`
- **ARIA accessible** — `role="listbox"`, `aria-selected`, `aria-activedescendant`
- **Headless DOM** — zero built-in CSS; host controls all styling via class hooks
- **AST round-trip** — `[@name](id)` ↔ `mention` mdast node via remark plugin
- **Live-preview widget** — renders styled chips when cursor is away from source

## Install

```bash
pnpm add @floatboat/nexus-plugin-mention
```

## Usage

### Basic

```ts
import { Editor } from "@floatboat/nexus-react";
import { createMentionPlugin } from "@floatboat/nexus-plugin-mention";

const mentionPlugin = createMentionPlugin({
  query: async (q) => {
    const res = await fetch(`/api/users?q=${encodeURIComponent(q)}`);
    return res.json();
  },
});

function App() {
  return (
    <Editor
      initialValue="Hello @alice"
      plugins={[mentionPlugin]}
      livePreview
    />
  );
}
```

### Configuration

```ts
const mentionPlugin = createMentionPlugin({
  trigger: "@",
  limit: 8,
  minQueryLength: 0,
  debounceMs: 150,
  flip: true,
  closeOnBlur: true,
  renderItem: (item, selected) => `<div class="my-row ${selected ? 'sel' : ''}">
    <img src="${item.avatar}" /> ${item.name}
  </div>`,
  insertFormat: (item) => `@${item.name}`,
});
```

### Styling (headless — bring your own CSS)

```css
.nexus-mention-menu {
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  max-height: 240px;
  overflow-y: auto;
  min-width: 200px;
}
.nexus-mention-item {
  padding: 8px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}
.nexus-mention-item-selected,
.nexus-mention-item:hover {
  background: #f0f4ff;
}
.nexus-mention-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #e8f0fe;
  color: #1a73e8;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.9em;
  cursor: pointer;
}
.nexus-mention-chip-avatar {
  width: 16px;
  height: 16px;
  border-radius: 50%;
}
```

## API

### `createMentionPlugin(config: MentionPluginConfig): NexusPlugin`

Factory function returning a `NexusPlugin` ready for the editor.

### `remarkMention`

The remark plugin that parses `[@name](id)` into `mention` mdast nodes.

### `stringifyMention(node)`

Serializes a `mention` node back to `[@name](id)`.

### `createMentionWidgetDefinition(options?)`

Builds a `WidgetDefinition` for live-preview rendering.

## Events

The plugin emits `mentionMenuChange` on the editor event bus:

```ts
editor.on("mentionMenuChange", (state: MentionMenuState) => {
  // state.isOpen, state.query, state.items, state.selectedIndex, state.coords
});
```

## License

MIT © floatboat
