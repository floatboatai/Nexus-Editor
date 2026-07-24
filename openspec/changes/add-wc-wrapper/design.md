## Context
React and Vue bindings (`packages/react`, `packages/vue`) each wrap `createEditor` from `@floatboat/nexus-core` with framework-specific lifecycle glue. Roadmap item 22 asks for framework-agnostic Web Component and iframe wrappers that reuse the same core instance rather than re-implementing editor logic.

## Goals / Non-Goals
- Goals: expose the same capability surface as `packages/react`'s `<Editor />` as a native custom element, plus a small origin-checked bridge for hosts that render Nexus inside an iframe.
- Non-Goals: Shadow DOM encapsulation, SSR support, a Vue/React-specific integration layer, proxying the complete `EditorAPI`, shipping or hosting a built-in `frame.html`, and serializing plugins, themes, parsers, upload callbacks, or other function/object configuration across the iframe boundary.

## Decisions
- **Light DOM, no `attachShadow`.** The element renders a single internal `<div>` child in its own light DOM, exactly like `packages/react`'s wrapper div. Rationale: an unmerged PR (#161) is still fixing a Shadow DOM event-retargeting bug in `plugin-slash` (`event.target` vs `event.composedPath()`); shipping `wc` inside a shadow root today would hit that same unresolved issue for any consumer using the slash plugin. Light DOM sidesteps it entirely and keeps CodeMirror's DOM/coordinate assumptions (popups, `coordsAtPos`) unchanged. Consumers who want encapsulation can wrap `<nexus-editor>` in their own shadow root.
- **Only `value` is reactive after connection.** `packages/react`'s `useEditor` creates the core editor inside a mount-only effect (`useEffect(..., [])`) — `plugins`, `theme`, `parser`, `tabSize`, etc. are captured once at creation; only the `value` prop is re-synced via a second effect. `wc` mirrors this exactly: `attributeChangedCallback` only reacts to `value`/`initial-value` post-connect; all other attributes/properties are read once in `connectedCallback`. This is capability parity with the existing SDKs, not a new limitation introduced here.
- **Namespaced, composed custom events (`nexus-*`).** Native elements already dispatch `focus`/`blur`, and `change` is a common native event name (form controls). Using `nexus-focus` / `nexus-blur` / `nexus-change` avoids ambiguity. Events are both bubbling and composed so a consumer-owned shadow root does not hide the public event contract.
- **Preserve synchronous DOM moves; destroy on true disconnect.** Moving the element between parents fires `disconnectedCallback` and `connectedCallback` synchronously. Teardown is deferred to a microtask and cancelled when the element has already reconnected, preserving uncontrolled edits during reparenting. A genuinely detached element is still destroyed before the next task.
- **Upgrade pre-definition properties.** Frameworks may assign properties before the lazy custom-element bundle registers. On first connection the element replays own properties through its prototype setters so `value`, plugins, theme, locale, and other public configuration are not shadowed or lost.
- **Cancel superseded delayed changes in core.** A silent external `setDocument` cancels pending parse/composition notifications for the older document. This keeps controlled React, Vue, and Web Component hosts from receiving a stale callback after applying a newer value.
- **Split iframe parent and runtime entry points.** `iframe-parent` owns the `HTMLIFrameElement` and exposes a promise-based controller. `iframe-runtime` runs inside the consumer-hosted frame page, creates the real `EditorAPI`, and supplies all non-serializable editor configuration locally.
- **Discover globally, communicate privately.** Parent and runtime exchange only versioned `probe`, `runtime-ready`, and `connect` messages through window messaging. Both validate the other window and an exact non-wildcard origin. The connection transfers a `MessagePort`; ready/change events and commands then stay on that dedicated channel.
- **Detect frame replacement.** Each runtime mount has a unique id. If the same iframe window announces a different runtime id, the parent controller rejects pending work and requires a new controller, preventing commands from silently crossing a reload boundary.
- **Keep the remote surface deliberately small.** The bridge forwards ready/change, `getDocument`, silent `setDocument`, `focus`, and `destroy`. This covers document embedding without pretending the asynchronous structured-clone boundary is equivalent to the synchronous `EditorAPI`.

## Risks / Trade-offs
- Non-reactive config (tab size, direction, etc.) may surprise consumers expecting full custom-element reactivity → mitigated by matching documented React/Vue behavior and calling it out explicitly in the README.
- No Shadow DOM means no built-in style isolation → acceptable per Non-Goals; consumers needing isolation wrap the element themselves.
- Deferred disconnect cleanup means `.editor` remains non-null until the current microtask completes after permanent removal → acceptable to distinguish true removal from synchronous reparenting.
- Consumers must host the iframe page and provide exact parent/child origins → explicit configuration avoids unsafe wildcard messaging and assumptions about package asset URLs.
- Iframe commands are asynchronous and can fail on timeout, reload, or active IME composition → the controller exposes promises and stable error codes; callers retry after composition or create a new controller after reload.

## Migration Plan
N/A — new package, no existing consumers.

## Open Questions
- None blocking. Shadow DOM support can be revisited once #161's `composedPath()` fix lands on `main`.
