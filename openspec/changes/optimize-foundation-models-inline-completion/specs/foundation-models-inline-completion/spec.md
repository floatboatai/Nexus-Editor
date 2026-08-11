## Purpose

Provides a macOS-only inline completion capability that uses Apple Foundation Models efficiently while preserving editor responsiveness, user privacy, and safe fallback behavior on unsupported platforms.

## ADDED Requirements

### Requirement: Localized suggestion context extraction

The system SHALL determine inline-completion eligibility and request context from the cursor's local paragraph without materializing the full document text on every editor update.

#### Scenario: Large document cursor update
- **WHEN** the user moves or edits the cursor at the end of a normal prose paragraph in a large document
- **THEN** the system evaluates only the local paragraph context required for the suggestion request
- **AND** the editor remains responsive while typing and moving the cursor

#### Scenario: Ineligible Markdown region
- **WHEN** the cursor is inside or after an ineligible Markdown region such as a heading, list, block quote, fenced code block, table, or unfinished inline syntax
- **THEN** the system does not request a Foundation Models suggestion
- **AND** no visible inline suggestion is rendered

### Requirement: Superseded native suggestions are cancelled

The system SHALL provide an explicit cancellation path for the active native Foundation Models suggestion request when the renderer no longer needs the result.

#### Scenario: User continues typing before a result arrives
- **WHEN** a suggestion request is in flight and the user changes the document or cursor position
- **THEN** the previous request is marked stale in the renderer
- **AND** the active native generation is cancelled or superseded before a new request is started
- **AND** the stale result cannot render or alter the document

#### Scenario: Suggestion UI is cleared
- **WHEN** the user presses Escape, blurs the editor, disables the setting, or the plugin is disposed
- **THEN** any visible suggestion is removed
- **AND** the active native generation is cancelled if one exists

### Requirement: Prompt and output budgets are bounded

The system SHALL keep Foundation Models requests bounded by sending only the minimum paragraph context required for a next-sentence inline suggestion and by constraining generated output to short plain text.

#### Scenario: Very long paragraph
- **WHEN** the cursor is at the end of a prose paragraph longer than the configured context budget
- **THEN** the system sends only the bounded suffix of that paragraph to Foundation Models
- **AND** the suggestion remains based on the local paragraph rather than document-wide context

#### Scenario: Model returns verbose text
- **WHEN** Foundation Models returns explanations, Markdown, multiple alternatives, line breaks, or text longer than the inline suggestion budget
- **THEN** the system normalizes the response to one short plain-text inline suggestion or treats it as no suggestion

### Requirement: Repeated requests use a privacy-preserving short-lived cache

The system SHALL cache repeated suggestion results only in process memory, using a short time-to-live and a cache key that accounts for normalized paragraph content and prompt/model version.

#### Scenario: Same paragraph requested again within the cache window
- **WHEN** the same eligible paragraph context is requested again before the cache entry expires
- **THEN** the system returns the cached suggestion or cached null result without starting a new native generation

#### Scenario: Context or configuration changes
- **WHEN** the paragraph text, prompt version, model profile, availability state, or feature enabled state changes
- **THEN** the previous cache entry is not used for the new request

#### Scenario: Application process ends
- **WHEN** the Electron application process exits
- **THEN** cached paragraph content and suggestion results are discarded
- **AND** no persistent cache of document text is written

### Requirement: Performance observability excludes document text

The system SHALL expose opt-in development metrics for the inline completion lifecycle without logging or persisting user document text.

#### Scenario: Development metrics enabled
- **WHEN** development diagnostics are enabled during manual verification
- **THEN** the system can report timings and counters for debounce, context extraction, cache hits, native request duration, cancellation, stale results, and rendered suggestions
- **AND** the metrics do not include raw paragraph text or generated suggestion text

#### Scenario: Development metrics disabled
- **WHEN** diagnostics are not explicitly enabled
- **THEN** the system avoids additional user-visible logging and preserves the existing completion behavior
