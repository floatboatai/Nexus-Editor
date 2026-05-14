# Slash menu demo

Type a forward slash (`/`) on an empty line to open the floating
command menu. The menu lists every command registered by the loaded
plugins — out of the box the toolbar plugin contributes headings,
bold, italic, lists, blockquote, links, images and a divider.

## Walkthrough

1. Place the caret at the end of this paragraph and press `Enter`.
2. Type `/h2` — the menu narrows to **Heading 2**. Press `Enter` to
   insert.
3. Keep typing on the new line: `/list`. Two list commands surface
   (bulleted + numbered). Use `↑` / `↓` to choose and `Enter` to
   confirm.
4. Try `/zzz` — the menu stays open with a muted *No matches* hint so
   you know the trigger is still live. Press `Esc` to dismiss.

## Ranking & limit

Behind the scenes the engine ranks results by relevance. With many
plugins installed the menu still caps at 8 entries so a long catalogue
never paints below the viewport. You can change the cap with
`createEditor({ slashMenuLimit: N })`.

## Keyboard reference

| Key | Action |
|---|---|
| `↑` / `↓` | Move highlight |
| `Home` / `End` | Jump to first / last |
| `Enter` / `Tab` | Confirm |
| `Esc` | Dismiss |

The menu is fully driven by `editor.on("slashMenuChange", ...)`, so a
host that prefers a React or Vue component can ignore the bundled UI
and render its own.
