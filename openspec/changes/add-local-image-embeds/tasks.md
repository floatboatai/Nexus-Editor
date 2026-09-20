## 1. OpenSpec and test fixtures

- [ ] 1.1 Run `openspec validate add-local-image-embeds --strict` when the CLI is available.
- [x] 1.2 Add local-image and Obsidian-embed examples to the sample Vault.

## 2. Core image range support

- [x] 2.1 Add a focused scanner for `![[path]]` image embeds with stable source offsets.
- [x] 2.2 Exclude embed spans from ordinary wiki-link decoration while preserving metadata/index scanning.
- [x] 2.3 Reuse the existing image live-preview renderer contract and add unit tests for valid, escaped, malformed, nested, and sized inputs.

## 3. Image path resolution

- [x] 3.1 Add a pure resolver for external URLs, note-relative paths, Vault-relative paths, separators, spaces, and Unicode names.
- [x] 3.2 Reject absolute paths, traversal outside the Vault, unsupported schemes, and empty targets.
- [x] 3.3 Add a secure basename fallback for a unique image inside the active Vault.
- [x] 3.4 Add unit tests for nested notes, attachment folders, duplicate basenames, traversal attempts, and external URLs.

## 4. Secure resource loading

- [x] 4.1 Expose the minimum renderer-to-main operation needed to create a resource URL for a validated Vault image.
- [x] 4.2 Keep authorization and content serving inside the existing Electron Vault Broker and `nexus-vault://` protocol.
- [x] 4.3 Track resource registrations by image widget generation and revoke them on widget destruction, document replacement, Vault switch, and runtime shutdown.
- [x] 4.4 Add Broker and Electron main-process tests for authorization, Vault containment, Content-Type, basename lookup, resource revocation, and cross-session access.

## 5. Renderer integration

- [x] 5.1 Pass active-file and Vault context into the image resolver without adding filesystem logic to core.
- [x] 5.2 Make image source assignment generation-safe for asynchronous resource creation.
- [x] 5.3 Preserve the existing image hover/source/resize UI and missing-image fallback.
- [x] 5.4 Add renderer tests for standard Markdown images, `![[...]]`, stale async results, and cleanup.

## 6. Verification

- [x] 6.1 Run focused core, renderer, and Electron image tests.
- [x] 6.2 Run `pnpm build` and the Electron demo build.
- [ ] 6.3 Run `pnpm test` with all environment-dependent failures resolved or documented.
- [ ] 6.4 Manually execute the acceptance flow in the Electron demo and capture a before/after screenshot for the PR.
