# Editor Core Spec — Slash Command Ranking, Limit, and Run Hook

## ADDED Requirements

### Requirement: Slash Command Run Callback

`SlashCommandDef` SHALL accept an optional `run` callback of the form `(editor: EditorAPI) => boolean | void`. When present, the host UI MAY invoke it to execute the command. Commands without a `run` callback SHALL continue to function as metadata-only entries, preserving full backward compatibility with consumers that rely on a host-side `id → action` registry.

#### Scenario: Metadata-only command remains compatible
- **WHEN** a plugin registers `{ id: "h1", title: "Heading 1" }` with no `run`
- **THEN** `editor.getSlashCommands()` SHALL include the entry verbatim
- **AND** `slashMenuChange` SHALL emit it as part of the filtered `commands` array unchanged

#### Scenario: Executable command exposes run on the emitted entry
- **WHEN** a plugin registers `{ id: "h1", title: "Heading 1", run: (e) => toggleHeading(e, 1) }`
- **THEN** every emission of `slashMenuChange` SHALL carry that `run` reference on the matching command
- **AND** the host UI invoking it with the editor SHALL toggle the current line into a level-1 heading

### Requirement: Slash Command Ranking

`filterSlashCommands(commands, query)` SHALL rank candidates deterministically by relevance, returning only matching entries. With an empty query the original registration order SHALL be preserved.

The ranking tiers, highest to lowest:
1. Exact case-insensitive title match.
2. Title starts with the query (shorter titles rank above longer ones).
3. Exact keyword match.
4. Title contains the query (earlier offset ranks above later).
5. Keyword starts with the query (shorter keyword wins).
6. Keyword contains the query (earlier offset wins).

Within the same tier, ties SHALL be broken alphabetically by title for stability.

#### Scenario: Empty query keeps registration order
- **WHEN** `filterSlashCommands` is called with an empty query against `[Heading, Table, Bold]`
- **THEN** the returned order SHALL be `[Heading, Table, Bold]`

#### Scenario: Title prefix beats keyword prefix
- **WHEN** the registered commands are `[ {id: "highlight", title: "Highlight"}, {id: "heading", title: "Heading", keywords: ["h1"]} ]`
- **AND** the query is `"h"`
- **THEN** `Heading` SHALL appear before `Highlight` (both share the title-prefix tier; `Heading` is alphabetically first)

#### Scenario: Exact title beats all
- **WHEN** the commands are `[ {id: "table", title: "Table"}, {id: "tb", title: "TB", keywords: ["table"]} ]`
- **AND** the query is `"table"`
- **THEN** `Table` SHALL be ranked first (exact title) and `TB` second (exact keyword)

#### Scenario: Non-matching commands are filtered out
- **WHEN** no candidate has a title containing the query and no keyword contains it
- **THEN** the result SHALL be an empty array

### Requirement: Slash Menu Result Limit

`computeSlashState(doc, cursor, commands, options?)` SHALL accept an optional `{ limit }` numeric option (default `8`) and trim the returned `commands` array to at most that many entries **after** ranking. `EditorConfig.slashMenuLimit` SHALL flow through to the same option inside `createEditor`.

#### Scenario: Default limit caps the result at eight
- **WHEN** `commands` contains 20 entries all matching the query
- **AND** no explicit limit is supplied
- **THEN** the returned `commands` array SHALL have length 8
- **AND** SHALL contain the eight highest-ranked entries in ranked order

#### Scenario: Explicit limit overrides the default
- **WHEN** `computeSlashState(doc, cursor, commands, { limit: 3 })` is called against 10 matching entries
- **THEN** the result SHALL have length 3

#### Scenario: Limit of zero returns an empty list
- **WHEN** `{ limit: 0 }` is passed
- **THEN** the returned `commands` SHALL be `[]`
- **AND** `isOpen` SHALL remain `true` so the UI may still show an empty state

#### Scenario: EditorConfig flows the limit through
- **WHEN** `createEditor({ slashMenuLimit: 4, plugins: [{ name: "t", slashCommands: <20 cmds> }], ... })` is constructed
- **AND** the user types a slash query matching all twenty commands
- **THEN** the emitted `slashMenuChange.commands` SHALL contain exactly 4 entries
