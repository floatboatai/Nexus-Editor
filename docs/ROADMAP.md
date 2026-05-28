# Nexus Editor Roadmap

This document maps every planned feature to **package ownership / priority / status / OpenSpec linkage**.

[中文版](./ROADMAP.zh.md)

- Any item added to the roadmap should be registered here as one row first, then decide whether it needs an OpenSpec proposal.
- Status values: `planned` / `in-progress` / `blocked` / `done` (merged to `main`) / `dropped`.
- Priority: `P0` (current iteration) / `P1` (next) / `P2` (mid-term) / `P3` (long-term).
- "Needs OpenSpec" — whether the item must go through `openspec/changes/` (see `CONTRIBUTING.md` §3.1).

---

## 1. Toolbar / Text Editing

| #   | Feature                                                                                                                                                 | Package                            | Priority | Status  | Needs OpenSpec | Notes                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------- | ------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Multi-line list toggle (ordered / unordered)                                                                                                            | `plugin-toolbar` + `core` commands | P1       | done    | No             | Implemented as part of the broader multi-line formatting work — see `openspec/changes/add-multi-line-formatting`                                             |
| 28  | Multi-line formatting for all toolbar buttons (bold / italic / underline / strikethrough / inline-code / heading / blockquote / text-color / highlight) | `plugin-toolbar`                   | P1       | done    | Yes            | All toolbar buttons support cross-line selection; includes star-count algorithm and list marker exclusion — see `openspec/changes/add-multi-line-formatting` |
| 12  | Advanced toolbar (emoji picker / table tools / color picker)                                                                                            | `plugin-toolbar`                   | P2       | planned | Yes            | Introduces widgets — split into 3 sub-proposals                                                                                                              |

## 2. Search / Commands

| #   | Feature                        | Package                          | Priority | Status      | Needs OpenSpec | Notes                                                                            |
| --- | ------------------------------ | -------------------------------- | -------- | ----------- | -------------- | -------------------------------------------------------------------------------- |
| 2   | Whole-word matching            | `plugin-search`                  | P1       | planned     | No             | Extension of existing search options                                             |
| 15  | Regex search                   | `plugin-search`                  | P1       | in-progress | No             | Watch escape edge cases — PR #9 in review                                        |
| 16  | Command / search history       | `plugin-search` + `plugin-slash` | P2       | planned     | Yes            | Needs persistence (localStorage or host-injected)                                |
| 17  | Fuzzy search                   | `plugin-search`                  | P2       | planned     | No             | Evaluate fzf-like algorithm vs. third-party lib                                  |
| 3   | Slash command sorting + limit  | `plugin-slash`                   | P0       | done        | Yes            | Landed alongside the floating menu UI — see `openspec/changes/add-slash-menu-ui` |
| 27  | Slash command floating menu UI | `plugin-slash` + `electron-demo` | P0       | done        | Yes            | `createSlashMenuUI(editor, options)` — see `openspec/changes/add-slash-menu-ui`  |

## 3. Core Editor

| #   | Feature                               | Package               | Priority | Status      | Needs OpenSpec | Notes                                                            |
| --- | ------------------------------------- | --------------------- | -------- | ----------- | -------------- | ---------------------------------------------------------------- |
| 5   | `getSelectedText()` API               | `core`                | P0       | in-progress | No             | Public API addition; needs types + tests — PR #8 in review       |
| 6   | Multi-cursor / multi-selection        | `core`                | P1       | planned     | Yes            | CM6 supports it; must verify live-preview and table interactions |
| 7   | AST enhancement / Markdown extensions | `core` + `preset-gfm` | P2       | planned     | Yes            | Affects serialization and every AST-dependent plugin             |
| 8   | Undo / redo grouping                  | `plugin-history`      | P1       | planned     | No             | Coordinate with table's `tableEditingCount`                      |

## 4. Plugin System

| #   | Feature                    | Package | Priority | Status  | Needs OpenSpec | Notes                                                          |
| --- | -------------------------- | ------- | -------- | ------- | -------------- | -------------------------------------------------------------- |
| 9   | Widget API standardization | `core`  | P1       | planned | Yes            | Existing widgets hit many pitfalls (see CLAUDE.md); spec first |
| 10  | Plugin event bus           | `core`  | P2       | planned | Yes            | Affects every existing `plugin-*`                              |
| 11  | Plugin hot-reload          | `core`  | P3       | planned | Yes            | Dev mode only; depends on #9                                   |

