## ADDED Requirements

### Requirement: Slash Command ID Matching

`filterSlashCommands(commands, query)` SHALL match command ids
case-insensitively in addition to titles and keywords. An exact id match SHALL use
the exact-title tier, an id prefix match SHALL use the title-prefix tier, and an id
substring match SHALL use the title-substring tier. Within a shared tier, the
existing deterministic tie-breaking rules SHALL apply.

#### Scenario: Command is discoverable by id only

- **WHEN** a command has id `insert-table`, title `Grid`, and no matching keyword
- **AND** the query is `insert`
- **THEN** the command SHALL be returned as an id-prefix match

#### Scenario: ID matching is case-insensitive

- **WHEN** a command has id `Heading-One`
- **AND** the query is `heading-one`
- **THEN** the command SHALL be returned as an exact id match

#### Scenario: Exact id outranks a title prefix

- **WHEN** one command's id is exactly `table`
- **AND** another command's title starts with `table`
- **AND** the query is `table`
- **THEN** the exact-id command SHALL be ranked first

#### Scenario: Existing empty-query behavior is preserved

- **WHEN** the query is empty
- **THEN** commands SHALL remain in registration order regardless of their ids

#### Scenario: Filtering does not mutate input

- **WHEN** commands are ranked using title, id, or keyword matches
- **THEN** the input command array and command objects SHALL remain unchanged
