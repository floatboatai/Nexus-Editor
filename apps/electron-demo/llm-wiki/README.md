# LLM Wiki Sidecar

This sidecar owns the LLM Wiki project lifecycle for the Electron demo.

## Providers

- `fixture` is the default and CI-safe provider. It uses no API keys, network access, Claude login, or nondeterministic model output.
- `deepseek` reads `.nexus/llm-wiki-schema.md`, asks DeepSeek to extract a `schema_contract`, and requires a ChatGPT-compatible structured JSON compile plan with `schema_contract`, `pages`, and `events`.

## Safety Model

- `ensure` creates `raw/`, `wiki/index.md`, `wiki/log.md`, and `.nexus/llm-wiki-schema.md`.
- `ingest` treats `raw/` as read-only source and writes only inside `wiki/`.
- Before writing `wiki/`, the sidecar validates the schema contract, event elements, page names, frontmatter, sources, links, and write boundaries.
- `lint` validates required pages, generated-page frontmatter, wikilinks, and orphan ordinary wiki pages.
- `query` reads only `.nexus/llm-wiki-schema.md` and `wiki/`. It never reads `raw/`, does not use embeddings or OpenRouter, and does not persist chat history.

This sidecar is a compiled LLM Wiki workflow only. It is not vector RAG, GraphRAG, gbrain, a chat UI, or a token-saving claim.

## Document Queue

Electron persists document parsing state in `.nexus/llm-wiki-state.json`.
Raw document saves mark changed files as `dirty`. Manual mode is the default:
the user submits the current raw document, all dirty documents, or failed
documents from the LLM Wiki Queue panel. Auto mode can submit changed raw
documents after save. The manual or auto submit mode is controlled from
Settings.

Electron reads and writes provider configuration in the sidecar
`apps/electron-demo/llm-wiki/.env` file. Commit `.env.example` as the template;
do not commit local `.env` values. The default provider is `fixture`. DeepSeek
submissions require `DEEPSEEK_API_KEY` in the sidecar `.env`.

DeepSeek submissions run at raw-document granularity. The Electron main process
allows at most four raw documents to be `submitting` at the same time. While
DeepSeek is pending, the document remains `submitting`; success moves it to
`parsed`, and failures move it to `failed` with a redacted error.

The sidecar command for a single document is:

```bash
python apps/electron-demo/llm-wiki/llm_wiki.py ingest-file --project ./tmp/wiki-project --raw raw/source.md --provider deepseek
```

## Commands

```bash
python apps/electron-demo/llm-wiki/llm_wiki.py ensure --project ./tmp/wiki-project

python apps/electron-demo/llm-wiki/llm_wiki.py ingest --project ./tmp/wiki-project --provider fixture

python apps/electron-demo/llm-wiki/llm_wiki.py ingest --project ./tmp/wiki-project --provider deepseek

python apps/electron-demo/llm-wiki/llm_wiki.py lint --project ./tmp/wiki-project

python apps/electron-demo/llm-wiki/llm_wiki.py query --project ./tmp/wiki-project --question "What changed?"
```
