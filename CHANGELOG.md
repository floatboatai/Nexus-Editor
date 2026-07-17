# Changelog

All notable user-facing changes to this project are documented in this file.

## [Unreleased] - 2026-07-16

### Added

- A Fuzzy toggle in the existing editor search panel.
- Ordered previous/next navigation and character-level fuzzy-match highlighting.
- Empty-state feedback when a fuzzy query has no result.
- Plugin-scoped temporary markers for fuzzy-match results inside rendered Live Preview links.

### Changed

- Search-panel icon controls, focus feedback, and hover labels now align with toolbar interaction styles.
- Aligned header baselines across Vault, the editor toolbar, Outline, and Backlinks in the Electron demo.
- Kept fuzzy state, navigation, and link-marker cleanup inside `plugin-search`; no editor-core API or dependency changes were introduced.

### Fixed

- Prevented rendered Markdown link widgets from covering fuzzy highlights.
- Prevented toolbar tooltip layout from causing scrollbar flicker on hover.
- Corrected search tooltip cleanup and fullscreen mounting behavior.
