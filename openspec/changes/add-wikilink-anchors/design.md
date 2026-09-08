## Context

Wiki links are resource-agnostic in core: the host supplies `resolve` / `onNavigate` / `suggest`. Heading and block suffixes are not filesystem paths; they are offsets inside an already-resolved markdown buffer. The demo duplicated that parsing in `link-index.ts` while core decorations and autocomplete stayed unaware of it.

## Goals / Non-Goals

- Goals:
  - One parser in core for `#heading` and `^block-id`.
  - Same-file jumps are not painted unresolved.
  - Autocomplete after `#` / `^` is a host callback, not a filesystem dependency.
- Non-Goals:
  - Rename-propagating link updates.
  - Frontmatter aliases.
  - Graph view.
  - Changing the line-based live-preview reveal policy.

## Decisions

- Decision: Keep `resolve(name)` receiving the raw target (`Foo#Bar`) so existing hosts that already call `stripAnchor` keep working. Core only skips `resolve` for empty-path same-file anchors.
- Decision: `suggestAnchors` is a separate callback. Mixing heading ids into `suggest(query)` would make `[[Note#He` filter note names that contain `note#he`.
- Decision: Collapsed `[[#Heading]]` hides the `#` marker with the brackets so the chip reads as the heading text. `[[Note#Heading]]` still shows the raw target; replacing `#` with ` > ` would insert extra characters and risk click-drift.
- Alternatives considered: parsing anchors only in the demo. Rejected because every host would reimplement it and same-file unresolved styling cannot be fixed from the outside.

## Risks / Trade-offs

- `onNavigate` options gained required `path` / `anchor` fields. TypeScript callers must update; runtime extra fields would have been compatible. Mitigation: demo updated in the same change; fields are cheap to ignore.
- Heading autocomplete needs file contents. Hosts that only have names cannot implement `suggestAnchors`; leaving the callback unset preserves note-name completion.

## Migration Plan

Additive. Hosts that do not pass `suggestAnchors` behave as today, except `[[#heading]]` now styles as resolved.
