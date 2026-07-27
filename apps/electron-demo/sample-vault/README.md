# Sample Vault for Wiki-Link Verification

This is a **demo vault** for exercising the Obsidian-style `[[wiki link]]` feature
added in the `add-wikilinks` change proposal.

## How to use

1. `cd apps/electron-demo && pnpm dev` (or `pnpm build && pnpm start`).
2. Click the **Vault** toolbar button and pick this folder
   (`apps/electron-demo/sample-vault/`).
3. Open any note and confirm the behaviors below.

## What to verify

- **Plain link** — see [[index]]
- **Alias link** — see [[index|start here]]
- **Hub & spoke** — open [[index]], check the 🔗 backlinks panel: every note
  in this vault links back to `index.md`.
- **Globally unique basename** — from [[Daily/2026-04-20]], the link `[[AI]]`
  resolves to `Topics/AI.md` even though it lives in a different folder.
- **Same-directory collision** — `work/Inbox.md` and `personal/Diary.md` both
  reference `[[Meeting]]`. Each resolves to the **neighbor** in its own
  directory, not the one in the other folder.
- **Unresolved (ghost) link** — [[Ghost Note]] in `ghost-demo.md` should render
  dashed + muted. Clicking it creates `Ghost Note.md` next to the active file.
- **Escape sequence** — `\[[NotALink]]` in `ghost-demo.md` stays literal.
- **Autocomplete** — in a new note, type `[[me` and confirm the popup lists
  `Meeting` (twice, one per directory) plus other matches.

- **Math rendering** — open [[math-demo]] and verify inline and block formulas,
  invalid-input fallback, and keyboard access to the block edit button.

## Topology

```
sample-vault/
├── README.md                 (this file, also [[index]] linked)
├── index.md                  (hub: links to every other note)
├── ghost-demo.md             (unresolved + escape demo)
├── Projects/
│   ├── Nexus-Editor.md       (links to index, AI, Alice)
│   └── Ideas.md              (links to Nexus-Editor, Bob)
├── People/
│   ├── Alice.md              (links back to Projects/Nexus-Editor)
│   └── Bob.md                (links to Alice via alias)
├── Topics/
│   ├── AI.md                 (globally unique basename)
│   └── Testing.md            (demonstrates code-block safety)
├── Daily/
│   └── 2026-04-20.md         (mixes aliases, bare links, heading follow-up)
├── work/
│   ├── Meeting.md            (same-dir collision target)
│   └── Inbox.md              ([[Meeting]] → work/Meeting.md)
└── personal/
    ├── Meeting.md            (same-dir collision target)
    └── Diary.md              ([[Meeting]] → personal/Meeting.md)
```
