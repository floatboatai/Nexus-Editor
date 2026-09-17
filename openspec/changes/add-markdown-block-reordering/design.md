## Context

Nexus stores Markdown in CodeMirror and renders some structures, particularly tables, as interactive widgets. A widget may contain pending DOM input that the host has not accepted into the document. The native plugin platform also owns commands, hotkey preferences, editor attachment, and disposal. Block movement must preserve these boundaries.

## Goals and Non-Goals

Goals are lossless movement of supported outermost blocks, safe interaction with pending table edits, isolated undo history, consistent source/live-preview behavior, host-owned runtime shortcuts, and complete disposal of gestures and UI.

Non-goals are touch gestures, grouped multi-block movement, cross-document moves, list-item sorting or nesting, and movement of a heading with its entire section. Selections are mapped through a single-block move; a selection spanning several blocks does not expand the movement scope.

## Decisions

### Keep block planning independent of the view

`model.ts` reads the active Markdown language's Lezer tree. Each candidate covers the complete source lines of one outermost node, preserving indentation and trailing spaces. Unsupported root nodes remain in the block sequence so planning cannot silently drop them.

Snapshots are cached by immutable `EditorState`. Reading requires a complete document parse, with a 25 ms `ensureSyntaxTree` budget. If the parse is unavailable, the model exposes no movable snapshot; partial viewport parses are never used to move a truncated container. Overlapping whole-line spans are also refused.

### Preserve source and validate both changed boundaries

A move uses one deletion and one insertion in a single `ChangeSet`. Existing separators travel with the source block; leading and trailing document whitespace remain intact. The planner first tries the unchanged separators. If necessary, it tries combinations of added blank lines at the affected removal and insertion boundaries, starting with the fewest changed boundaries.

All candidates share a 50 ms parsing budget. Each candidate is parsed using the editor's active language parser. The result must contain exactly the original outermost blocks in the intended order, with identical raw block text and matching full nested node structure and relative positions. This validates the removal seam as well as both insertion seams. For example, removing the paragraph between independent lists is refused if the lists would merge. An unterminated code fence cannot be moved before text it would swallow.

Parser timeouts and invalid candidates produce a safe no-op. The time budgets limit parser work; they are not a hard wall-clock guarantee for every allocation or tree walk. Validation runs when the target gap changes and again at release, rather than for every pointer coordinate. Large or unusually expensive documents may temporarily have no available move.

### Prepare widget input before taking the movement snapshot

`prepareBlockMove(view)` is a synchronous core API. It first checks table sessions for composition, active pointer interactions, and stale source positions. It then snapshots and flushes dirty cells through the normal host transaction pipeline. It returns `true` only when every relevant session has accepted its exact pending input; only then are editing locks released and widgets blurred.

Rejection, replacement with different content, active IME input, or stale table offsets returns `false`. Pending input and its editing lock remain available instead of allowing a move of old source. An equivalent replacement transaction is accepted. A host replacement may already have changed the document, and accepted earlier table commits are not rolled back if a later session fails; `false` specifically prevents the subsequent block move.

The pointer path prepares before capturing block positions and checks preparation again before committing. Any document change after gesture capture cancels that gesture. The keyboard path prepares before planning from the current document. Table commits and the later block move remain distinct edits in history.

After preparation, the plugin verifies that block count, block-type order, and every non-table block's raw text still match the earlier snapshot. A multiline table edit can split the table into several parsed blocks even when its transaction was accepted. Such a structural change cancels the move while retaining the accepted input; the user can retry against the resulting document. This prevents a previously valid source ordinal from selecting another block.

### Use one owner per interaction and per command

`BlockDragController` owns a margin button, source highlight, insertion indicator, status announcement, pointer listeners, and an animation-frame loop for edge scrolling. Pointer movement must cross a small threshold before entering the drag state. The operation commits on release inside the editor. Escape, cancellation, lost capture, window blur, a changed document, read-only state, or disposal terminates the gesture.

The controller uses CodeMirror geometry and scale factors for both source and live-preview layout. It does not use native HTML drag-and-drop or table grip events. Hidden blocks and folded headings are unavailable as movement sources. Focused grip buttons offer arrow-key movement and Escape to return focus to the editor.

Legacy callers may opt into local `Alt+Shift+ArrowUp/ArrowDown` bindings. The lifecycle plugin installs the same extension with those bindings disabled and registers `block-drag:move-up` and `block-drag:move-down` through the command service. User overrides, cleared bindings, and conflicts therefore have one authority. Availability checks do not commit table edits or move content. The runtime resolves the editor by the execution context's editor ID and drops that mapping on detach.

### Apply one isolated movement transaction

The move carries `userEvent: "move.block"`, the `block-drag` transaction origin, and full history isolation. The transaction pipeline preserves the history annotations when it reconstructs transactions. Cursor and selection endpoints inside the moved source follow it; other positions map through the change set, including boundary cursors and multiple selections. Undoing one move restores the preceding document and selection without undoing earlier typing.

### Keep the feature optional

Core exports preparation but imports no block-drag package. The package exposes legacy and native plugin entry points. Reference host boot flags select one owner, and omission of the block-drag flag preserves existing host behavior. Disabling the lifecycle plugin quiesces gestures before removing extensions and commands; re-enabling uses the host's existing hotkey preferences.

## Risks and Validation

The highest-risk areas are source reinterpretation, rejected widget input, transaction metadata, and asynchronous pointer cleanup. Targeted tests cover those contracts, including host rejection and replacement, stale offsets, source/live-preview transactions, undo/redo, runtime hotkey overrides and conflicts, and disable/re-enable cleanup.

DOM simulation cannot certify real pointer geometry, native IME event ordering, physical trackpads, zoom, or Electron behavior. Those acceptance checks remain explicit tasks. The table changes also require regression checks for click-to-edit, range selection, grip selection and sorting, deselection, and deletion.

## Rollout and Rollback

Ship only after maintainer review and the required acceptance checks. Hosts opt in through the plugin or reference feature flag. A host can disable the plugin to remove handles, movement bindings, and runtime commands without migrating any Markdown. Keep the additive preparation API and table-input correctness fixes subject to their own core regression review.
