## ADDED Requirements

### Requirement: Widget Interaction Guards

The system SHALL provide a declarative mechanism for widgets to protect interactive content from being destroyed during CM6 decoration rebuilds.

#### Scenario: Widget with focus guard preserves DOM during editing

- **GIVEN** a widget with `interactionGuards: [{ type: 'focus', acquire, release }]`
- **WHEN** the user clicks into the widget (acquiring the focus guard)
- **AND** a CM6 transaction fires (e.g., from a keystroke)
- **THEN** the widget's DOM SHALL NOT be destroyed and recreated
- **AND** the decoration SHALL be mapped via `decos.map(tr.changes)` instead of rebuilt

#### Scenario: Widget without guards keeps current behavior

- **GIVEN** a widget with no `interactionGuards` field
- **WHEN** a CM6 transaction fires
- **THEN** the decoration SHALL be rebuilt normally (current behavior)

#### Scenario: Guard release allows rebuild

- **GIVEN** a widget with an active focus guard
- **WHEN** the guard is released (e.g., on blur)
- **THEN** the next transaction SHALL rebuild decorations normally

### Requirement: WidgetRenderContext Guard API

The system SHALL expose `acquireGuard(type)` and `releaseGuard(type)` on `WidgetRenderContext` so widget authors can manage guards from their render functions.

#### Scenario: Acquire guard from render function

- **GIVEN** a widget's render function receives a `WidgetRenderContext`
- **WHEN** the render function calls `ctx.acquireGuard('focus')`
- **THEN** the widget's focus guard SHALL be active
- **AND** subsequent transactions SHALL skip decoration rebuilds for this widget

#### Scenario: Release guard from event handler

- **GIVEN** a widget with an active focus guard
- **WHEN** the widget's blur handler calls `ctx.releaseGuard('focus')`
- **THEN** the focus guard SHALL be deactivated
- **AND** the next transaction SHALL rebuild decorations normally

### Requirement: Guard Leak Prevention

The system SHALL automatically release all guards for a widget when its DOM is destroyed.

#### Scenario: Destroy releases all guards

- **GIVEN** a widget with active guards
- **WHEN** the widget's DOM is destroyed (e.g., document changes remove the AST node)
- **THEN** all guards for that widget SHALL be released
- **AND** subsequent transactions SHALL rebuild decorations normally
