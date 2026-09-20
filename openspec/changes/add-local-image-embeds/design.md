# Design: Local Markdown Image Embeds

## Context

Nexus core is deliberately filesystem-agnostic. It can identify image ranges and render a renderer-provided image element, but it must not read local files or know about Electron sessions. The Electron demo owns the active Vault, the active Markdown path, and the `nexus-vault://` protocol.

The project already has two relevant pieces:

- `packages/core` recognizes standard Markdown image nodes and exposes live-preview renderers.
- `apps/electron-demo/electron/plugin-host-broker.ts` creates scoped resource registrations, while `electron/main.ts` serves them through the privileged `nexus-vault` protocol and can revoke them.

The missing boundary is a renderer-side resolver that turns an image reference into a Vault-relative path, with a secure basename fallback, and then into a short-lived resource URL.

## Goals / Non-Goals

### Goals

- Preserve the authored source exactly; image rendering is decoration/widget behavior only.
- Resolve paths relative to the current Markdown file and, when needed, find a unique matching image inside the active Vault.
- Reject paths outside the active Vault and unsupported URL schemes.
- Reuse the existing resource protocol and lifecycle rather than exposing filesystem paths to the renderer.
- Keep remote image behavior unchanged.
- Make stale asynchronous image loads harmless when the document or active file changes.

### Non-Goals

- Do not add filesystem access to `@floatboat/nexus-core`.
- Do not implement clipboard uploads, drag-and-drop import, or attachment management.
- Do not rewrite `![[...]]` into standard Markdown in the document buffer.
- Do not support local images in standalone single-file mode.

## Decisions

### D1 — Represent Obsidian image embeds as image preview ranges

Extend the core live-preview range collection to recognize `![[path]]` and `![[path|width]]` as image-shaped ranges. The source remains unchanged and the renderer receives the target path through the same image renderer contract used by standard Markdown images.

The wiki-link decoration layer must skip the `[[...]]` span that belongs to an image embed so it is not also rendered as a navigable note link. The metadata/index scanner keeps seeing embeds so existing backlink and metadata behavior remains intact.

### D2 — Resolve paths in the Electron renderer and main process

The renderer first resolves a relative target from the active note's directory. If that candidate is missing, the main process searches the active Vault for one unique image with the same basename. The search never leaves the authorized Vault and rejects ambiguous matches.

External `http://`, `https://`, and supported `data:image/*` URLs remain unchanged. Absolute paths, `file://`, `javascript:`, `..` escapes, and unsupported schemes are rejected.

### D3 — Use scoped resource registrations

The renderer requests a resource URL for the validated Vault image. Runtime mode uses the existing Electron Vault Broker; legacy mode uses the same `nexus-vault://` protocol with a window-scoped resource token. Neither mode exposes an absolute path to the DOM.

### D4 — Make asynchronous rendering generation-safe

Creating a resource URL is asynchronous. The image renderer assigns the URL only if the image widget still belongs to the current document and has not been destroyed. Document replacement, Vault switching, widget removal, and editor shutdown revoke the associated resource.

### D5 — Keep the existing image UI

The existing image chrome—source button, hover border, resize handle, alt text, and missing-image fallback—remains the presentation layer. This change supplies the correct `src`, path lookup, and lifecycle cleanup; it does not create a second image component.

## Risks / Trade-offs

- Async resource URLs add lifecycle complexity. Mitigation: centralize resource ownership and test stale completions and revocation.
- Obsidian embeds are not standard mdast. Mitigation: recognize only the narrow image-embed syntax in the core live-preview range scanner and keep the source unchanged.
- Duplicate image basenames are ambiguous. Mitigation: reject ambiguous matches instead of loading an arbitrary file.
- A very large Vault can make basename lookup expensive. Mitigation: use the exact relative path first, keep the fallback scoped to missing images, and avoid prefetching in V1.

## Acceptance Flow

1. Open `apps/electron-demo/sample-vault` as a Vault.
2. Open `image-demo.md`.
3. Confirm `![...](img/1.png)` and `![[img/1.png]]` both render `img/1.png`.
4. Confirm `![[Pasted image.png]]` resolves when the unique file is under an attachment subdirectory.
5. Confirm paths containing spaces and nested directories render.
6. Confirm a missing or ambiguous image shows the existing fallback.
7. Confirm `../../outside.png`, `file:///...`, and `javascript:...` never produce a loaded resource.
8. Switch files and close the Vault; confirm old resource URLs no longer load the image bytes.
