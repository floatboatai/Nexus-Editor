# Localization Spec — hand-rolled, strongly-typed i18n

## ADDED Requirements

### Requirement: Core Locale Store

`@floatboat/nexus-core` SHALL expose a single flat `NexusLocale`
interface listing every user-visible editor/plugin string, with
`enLocale`, `zhLocale`, and `resolveLocale(partial)` that shallow-merges
a partial over English. It SHALL also expose a module-level
current-language store: `getLocale()`, `setLocale(partial)`,
`setLocaleCode(code)`, `detectLocaleCode()`, the `LOCALES` record, and
the `NexusLocaleCode` union (`"en" | "zh"`). `enLocale` and `zhLocale`
SHALL have identical key sets, and every value SHALL be non-empty.

#### Scenario: Default locale is English
- **WHEN** the module is loaded without any explicit locale
- **THEN** `getLocale()` SHALL return the English strings

#### Scenario: Switch by code
- **WHEN** `setLocaleCode("zh")` is invoked
- **THEN** `getLocale()` SHALL return the Chinese strings

#### Scenario: Partial merge over English
- **WHEN** `setLocale({ toolbarBold: "加粗" })` is invoked
- **THEN** `getLocale().toolbarBold` SHALL equal `"加粗"`
- **AND** every key not provided SHALL retain the English value

#### Scenario: Detect from browser language
- **WHEN** `navigator.language` starts with `"zh"`
- **THEN** `detectLocaleCode()` SHALL return `"zh"`
- **AND** when it starts with `"en"` it SHALL return `"en"`
- **AND** otherwise it SHALL return `null`

#### Scenario: Locale parity
- **WHEN** both locales are loaded
- **THEN** the key set of `enLocale` SHALL equal the key set of
  `zhLocale`

### Requirement: Editor Construction Seeds the Store

`createEditor({ locale })` SHALL seed the shared locale store with the
provided locale before any plugin factory runs, so plugin UI built
before `createEditor` returns resolves the same strings the editor uses.

#### Scenario: Explicit locale propagates to plugin factories
- **WHEN** `createEditor` is invoked with a Chinese `locale` and a
  toolbar/slash plugin is subsequently constructed
- **THEN** those plugin UIs SHALL render Chinese labels without an
  explicit per-factory locale

#### Scenario: No locale leaves the current store unchanged
- **WHEN** `createEditor` is invoked without a `locale`
- **THEN** the shared store SHALL retain its previous value

### Requirement: Plugin UI Localization

Plugin UI factories (toolbar, slash menu, math widget, search panel,
wordcount bar) SHALL resolve user-visible strings from the shared locale
store at construction time, and SHALL accept an explicit `locale` (or
`labels`) override that takes precedence over the store.

#### Scenario: Toolbar resolves the shared locale
- **WHEN** the store is Chinese and a toolbar is constructed
- **THEN** the bold action's aria-label SHALL equal `"加粗"`

#### Scenario: Explicit locale override wins
- **WHEN** a toolbar is constructed with an explicit English `locale`
  while the store is Chinese
- **THEN** the bold action's aria-label SHALL equal `"Bold"`

#### Scenario: Slash menu empty state
- **WHEN** a slash menu is constructed with a Chinese locale and the
  query has no matches
- **THEN** the empty state SHALL show the Chinese no-matches message

#### Scenario: Labels override in wordcount/search
- **WHEN** a wordcount/search plugin is constructed with explicit
  `labels`
- **THEN** those labels SHALL take precedence over store-derived labels

### Requirement: Host Chrome Localization

The Electron demo host chrome SHALL keep a separate `DemoStrings` table
(toolbar, settings panel, search bar, outline, vault, backlinks, status
line, image widget) with en/zh variants switched by `setDemoLanguage`
and read via `uiStrings()`. The Settings Language select SHALL persist
the `language` value and reload the app to apply it.

#### Scenario: Boot with a Chinese language setting
- **WHEN** the app boots with `settings.language === "zh"`
- **THEN** the toolbar SHALL show `"仓库"` / `"打开"` and the settings
  panel SHALL show Chinese section titles

#### Scenario: Default is English
- **WHEN** no language is configured
- **THEN** `uiStrings()` SHALL return English strings

#### Scenario: Language change persists and reloads
- **WHEN** the user selects a new language in the Settings panel
- **THEN** the selection SHALL be saved to `EditorSettings.language`
- **AND** the app SHALL reload to apply it
