# Implementation Tasks

## 1. Package scaffolding

- [x] 1.1 Create `packages/plugin-paste/` with `package.json`
  (matching the shape of `packages/plugin-wordcount/package.json`:
  `tsup` build script, `@floatboat/nexus-core` workspace dep,
  `publishConfig` set to public npm). Runtime deps: `turndown`,
  `turndown-plugin-gfm`; dev dep: `@types/turndown`.
- [x] 1.2 Create `packages/plugin-paste/tsconfig.json` extending
  `../../tsconfig.base.json` and `include`-ing `src/**/*.ts` +
  `test/**/*.ts`.
- [x] 1.3 Add the alias `"@floatboat/nexus-plugin-paste":
  ["packages/plugin-paste/src/index.ts"]` to `tsconfig.base.json`
  `paths`.
- [x] 1.4 Add the matching alias to `vitest.config.ts`
  `resolve.alias`.
- [x] 1.5 Append `&& pnpm --filter @floatboat/nexus-plugin-paste
  build` to the root `package.json` `build` script.

## 2. Pure-function converter (`src/convert.ts`)

- [x] 2.1 Implement `convertHtmlToMarkdown(html: string, options?:
  PasteConvertOptions): string`. Empty / whitespace-only input
  returns `""`. Wraps `turndown` in try/catch; on failure falls back
  to tag-stripped plain text. Never throws.
- [x] 2.2 Configure `TurndownService` with Nexus-aligned defaults:
  ATX headings, `-` bullets, fenced code blocks (```), `*` emphasis,
  `**` strong, inlined links.
- [x] 2.3 Apply `turndown-plugin-gfm` when `options.tables !== false`
  (default `true`) for GFM tables / task lists / strikethrough. When
  `tables: false`, apply only the `strikethrough` rule so tables fall
  through to default (non-GFM) handling.
- [x] 2.4 Add an unconditional `removeScriptStyle` rule that strips
  `<script>` and `<style>` nodes entirely (safety, not style).
- [x] 2.5 Implement heading clamp: for levels > `headingMaxLevel`
  (default `6`, clamped to `[1,6]`), add a rule demoting `hN` to a
  bold paragraph (`**content**`).
- [x] 2.6 Implement inline-HTML handling gated by `keepInlineHtml`
  (default `false`): strip common inline style tags (`span`, `font`,
  `mark`, `small`, `sub`, `sup`) to their text content; when `true`,
  emit the tag with attributes intact.
- [x] 2.7 Support `options.rules` — custom turndown rules appended
  after the built-ins (later rules can override by filter).
- [x] 2.8 Export `createConverter(options)` returning the configured
  `TurndownService` for advanced reuse / testing.
- [x] 2.9 Add `src/turndown-plugin-gfm.d.ts` ambient declaration
  (the package ships no types).

## 3. Plugin factory (`src/plugin.ts`)

- [x] 3.1 Export `createPastePlugin(options?: PastePluginOptions):
  NexusPlugin`. The returned object is a valid `NexusPlugin` with
  `name: "plugin-paste"` and a `handlers.paste` hook.
- [x] 3.2 The paste hook SHALL:
  - return `false` when the clipboard carries files (defer to core's
    `onAssetUpload`);
  - return `false` when `event.clipboardData.getData("text/html")` is
    empty;
  - return `false` when `options.shouldConvert?.(event) === false`;
  - otherwise `convertHtmlToMarkdown(html, options)`, and if the
    result is non-empty: `event.preventDefault()`,
    `ctx.insertMarkdown(md)`, `return true`;
  - return `false` if the conversion result is empty.
- [x] 3.3 `PastePluginOptions` extends `PasteConvertOptions` with
  `shouldConvert?: (event: ClipboardEvent) => boolean`.

## 4. Public exports (`src/index.ts`)

- [x] 4.1 Re-export `createPastePlugin`, `convertHtmlToMarkdown`,
  `createConverter`, and public types (`PastePlugin`,
  `PastePluginOptions`, `PasteConvertOptions`, `TurndownRule`).

## 5. Tests

- [x] 5.1 `test/convert.test.ts` (pure-function): inline elements
  (bold/italic/link/code); block elements (headings, lists, code
  block, blockquote); GFM table conversion + `tables:false` opt-out;
  inline-HTML strip vs `keepInlineHtml:true`; heading demotion under
  `headingMaxLevel`; edge cases (empty input, plain text, script/style
  stripping, garbage input never throws, combined content).
- [x] 5.2 `test/plugin.test.ts` (jsdom + editor integration): HTML
  paste inserts Markdown and consumes the event; plain-text (no
  `text/html`) passes through; file paste passes through;
  `shouldConvert: () => false` passes through; empty conversion
  passes through without calling `insertMarkdown`; end-to-end
  consistency with `convertHtmlToMarkdown`; plugin is a valid
  `NexusPlugin` (name + handlers.paste function).
- [x] 5.3 `test/e2e-paste.test.ts` (real DOM event dispatch): mount
  plugin in `createEditor`, dispatch a real `ClipboardEvent` (with
  DataTransfer/ClipboardEvent polyfills, since jsdom lacks them) at
  `.cm-content`, assert the document receives converted Markdown end
  to end; plain-text paste does not get rewritten to Markdown.

## 6. Documentation

- [x] 6.1 `packages/plugin-paste/README.md` — install, quick start,
  how-it-works (the three-step hook contract), options reference,
  standalone-usage, license.
- [x] 6.2 Root `README.md` / `README.zh.md` plugin table — add a row
  for `@floatboat/nexus-plugin-paste`; bump package count 11 → 12.
- [x] 6.3 `docs/ROADMAP.md` / `docs/ROADMAP.zh.md` — add a row under
  "9. Developer Experience" with status `done`.
- [x] 6.4 `CONTRIBUTING.md` scope whitelist — add `paste` to the
  plugin scope list.

## 7. Verify

- [x] 7.1 `pnpm install` — workspace recognises the new package;
  `turndown` + `turndown-plugin-gfm` + `@types/turndown` resolve.
- [x] 7.2 `pnpm --filter @floatboat/nexus-plugin-paste exec tsc
  --noEmit` clean.
- [x] 7.3 `pnpm test` — 565/565 (existing 563 + 28 new, including
  2 real-DOM e2e). Run from repo root.
- [x] 7.4 `pnpm --filter @floatboat/nexus-plugin-paste build` —
  `dist/index.js` + `dist/index.d.ts` emit cleanly.
- [ ] 7.5 Manual smoke in the electron demo — deferred (the plugin is
  headless with no demo wiring in this PR; the jsdom e2e test in
  `test/e2e-paste.test.ts` dispatches a real `ClipboardEvent` through
  core's `domEventHandlers` and asserts the document update, covering
  the same event path a manual paste would exercise).
- [ ] 7.6 `openspec validate add-plugin-paste --strict` — CLI not
  installed in the dev environment. Spec format hand-linted against
  `openspec/AGENTS.md` (each `### Requirement:` has ≥1 `#### Scenario:`
  with `**WHEN**`/`**THEN**` bullets; delta files use
  `## ADDED Requirements`).
