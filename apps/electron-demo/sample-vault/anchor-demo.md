# Anchor demo

Back to [[index]].

Click the chips from **this top list**. Each target is a full screen below the
previous one, so Parent, Parent#Child, and quote-1 should each scroll.

## Same-file jumps

- Heading: [[#Parent]]
- Nested heading: [[#Parent#Child]]
- Block: [[anchor-demo^quote-1|quote-1]]
- Missing heading stays put, not a red ghost: [[#Does not exist]]

## Cross-file jumps

- [[Daily/2026-04-20#Morning]]
- [[Daily/2026-04-20^standup-notes]]
- Opens the daily note but does not jump: [[Daily/2026-04-20#Missing]]

Type `[[#` here for this file's headings, `[[^` for block ids, or
`[[Daily/2026-04-20#` for the daily note's headings.

- pad A01
- pad A02
- pad A03
- pad A04
- pad A05
- pad A06
- pad A07
- pad A08
- pad A09
- pad A10
- pad A11
- pad A12
- pad A13
- pad A14
- pad A15
- pad A16
- pad A17
- pad A18
- pad A19
- pad A20
- pad A21
- pad A22
- pad A23
- pad A24
- pad A25
- pad A26
- pad A27
- pad A28
- pad A29
- pad A30

## Parent

This heading is the `[[#Parent]]` target. Nested `[[#Parent#Child]]` is another
screen below — not the next line.

- pad B01
- pad B02
- pad B03
- pad B04
- pad B05
- pad B06
- pad B07
- pad B08
- pad B09
- pad B10
- pad B11
- pad B12
- pad B13
- pad B14
- pad B15
- pad B16
- pad B17
- pad B18
- pad B19
- pad B20
- pad B21
- pad B22
- pad B23
- pad B24
- pad B25
- pad B26
- pad B27
- pad B28
- pad B29
- pad B30

### Child

This heading is the `[[#Parent#Child]]` target. The block ref is another
screen below.

- pad C01
- pad C02
- pad C03
- pad C04
- pad C05
- pad C06
- pad C07
- pad C08
- pad C09
- pad C10
- pad C11
- pad C12
- pad C13
- pad C14
- pad C15
- pad C16
- pad C17
- pad C18
- pad C19
- pad C20
- pad C21
- pad C22
- pad C23
- pad C24
- pad C25
- pad C26
- pad C27
- pad C28
- pad C29
- pad C30

This paragraph is the block-id target.

^quote-1
