## ADDED Requirements

### Requirement: Document Structure Analysis

The core package SHALL expose `analyzeDocumentStructure(input, options)` as a pure helper that accepts Markdown text or an mdast `Root` and returns headings, sections, aggregate stats, and machine-readable structure issues. Supported issue types SHALL be limited to `empty-heading`, `heading-level-skip`, `duplicate-heading`, `missing-required-heading`, and `section-too-long`.

#### Scenario: Analyze a Markdown string
- **WHEN** `analyzeDocumentStructure()` receives Markdown text with headings and body content
- **THEN** it SHALL return heading entries in document order
- **AND** it SHALL return section entries and aggregate document stats

#### Scenario: Analyze an mdast Root
- **WHEN** `analyzeDocumentStructure()` receives an mdast `Root`
- **THEN** it SHALL analyze the tree without requiring an editor instance

#### Scenario: Report supported structure issues
- **WHEN** the document contains empty headings, skipped heading levels, duplicate headings, missing required headings, or sections over the configured word limit
- **THEN** the returned `issues` array SHALL include machine-readable entries for those issue types
