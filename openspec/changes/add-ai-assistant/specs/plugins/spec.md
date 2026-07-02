## ADDED Requirements

### Requirement: AI Assistant Uses OpenAI-Compatible User Configuration

`plugin-ai-assistant` SHALL provide an AI assistant that calls an OpenAI-compatible Chat Completions API using user-supplied configuration. The plugin MUST NOT include a built-in API key and MUST NOT persist the API key to localStorage or disk by default.

#### Scenario: User supplies API configuration
- **WHEN** the user enters an API key, base URL, and model in the assistant panel
- **THEN** the assistant SHALL use those values for subsequent OpenAI-compatible requests
- **AND** the API key SHALL remain in memory only by default

#### Scenario: Missing required configuration
- **WHEN** the user sends a message without an API key or model
- **THEN** the assistant SHALL show an error
- **AND** no document changes SHALL be applied

### Requirement: AI Assistant Supports Bounded Tool Calling

`plugin-ai-assistant` SHALL let the model request editor tools through OpenAI-compatible `tool_calls`. The assistant MUST validate tool names and JSON arguments, execute only known tools, and stop after a bounded number of tool rounds.

#### Scenario: Model requests a read tool
- **WHEN** the model returns a `tool_calls` entry for `readDocument`
- **THEN** the assistant SHALL execute the tool
- **AND** it SHALL append a `role: "tool"` message with the tool result before continuing the loop

#### Scenario: Tool loop reaches the limit
- **WHEN** the model continues requesting tools past the configured maximum
- **THEN** the assistant SHALL stop the loop
- **AND** it SHALL show a user-visible error

### Requirement: AI Assistant Exposes Safe Editor Tools

`plugin-ai-assistant` SHALL expose tools for reading the document, reading the selection, searching text, setting the selection, reading the table of contents, and proposing document edits. The plugin MUST validate document ranges before accepting write operations.

#### Scenario: Search before edit
- **WHEN** the model requests `searchText`
- **THEN** the assistant SHALL return matching ranges and previews from the current document

#### Scenario: Invalid range is rejected
- **WHEN** the model requests `replaceRange` with an invalid range
- **THEN** the assistant SHALL return a tool error
- **AND** the editor document SHALL remain unchanged

### Requirement: AI Assistant Requires Approval For Writes

`plugin-ai-assistant` SHALL treat write tools as pending operations. It MUST NOT apply `replaceRange`, `insertAt`, or `replaceSelection` until the user explicitly approves the pending operation.

#### Scenario: Write tool creates pending operation
- **WHEN** the model requests `replaceRange`
- **THEN** the assistant SHALL create a pending operation with before and after previews
- **AND** the editor document SHALL remain unchanged

#### Scenario: User applies pending operation
- **WHEN** the user clicks Apply on a pending operation
- **THEN** the assistant SHALL update the editor document through the existing editor API
- **AND** the operation SHALL be removed from the pending list

#### Scenario: User discards pending operation
- **WHEN** the user clicks Discard on a pending operation
- **THEN** the assistant SHALL remove the operation
- **AND** the editor document SHALL remain unchanged

### Requirement: Electron Demo Provides An AI Assistant Sidebar

The Electron demo SHALL expose the AI assistant through a toolbar toggle and a right-side sidebar panel. The panel SHALL include API configuration fields, conversation messages, error state, and pending edit controls.

#### Scenario: Toggle assistant panel
- **WHEN** the user clicks the AI toolbar button
- **THEN** the Electron demo SHALL show or hide the assistant sidebar

#### Scenario: Pending edit appears in sidebar
- **WHEN** the assistant prepares a write operation
- **THEN** the sidebar SHALL show the pending edit preview
- **AND** it SHALL provide Apply and Discard actions
