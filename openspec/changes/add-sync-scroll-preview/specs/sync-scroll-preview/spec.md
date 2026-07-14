# Sync-Scroll Preview Spec — Split Preview Panel (electron-demo)

## ADDED Requirements

### Requirement: Split Preview Panel

The electron demo SHALL provide an optional, read-only rendered preview pane alongside the editor, toggled from the toolbar and defaulting to **off**. When open, the panel SHALL re-render whenever the editor's `change` event fires.

#### Scenario: Panel closed by default
- **WHEN** the demo starts with default settings
- **THEN** the preview panel SHALL NOT be visible

#### Scenario: Panel reflects edits
- **WHEN** the split preview panel is open
- **AND** the user edits the document
- **THEN** the panel's rendered content SHALL update to match the new document

### Requirement: Bidirectional Offset-Based Scroll Sync

When the split preview panel is open, scrolling either the editor or the preview pane SHALL scroll the other to the nearest corresponding position, matched by document character offset rather than a scroll percentage. Programmatic scroll updates triggered by this sync SHALL NOT themselves trigger a further sync in the opposite direction.

#### Scenario: Editor scroll moves the preview
- **WHEN** the user scrolls the editor so a paragraph at offset 500 is at the top of the viewport
- **THEN** the preview pane SHALL scroll so the element with the nearest `data-offset` to 500 is aligned to the top of the pane

#### Scenario: Preview scroll moves the editor
- **WHEN** the user scrolls the preview pane so the element with `data-offset="500"` is at the top
- **THEN** the editor SHALL scroll so document offset 500 is at the top of its viewport

#### Scenario: No feedback loop
- **WHEN** a programmatic scroll is applied to the editor as a result of the preview pane scrolling
- **THEN** that scroll SHALL NOT trigger another sync of the preview pane in response

### Requirement: Preview Links Never Navigate The App Window

`renderPreviewHtml` emits plain `<a href>` elements, and `apps/electron-demo`'s main process has no `will-navigate` / `setWindowOpenHandler` guard. Clicking a link inside the preview pane SHALL NOT navigate the Electron `BrowserWindow` away from the app. A plain click SHALL be swallowed (`preventDefault`). Ctrl/Cmd-click SHALL open the link in the user's default browser via `window.open(url, "_blank", "noopener,noreferrer")`, mirroring the existing convention in `live-preview-renderers.ts`'s inline link renderer.

#### Scenario: Plain click does not navigate the app
- **WHEN** the split preview panel is open and contains a rendered link
- **AND** the user clicks that link without a modifier key
- **THEN** the app window SHALL NOT navigate away from the editor

#### Scenario: Ctrl/Cmd-click opens externally
- **WHEN** the user Ctrl-clicks (Cmd-click on macOS) a rendered link in the preview pane
- **AND** the link's `href` is an absolute `http(s)` URL
- **THEN** the link SHALL open via `window.open` with `noopener,noreferrer`, not by navigating the app window

#### Scenario: Ctrl/Cmd-click on a non-absolute href is a no-op
- **WHEN** the user Ctrl-clicks (Cmd-click on macOS) a rendered link whose `href` is not a valid absolute `http(s)` URL (e.g. the garbage href produced by the wiki-link adapter quirk below)
- **THEN** `window.open` SHALL NOT be called
- **AND** the app window SHALL NOT navigate anywhere, including to a same-origin path that would reload the app itself

### Requirement: Wiki-Links Are Not Specially Rendered in Preview (v1 limitation)

`[[...]]` wiki-link syntax is not a standard mdast node type — it is recognized by CM6 decorations (`wikilinks.ts`) at the editing-surface level only. In the split preview pane, the outer bracket pair SHALL pass through as literal text; the enclosed `[Target]` SHALL render however the underlying mdast `link` adapter resolves an unresolved shortcut reference (currently: a link element whose `href` is the bracketed label itself, a pre-existing behavior of `lezer-mdast-adapter.ts` unrelated to this change — see `design.md`). Rendering wiki-links as a proper navigable link in the preview is deferred to a follow-up change.

#### Scenario: Wiki link is not specially handled
- **WHEN** the source document contains `[[Some Note]]`
- **AND** the split preview panel is open
- **THEN** the preview SHALL NOT render a working, resolved wiki-link
- **AND** the outer `[` and `]` characters SHALL appear as literal text around whatever the inner `[Some Note]` resolves to
