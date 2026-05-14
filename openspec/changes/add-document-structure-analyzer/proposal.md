# Change: Add document structure analyzer

## Why
Nexus already exposes Markdown as mdast, but hosts still need to repeat common outline and section analysis when building structured writing tools, report-like editors, and LLM-powered writing assistants.

## What Changes
- Add a pure core helper, `analyzeDocumentStructure(input, options)`.
- Accept either Markdown text or an mdast `Root`.
- Return headings, sections, aggregate stats, and machine-readable structure issues.
- Keep the helper domain-neutral: no AI provider, UI, or medical-specific behavior.

## Impact
- Affected specs: `editor-core`
- Affected code: `packages/core/src/document-structure.ts`, `packages/core/src/index.ts`, `packages/core/test/document-structure.test.ts`, `README.md`, `README.zh.md`
- New dependencies: none
