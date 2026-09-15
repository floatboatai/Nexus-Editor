# Ghost & Escape Demo

Back to [[index]].

## Unresolved target

Clicking [[Ghost Note]] should render with a **dashed red underline** because
the target doesn't exist yet. When you click it, the app creates
`Ghost Note.md` next to this file and opens it.

Another ghost with alias: [[NonExistent|phantom]].

## Escape sequence (must NOT become a link)

The string `\[[NotALink]]` on this line should stay literal — no decoration,
no click target.

## Code span and fence (must NOT become links)

A code context is how a note *describes* the syntax, so nothing inside it is a
link. Neither the inline span `[[InsideFence]]` above nor the fenced copy below
renders as a link, and neither shows up in the backlinks of a note named
"InsideFence".

```md
see [[InsideFence]]
```

Links on the surrounding lines are unaffected: [[Ghost Note]] still resolves as
a ghost, and undefined-target styling still applies.
