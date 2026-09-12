## ADDED Requirements

### Requirement: UI-independent formatting provider

The `@floatboat/nexus-plugin-formatting` package SHALL own the existing Markdown formatting implementations and expose both direct functions and a runtime `FormattingLifecyclePlugin`. Its runtime provider SHALL register canonical `formatting:*` commands using the existing `CommandService`, own their default hotkeys and the existing color-decoration extension, and mount no toolbar UI. All UI entrypoints SHALL use the same formatting implementations.

#### Scenario: Formatting without toolbar UI

- **WHEN** only the formatting provider is enabled
- **THEN** its commands SHALL be available to the command service and default shortcuts
- **AND** neither global nor selection toolbar UI SHALL be created

#### Scenario: Multiple consumers

- **WHEN** global toolbar, selection toolbar, and slash menu use a formatting operation
- **THEN** they SHALL share its document transformation and final-selection behavior
- **AND** the default shortcut SHALL have one canonical registration

### Requirement: Formatting migration compatibility

Existing public formatting function exports from `plugin-toolbar` SHALL remain re-exports of the new implementations. The legacy `createToolbarPlugin()` entrypoint SHALL preserve its editor contributions. Runtime hosts SHALL explicitly load the formatting provider before UI consumers. Existing `toolbar:*` format command entrypoints registered by the global-toolbar plugin SHALL forward to canonical commands without owning a second formatting implementation or default hotkey set.

#### Scenario: Existing function import

- **WHEN** an application imports `toggleInlineCode` from the existing toolbar package
- **THEN** it SHALL receive the same implementation exported by the formatting package

#### Scenario: Existing runtime command ID

- **WHEN** both the formatting provider and global-toolbar plugin are active and a caller executes `toolbar:bold`
- **THEN** execution SHALL forward to `formatting:bold` with the source editor and cancellation signal preserved

### Requirement: Existing parameterized operations

Parameterized operations such as heading level, text color, and highlight SHALL keep their typed direct-function interfaces. The initial extraction SHALL preserve their behavior without introducing an untyped command argument bus or changing dropdown ownership.

#### Scenario: Global color picker

- **WHEN** the global toolbar applies a chosen color
- **THEN** it SHALL call the shared color operation and preserve the existing rendered result

### Requirement: Preserve user shortcut preferences during extraction

When the host provides `HotkeyService`, the formatting provider SHALL migrate non-default preferences from old `toolbar:*` format IDs to canonical IDs before registering defaults. An existing non-default canonical preference SHALL take precedence. After migration the old forwarding ID SHALL have its default (empty) binding set, so custom bindings do not conflict. Repeated loading SHALL NOT overwrite a user's subsequent restoration of canonical defaults.

#### Scenario: Custom or cleared legacy shortcut

- **WHEN** the user customized or cleared a legacy format shortcut before extraction
- **THEN** the canonical command SHALL retain that choice
- **AND** the compatibility ID SHALL NOT add another active binding

#### Scenario: Canonical preference already exists

- **WHEN** both old and canonical IDs have non-default preferences
- **THEN** migration SHALL preserve the canonical preference
