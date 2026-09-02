# Implementation Tasks

## 1. Specification

- [x] 1.1 Define case-insensitive exact, prefix, and substring id matching.
- [x] 1.2 Define compatibility requirements for empty queries and existing ranking.

## 2. Core

- [x] 2.1 Extend `filterSlashCommands` scoring to include command ids.
- [x] 2.2 Add core tests for id-only discovery, case-insensitive matching, rank tiers,
  stable ties, and input immutability.

## 3. Plugin and Documentation

- [x] 3.1 Add a plugin-level contract test proving the re-exported helper supports ids.
- [x] 3.2 Update the slash plugin ranking documentation.

## 4. Verification

- [x] 4.1 Run targeted core and slash plugin tests.
- [x] 4.2 Run relevant builds and type checks.
- [x] 4.3 Validate this OpenSpec change in strict mode.
