## Context

Three existing facts shape this design:

1. The React and Vue bindings already define the reference semantics
   for wrapping `createEditor`: config is read **once** at mount
   (neither binding reacts to prop changes after creation), except for
   the controlled `value` / `modelValue`, which syncs external updates
   through a silent `setDocument` guarded by a last-synced-document
   check (`packages/react/src/use-editor.ts`,
   `packages/vue/src/use-editor.ts`). The element must not invent a
   third behaviour.
2. `EditorAPI` exposes no runtime setters for `readOnly`, `tabSize`,
   `direction`, `indentGuides`, `parseDelayMs`, `slashMenuLimit`,
   `multiCursor` or `livePreview` — they are `createEditor`-time
   options. Any wrapper that wants live attributes has to rebuild the
   editor.
3. PR #49 (closed) tried this package before. The review called out:
   missing OpenSpec proposal; root build filter naming a package that
   didn't exist; `tsconfig` not extending `tsconfig.base.json`;
   missing `tsconfig.base.json` path alias; build ordered before its
   dependency; and `attributeChangedCallback` writing private fields
   that nothing ever re-read, so attribute changes after mount were
   silent no-ops. Each finding maps to an explicit decision or task
   below.

## Goals / Non-Goals

- **Goals**
  - One `<nexus-editor>` tag usable from plain HTML and any framework
    that renders DOM, with the same controlled-document semantics as
    the React/Vue bindings.
  - Attribute changes after mount **take effect** — either by silent
    document sync (`value`) or by a documented, coalesced editor
    rebuild (everything else).
  - Survive DOM reparenting (`appendChild` to a new parent) without
    losing the document — custom elements get disconnected/connected
    synchronously during a move, and naive destroy-on-disconnect
    wrappers wipe the editor.
  - Zero new dependencies; consume only public `@floatboat/nexus-core`
    API.
  - Side-effect-free module (registration is an explicit call) so the
    package can be imported in SSR code paths.
- **Non-Goals**
  - Shadow DOM, iframe isolation, form association, demo app — see
    proposal "Out of scope".
  - Fine-grained runtime reconfiguration (e.g. wiring `setTheme` for
    the `theme` property). v1 keeps one uniform rule: config mutation
    → rebuild. Fine-grained paths can be layered in later without
    breaking the contract.

## Decisions

### Decision 1: Light DOM, element-as-container

The element passes **itself** as `EditorConfig.container`, exactly
like the React binding passes its wrapper `div`. No shadow root, no
inner wrapper.

**Alternatives considered:**

- *Shadow root.* CodeMirror's style-mod can adopt styles into a
  `ShadowRoot`, but live-preview table widgets, slash-menu coordinate
  math (`getCoordsAtPos`), and the mermaid orphan-cleanup path have
  never been exercised across a shadow boundary. Shipping that
  unaudited would trade a styling nicety for correctness risk.
  Deferred to an opt-in `shadow` attribute in a follow-up.
- *Inner wrapper `div`.* Adds a DOM level for no benefit; the element
  is already a block-level host the way the React/Vue wrapper `div`
  is. Rejected.

### Decision 2: Attributes for strings/booleans/numbers, properties for everything else

HTML attributes can only carry strings, so the attribute surface is
exactly the `EditorConfig` subset with scalar types: `value`,
`readonly`, `direction`, `tab-size`, `indent-guides`,
`parse-delay-ms`, `slash-menu-limit`, `live-preview`, `multi-cursor`.
Rich config (`plugins`, `parser`, `theme`, `locale`, `livePreview`
object form, `onAssetUpload`) is property-only — the standard custom
element pattern ("attributes for data, properties for objects").

When both are set, the **property wins** — a property is an explicit
imperative act by the host, an attribute is declarative markup.
JSON-in-attribute (e.g. `theme='{"bg":...}'`) was rejected: it can't
express functions (`parser`, `onAssetUpload`, plugin hooks), silently
diverges from the typed API, and encourages copy-paste config drift.

