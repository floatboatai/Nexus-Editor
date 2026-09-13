# Change: A block drag plugin for easier content organization

## Why

Writers often capture ideas first and then adjust their order. They may move an explanation before an example or place a whole table after a conclusion. Today, this requires selecting text, cutting it, finding the destination, and pasting it. Lists, tables, and code also require checking that the selection includes all their content.

Block dragging lets users work directly with the content they see: find a block, drag it to a new position, and continue editing. A single undo restores its previous position, making content organization easier to correct.

For developers integrating Nexus, this is a reusable editing capability. Desktop browsers and Electron can share an implementation, while host applications only decide whether to enable it. Hosts do not need to implement Markdown range handling, dragging, and undo themselves. Providing an official plugin also keeps this interaction optional for hosts that do not need it.

## What Changes

The project already provides Markdown parsing, live preview, editing and undo, and plugin lifecycle support. This change builds on those capabilities to connect three user actions: identify complete content, choose a destination, and safely reorder it.

The first version moves one complete block at a time within the same document. It supports paragraphs, headings, lists, blockquotes, code, tables, and thematic breaks. Live preview and source mode use the same rules, with equivalent keyboard operations. Electron enables the plugin by default; library consumers opt in.

## Non-Goals

The first version focuses on content order. It does not include touch input, moving multiple blocks or content between documents, moving whole sections, changing nesting, reordering items within a list, columns, or block menus. A heading moves by itself; lists and blockquotes move as complete units. Future capabilities require separate evaluation so this plugin does not become a new document model.

## Impact

Add `@floatboat/nexus-plugin-block-drag` and integrate it with the official plugin collection and Electron. Reuse core parsing and transactions without data migration or new public core APIs.

This change also includes a focused core history-isolation fix and its regression test. It ensures that a move remains independently undoable when a host filter replaces its transaction.

The [design](design.md) explains existing capabilities, missing pieces, and module responsibilities. The [specification](specs/block-drag-reorder/spec.md) defines acceptance criteria, and the [tasks](tasks.md) track delivery. Integration instructions are in the [plugin README](../../../packages/plugin-block-drag/README.md).
