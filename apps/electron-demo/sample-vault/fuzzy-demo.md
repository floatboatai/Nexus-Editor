# Fuzzy search demo

Back to [[index]].

This note gives the search panel a few predictable targets for fuzzy matching.
Open search with `Ctrl+F` or `Cmd+F`, enable **Fuzzy**, then try the compact
queries below.

## Try these

| Query | Expected match |
|---|---|
| `nxe` | Nexus Editor |
| `fb` | Floatboat |
| `mkd` | Markdown |
| `sps` | Search panel settings |

## Targets

Nexus Editor keeps Markdown as the source of truth.

Floatboat builds local-first authoring tools.

Markdown documents should stay readable outside the editor.

Search panel settings include match case, regexp, by word, and fuzzy mode.

## Notes

- Fuzzy search is ordered: `nxe` matches `Nexus Editor`, but `exn` does not.
- Fuzzy search is line-local and bounded in the panel, so a short query will
  not jump across long spans to create a surprising match.
- The `Match case` toggle still applies when fuzzy mode is enabled.
