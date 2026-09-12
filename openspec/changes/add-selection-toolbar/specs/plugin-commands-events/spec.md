## ADDED Requirements

### Requirement: Cancellable pending command invocation

`CommandContext` SHALL accept an optional `AbortSignal`. The existing command service SHALL preserve that signal through context resolution and SHALL check cancellation and command registration liveness immediately before invoking the command callback. Cancellation SHALL produce an unsuccessful command result and SHALL NOT invoke the callback. This contract SHALL be independent of the originating UI or command provider.

#### Scenario: Source invalidated during context resolution

- **WHEN** an invocation is awaiting editor-context resolution and its signal is aborted
- **THEN** its callback SHALL NOT run when resolution completes

#### Scenario: Provider unloaded while pending

- **WHEN** a command registration is removed or quiesced during context resolution
- **THEN** its pending callback SHALL NOT run

#### Scenario: Existing caller without a signal

- **WHEN** an active command is executed without a cancellation signal
- **THEN** its existing execution behavior SHALL be preserved

### Requirement: Callable commands may be omitted from the palette

A command definition MAY set `showInCommandPalette: false`. The runtime SHALL keep that command available to explicit lookup and execution while omitting it from command-palette results. Omission of the option SHALL preserve current visibility.

#### Scenario: Compatibility entrypoint

- **WHEN** an old command ID forwards to a canonical command and is hidden from the palette
- **THEN** explicit execution of the old ID SHALL remain supported
- **AND** the palette SHALL show only the canonical action
