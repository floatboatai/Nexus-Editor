# Design: From editing content to organizing it

## How users interact with it

Users find content in the editor and drag it using the adjacent handle. The interface shows which content is moving and where it can be placed. In long documents, users can scroll while dragging. Dropping moves the complete content so editing can continue. Users can undo an incorrect placement or cancel a move before committing it. Keyboard users can perform equivalent operations.

The unit of movement matches the complete content users see: a table includes every row, code includes the entire code block, and a list includes its nested items. The first version only changes order within the same document, preserving the content and its internal structure.

## Existing project capabilities

This change reuses the following foundations:

| Existing capability | Role in block reordering |
|---|---|
| Markdown parsing | Identify the boundaries of paragraphs, lists, tables, and other content |
| A shared editor for live preview and source mode | Apply the same movement rules in both views |
| Editor positions and view coordinates | Map visible content to positions in the document |
| Transaction filters, selections, and undo | Apply host rules to moves and support restoration |
| Static plugins and runtime lifecycle support | Support different hosts and independent activation per editor |
| Internal editing flows for tables and other content | Preserve newly entered content before a move |

These foundations already support identification, modification, and extension. This change connects them into a complete content-reordering experience.

## Capabilities added by this change

| Missing capability | Design approach | Responsible module |
|---|---|---|
| Determine what moves and where it can go | Operate on complete Markdown blocks and reject destinations that change content structure | Move planning in the block drag plugin |
| Help users understand and control a move | Provide a handle, destination feedback, scrolling, cancellation, and keyboard operations | Editor extension in the block drag plugin |
| Preserve editing continuity before and after a move | Save edits within the block first, then submit the move as one undoable operation | Plugin integration with core, including the history-isolation fix |
| Make the capability available to applications | Provide shared plugin entry points and integrate the official plugin collection and Electron defaults | Plugin and host integration |

## Key design decisions

**Markdown remains the sole document format.** A move preserves the original text and only adjusts necessary separators between blocks. It does not introduce a new block storage format. A destination is rejected if reordering would change the structure, such as merging two independent lists.

**The plugin owns the interaction, and core provides editing capabilities.** The plugin determines what to move and where to place it. Actual changes pass through the existing transaction pipeline, respect host filters, and participate in undo. Static and runtime integration share the implementation, so browsers and Electron do not require separate movement logic.

**The document remains stable until the move is committed.** Dragging only displays feedback; the document changes after a valid drop. Read-only state, composition input, document changes, and plugin deactivation either preserve the existing editing flow or cancel the move to avoid interfering with active edits. Each editor manages its own interaction independently.

## Developer integration

Library consumers opt in to the official plugin. Runtime hosts can enable or disable it dynamically. Electron enables it by default and allows configuration to turn it off. A shared boot plan selects the plugin instances; the editor shell consumes that plan and mounts the UI, avoiding duplicate installation rules. Disabling the plugin does not rebuild the editor or clear the document or history. Configuration and examples are maintained in the [plugin README](../../../packages/plugin-block-drag/README.md).

The feature implementation and host integration are in place. Release still requires the fixes and remaining drag and editing-compatibility checks listed in [tasks.md](tasks.md).