## 5. UI / Preview / Keymap

| #   | Feature                                                                   | Package                  | Priority | Status  | Needs OpenSpec | Notes                                                                                                                                  |
| --- | ------------------------------------------------------------------------- | ------------------------ | -------- | ------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 13  | Markdown live preview sync scroll                                         | `core`                   | P2       | planned | No             | Only relevant in split-preview mode                                                                                                    |
| 29  | List marker unselectable (cursor guard + user-select:none)                | `core`                   | P1       | done    | Yes            | `Prec.highest` mousedown/mouseup guards + CSS `user-select:none` — see `openspec/changes/add-multi-line-formatting`                    |
| 30  | Inline rendering of `<span>`/`<u>` tags inside list items (no line break) | `core`                   | P1       | done    | Yes            | Lezer `HTMLBlock` → `inline:true` → inline `<span>` widget instead of block `<div>` — see `openspec/changes/add-multi-line-formatting` |
| 14  | Custom keymap UI                                                          | `react` / `vue` + `core` | P2       | planned | Yes            | Need to expose keymap register / query API first                                                                                       |

## 6. React / Vue SDK

| #   | Feature                                                        | Package                         | Priority | Status  | Needs OpenSpec | Notes                                                     |
| --- | -------------------------------------------------------------- | ------------------------------- | -------- | ------- | -------------- | --------------------------------------------------------- |
| 4   | `<Editor />` container pass-through props + `onReady` callback | `react` (and `vue` in lockstep) | P0       | planned | No             | Public API addition; semantics must match across bindings |

## 7. Collaboration

| #   | Feature                            | Package                 | Priority | Status  | Needs OpenSpec | Notes                                                 |
| --- | ---------------------------------- | ----------------------- | -------- | ------- | -------------- | ----------------------------------------------------- |
| 18  | Realtime collaboration (OT / CRDT) | new `plugin-collab`     | P3       | planned | Yes            | Large feature; start with a tech-selection design doc |
| 19  | Version history / snapshots        | `core` + host storage   | P2       | planned | Yes            | electron-demo lands the reference impl first          |
| 20  | Shared comments / @mention         | new `plugin-annotation` | P3       | planned | Yes            | Depends on #18                                        |

## 8. Cross-platform

| #   | Feature                         | Package                      | Priority | Status  | Needs OpenSpec | Notes                                       |
| --- | ------------------------------- | ---------------------------- | -------- | ------- | -------------- | ------------------------------------------- |
| 21  | Electron packaging optimization | `apps/electron-demo`         | P1       | planned | No             | Size, startup time, autoUpdater             |
| 22  | Web Component / iframe wrapper  | new `wc` package             | P2       | planned | Yes            | Share core instance with React/Vue SDK      |
| 23  | Cloud storage interface         | `core` storage adapter layer | P2       | planned | Yes            | NoteVault interface with pluggable backends |

## 9. Developer Experience

| #   | Feature                  | Package             | Priority | Status      | Needs OpenSpec | Notes                                                |
| --- | ------------------------ | ------------------- | -------- | ----------- | -------------- | ---------------------------------------------------- |
| 24  | TypeScript type coverage | repo-wide           | P0       | in-progress | No             | Ongoing; new code enforces strict                    |
| 25  | End-to-end testing       | repo infra          | P1       | planned     | No             | Candidate: Playwright against electron-demo          |
| 26  | CI/CD pipeline polish    | `.github/workflows` | P1       | planned     | No             | Publish workflow exists; missing PR check / e2e gate |

---

## Maintenance

1. **Adding an item**: append a row in the matching section with the next number; mention it in the PR description.
2. **Status transitions**: start work → `in-progress`; merged → `done`; abandon → `dropped` (keep the row for traceability).
3. **Priority adjustments**: maintainers re-balance at each iteration kickoff — don't tweak priorities as drive-by edits in feature PRs.
4. **OpenSpec linkage**: once an item enters the OpenSpec flow, fill its `openspec/changes/<id>/` link into the row's "Notes" column.
