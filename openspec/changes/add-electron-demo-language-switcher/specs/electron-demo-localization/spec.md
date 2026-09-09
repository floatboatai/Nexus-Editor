## ADDED Requirements

### Requirement: Selectable application language

The Electron demo MUST provide English and Simplified Chinese as selectable interface languages in Settings, and MUST apply the selected language without restarting the application.

#### Scenario: Switch to Simplified Chinese

- **WHEN** the user selects Simplified Chinese in Settings
- **THEN** currently visible product-owned interface text MUST update to Simplified Chinese without an application restart
- **AND** the open vault, active document, editor selection, history, and unsaved content MUST remain unchanged

#### Scenario: Switch back to English

- **WHEN** the user selects English in Settings
- **THEN** currently visible product-owned interface text MUST update to English without an application restart

### Requirement: Localized visible product surfaces

The selected locale MUST cover product-owned toolbar text and tooltips, status labels, Settings fields and options, Vault actions and states, Outline and Backlinks panels, Search controls and results, menus, prompts, confirmations, feedback messages, and accessibility labels. Currently enabled bundled toolbar, slash-command, search, and word-count contributions MUST use the selected locale for visible fixed text.

#### Scenario: Chinese interface coverage

- **WHEN** Simplified Chinese is active and the user opens each built-in panel and menu
- **THEN** its fixed product-owned text and accessibility labels MUST be shown in Simplified Chinese
- **AND** user-authored document content, file names, and folder names MUST remain unchanged

#### Scenario: Dynamic text follows the locale

- **WHEN** a status count, empty state, search result count, validation message, or file-operation message is rendered after switching language
- **THEN** the newly rendered fixed text MUST use the active locale

### Requirement: Persistent and resilient locale selection

The Electron demo MUST persist the selected locale with its existing settings, MUST restore it on the next launch, and MUST fall back to English for absent, invalid, or incomplete locale data.

#### Scenario: Restore saved language

- **WHEN** the application starts after Simplified Chinese was saved
- **THEN** the initial visible interface MUST render in Simplified Chinese

#### Scenario: Load existing or invalid settings

- **WHEN** saved settings omit the locale or contain an unsupported locale value
- **THEN** the application MUST start in English
- **AND** all other valid saved editor settings MUST remain intact

### Requirement: Accessible document language

The Electron demo MUST expose the active interface language through the renderer document language attribute.

#### Scenario: Assistive technology reads the active language

- **WHEN** the active locale changes between English and Simplified Chinese
- **THEN** `document.documentElement.lang` MUST be updated to `en` or `zh-CN` respectively
