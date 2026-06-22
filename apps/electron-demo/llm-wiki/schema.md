# LLM Wiki Schema

This is the human-written rule layer for this LLM Wiki project. It has the same role as a project-local `CLAUDE.md` in the original notebook, but this app stores it at `.nexus/llm-wiki-schema.md` to avoid conflicts with repository agent instructions.

## Layers

- `raw/` contains human-authored source notes. raw/ is read-only during Ingest, Query, and Lint.
- `wiki/` contains generated, human-readable Markdown pages with wikilinks.
- `.nexus/llm-wiki-schema.md` stores this schema inside each project. Do not create a project-root `CLAUDE.md` for this schema.

## Page naming

Generated ordinary wiki pages live directly under `wiki/`.
Use stable lowercase hyphen slugs, for example `compiled-rag.md`.
Do not write generated ordinary pages outside `wiki/`.

## Frontmatter

Every generated ordinary wiki page must start with frontmatter containing:

- `title`: display title.
- `type`: page kind. Use `concept`, `system`, `debate`, or `compiled-note`.
- `sources`: raw file paths used to compile the page.
- `updated`: ISO date of the latest compile.

## Links

Use Obsidian-style wikilinks:

- `[[slug]]`
- `[[slug|label]]`

## Event model

Generated pages should include structured events when the source material describes things that happened.
Each event must contain:

- `slug`: stable lowercase hyphen event id.
- `title`: short event title.
- `time`: date, date range, or `unknown`.
- `actors`: people, organizations, systems, or groups involved.
- `location`: place or `unknown`.
- `action`: what happened.
- `object`: what the action affected.
- `outcome`: result or consequence.
- `sources`: raw file paths supporting the event.
- `confidence`: `high`, `medium`, or `low`.

## Special files

- `wiki/index.md` is the navigation page.
- `wiki/log.md` is the append-only audit log.

## Operations

- Ingest: read `raw/`, read/write `wiki/`, update `index.md` and `log.md`, and never modify `raw/`.
- Query: read only `.nexus/llm-wiki-schema.md` and `wiki/`; never reread `raw/`.
- Lint: read `.nexus/llm-wiki-schema.md` and `wiki/`, report consistency issues, and do not write any layer.

## Structured output

External LLM calls must use ChatGPT-compatible structured JSON output. The compile response must contain `schema_contract`, `pages`, and `events`. Free-form prose outside JSON is invalid.
