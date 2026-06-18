## ADDED Requirements

### Requirement: Search Query History Scope

`@floatboat/nexus-plugin-search` SHALL provide an opt-in search query history capability as the first stage of Roadmap #16 ("Command / search history"). This change SHALL cover only search queries submitted through the search panel. Slash command history and persisted recently-used slash command ordering SHALL remain follow-up work outside this PR.

#### Scenario: Search-only first stage
- **WHEN** a host enables search query history on `createSearchPlugin()`
- **THEN** the search panel SHALL record and recall search queries
- **AND** `@floatboat/nexus-plugin-slash` behavior SHALL remain unchanged

#### Scenario: Slash history remains a follow-up
- **WHEN** a reviewer evaluates this change against Roadmap #16
- **THEN** the proposal SHALL identify `plugin-slash` command history and recently-used command persistence as non-goals
- **AND** those behaviors SHALL NOT be required for this PR to be complete

### Requirement: Opt-In Backward Compatibility

Search query history SHALL be disabled by default. When disabled, the search panel SHALL preserve existing search input, match navigation, replacement, case-sensitive, regexp, and whole-word behavior.

#### Scenario: Default search behavior is unchanged
- **WHEN** a host creates `createSearchPlugin()` without history options
- **AND** the user submits a query from the search input
- **THEN** the editor SHALL navigate matches as before
- **AND** no history storage SHALL be read or written

#### Scenario: Search options are preserved
- **GIVEN** search query history is enabled
- **AND** the user toggles case-sensitive, regexp, or whole-word options
- **WHEN** the user recalls a query from history
- **THEN** the recalled query SHALL NOT reset those options

### Requirement: Host-Injected Persistence

Search query history SHALL support host-injected storage for persistence. The plugin SHALL NOT implicitly write to global `localStorage`; persistent storage must be provided explicitly by the host.

#### Scenario: Host storage persists history
- **GIVEN** the host enables search query history with storage that supports `getItem` and `setItem`
- **WHEN** the user submits a valid search query
- **THEN** the plugin SHALL write the updated query list to the configured storage key

#### Scenario: No implicit global localStorage writes
- **WHEN** a host creates `createSearchPlugin()` without a host-injected history storage
- **THEN** the plugin SHALL NOT write search history to global `localStorage`
- **AND** the editor SHALL continue to operate normally

### Requirement: Query Retention Rules

Search query history SHALL record submitted non-empty queries after trimming whitespace. Repeated queries SHALL be de-duplicated and moved to the front. The retained list SHALL respect `maxEntries`, dropping the oldest entries when the cap is exceeded.

#### Scenario: Trim and record a query
- **WHEN** the user submits the query `"  alpha  "`
- **THEN** the stored history SHALL contain `"alpha"`

#### Scenario: Ignore blank queries
- **WHEN** the user submits a query containing only whitespace
- **THEN** no query SHALL be added to history

#### Scenario: Repeated query moves to front
- **GIVEN** history contains `["beta", "alpha"]`
- **WHEN** the user submits `"alpha"`
- **THEN** history SHALL become `["alpha", "beta"]`

#### Scenario: Max entries drops the oldest query
- **GIVEN** `maxEntries` is `2`
- **WHEN** the user submits `"alpha"`, `"beta"`, and `"gamma"` in that order
- **THEN** history SHALL contain `["gamma", "beta"]`

### Requirement: Storage Failure Resilience

Search query history SHALL treat unavailable storage, thrown `getItem` / `setItem` calls, and invalid JSON as recoverable conditions. These failures SHALL NOT crash the editor or block the search panel from continuing to work.

#### Scenario: Invalid JSON is ignored
- **GIVEN** host storage returns invalid JSON for the configured history key
- **WHEN** the user opens the search panel and submits a new query
- **THEN** the editor SHALL NOT throw
- **AND** the plugin SHALL continue with an empty in-memory history before recording the new query

#### Scenario: Storage getItem throws
- **GIVEN** host storage throws while reading history
- **WHEN** the user opens the search panel
- **THEN** the editor SHALL NOT throw
- **AND** search behavior SHALL remain usable

#### Scenario: Storage setItem throws
- **GIVEN** host storage throws while writing history
- **WHEN** the user submits a valid search query
- **THEN** the editor SHALL NOT throw
- **AND** search behavior SHALL remain usable

### Requirement: Keyboard History Recall

When history is enabled and at least one entry exists, ArrowUp and ArrowDown in the search input SHALL recall previous and next history entries. When history is disabled or empty, these keys SHALL NOT be swallowed by the search panel history handler.

#### Scenario: Arrow keys restore history entries
- **GIVEN** search query history contains `["gamma", "beta", "alpha"]`
- **WHEN** the search input is focused and the user presses ArrowUp
- **THEN** the search input SHALL show `"gamma"`
- **WHEN** the user presses ArrowDown after moving through history
- **THEN** the search input SHALL move toward newer input according to the history cursor

#### Scenario: Empty history does not consume arrow keys
- **GIVEN** search query history is enabled but contains no entries
- **WHEN** the search input is focused and the user presses ArrowUp or ArrowDown
- **THEN** the history handler SHALL NOT prevent the event default

#### Scenario: Disabled history does not consume arrow keys
- **GIVEN** search query history is disabled
- **WHEN** the search input is focused and the user presses ArrowUp or ArrowDown
- **THEN** the history handler SHALL NOT prevent the event default