### Decision 3: `value` syncs silently; every other config change rebuilds

`value` attribute/property updates reuse the controlled-document
helpers (`shouldSyncControlledDocument` etc., mirrored from the
React/Vue packages) and apply via `setDocument(next, { silent: true })`
— identical to the React `value` prop contract, including not echoing
a `nexus-change` for content the host just pushed in.

All other observed attributes (and rich properties) mark the config
dirty and schedule a **microtask-coalesced rebuild**: capture the
current document and selection, `destroy()`, `createEditor` with the
new config snapshot, restore document and selection (clamped by core),
re-emit `nexus-ready` with the fresh `EditorAPI`.

**Alternatives considered:**

- *Ignore post-mount changes (React/Vue behaviour).* Defensible for
  framework bindings where the component contract documents it, but
  it is exactly the behaviour that closed PR #49 — in markup-driven
  hosts, `el.setAttribute("readonly", "")` silently doing nothing
  reads as a bug, not a contract. Rejected.
- *Per-option live wiring.* Requires core-side runtime setters that
  don't exist (`EditorAPI` has `setTheme` only); building eight
  bespoke code paths in the wrapper would fork behaviour from
  `createEditor`'s option handling. Rejected for v1.
- *Rebuild synchronously per attribute.* Frameworks patch attributes
  one at a time; three attribute writes would create and destroy three
  editors. The microtask coalescer collapses them into one rebuild.

`nexus-ready` intentionally fires again after each rebuild: the old
`EditorAPI` is destroyed and any host reference to it is stale, so the
event doubles as the invalidation signal. This is documented in the
README and spec.

### Decision 4: Deferred destroy on disconnect

`disconnectedCallback` does not destroy immediately — it queues a
microtask and only destroys if the element is still disconnected when
the microtask runs. Moving an element (`newParent.appendChild(el)`)
fires disconnected + connected synchronously in the same task, so a
move keeps the live editor (CodeMirror's DOM travels inside the
element). A real removal destroys the editor and captures the final
document, so a later re-insertion recreates the editor with the text
intact.

**Alternative considered:** destroy eagerly and always recreate on
connect. Simpler, but reparenting then resets scroll/undo/IME state —
and layout-driven reparenting is common in exactly the
non-React/Vue hosts this package targets. Rejected.

### Decision 5: Explicit registration, no import side effects

`defineNexusEditor(tagName = "nexus-editor")` registers the element
and is idempotent for the default flow (re-invoking with a tag that is
already defined as `NexusEditorElement` is a no-op; a tag claimed by a
*different* constructor throws — silently swallowing that collision
would leave `<nexus-editor>` rendering someone else's widget).
Importing the module never touches `customElements`, so the package is
safe to import in SSR / Node contexts where `customElements` does not
exist.

## Risks / Trade-offs

- **Rebuild discards undo history.** Documented. Acceptable: config
  flips are rare host actions (e.g. toggling `readonly` on save), and
  the React/Vue bindings offer no better today (they ignore the change
  entirely).
- **`nexus-ready` fires more than once.** Hosts that cache the
  `EditorAPI` must rebind on each `nexus-ready`. Called out in the
  README with a delegation example.
- **IME composition vs. controlled sync.** Core defers `setDocument`
  during composition and applies the last pending load at
  `compositionend`, so a controlled push landing mid-composition is not
  lost in normal operation. The one lossy window is a config rebuild
  during active composition (the destroyed editor drops its pending
  load); the rebuild resets the last-synced guard to the captured
  document, so the host's next push applies cleanly. Both behaviours
  are pinned by regression tests.
- **jsdom coverage limits.** vitest+jsdom exercises registration,
  lifecycle, attribute plumbing, controlled sync, and event dispatch,
  but not real layout/IME. Same limitation the React/Vue test suites
  accept; manual verification in a browser is recorded in the PR.
