from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from datetime import date
from pathlib import Path
from typing import Any, Callable


HttpPost = Callable[[str, dict[str, str], dict[str, Any], float], dict[str, Any]]
SUPPORTED_RAW_EXTENSIONS = {".md", ".markdown", ".txt"}
REQUIRED_FRONTMATTER_KEYS = {"title", "type", "sources", "updated"}
WIKILINK_RE = re.compile(r"\[\[([^\]#|]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]")
PAGE_TYPES = {"concept", "system", "debate", "compiled-note"}
DEEPSEEK_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
EVENT_REQUIRED_KEYS = {
    "slug",
    "title",
    "time",
    "actors",
    "location",
    "action",
    "object",
    "outcome",
    "sources",
    "confidence",
}
KNOWN_ENV_KEYS = {
    "LLM_WIKI_PROVIDER",
    "LLM_WIKI_PYTHON",
    "LLM_WIKI_TIMEOUT_MS",
    "LLM_WIKI_DEBOUNCE_MS",
    "LLM_WIKI_MAX_STDOUT_BYTES",
    "LLM_WIKI_DEEPSEEK_BASE_URL",
    "LLM_WIKI_DEEPSEEK_MODEL",
    "DEEPSEEK_API_KEY",
}


class LLMWikiError(Exception):
    pass


class JSONArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise LLMWikiError(message)


def sidecar_dir() -> Path:
    return Path(__file__).resolve().parent


def schema_template() -> str:
    path = sidecar_dir() / "schema.md"
    if path.exists():
        return path.read_text(encoding="utf-8")
    return "# LLM Wiki Schema\n\nRead raw/ and write linked Markdown pages into wiki/.\n"


def read_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    result: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key not in KNOWN_ENV_KEYS:
            continue
        result[key] = value.strip().strip("\"'")
    return result


def sidecar_env() -> dict[str, str]:
    return read_env_file(sidecar_dir() / ".env")


def sanitize_provider_error(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value)).strip()
    text = re.sub(r"\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET)[A-Za-z0-9_]*)\s*=\s*[^,\s;]+", r"\1=[redacted]", text)
    text = re.sub(r"sk-[A-Za-z0-9_-]{8,}", "sk-[redacted]", text)
    return text[:500]


def http_post_json(url: str, headers: dict[str, str], payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise LLMWikiError(f"DeepSeek HTTP error {exc.code}: {sanitize_provider_error(detail)}") from exc
    except urllib.error.URLError as exc:
        raise LLMWikiError(f"DeepSeek URL error: {sanitize_provider_error(str(exc.reason))}") from exc
    except OSError as exc:
        raise LLMWikiError(f"DeepSeek request failed: {sanitize_provider_error(str(exc))}") from exc

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LLMWikiError("DeepSeek response was not valid JSON") from exc
    if not isinstance(parsed, dict):
        raise LLMWikiError("DeepSeek response JSON must be an object")
    return parsed


def deepseek_config(env: dict[str, str] | None = None) -> dict[str, str]:
    merged = sidecar_env() if env is None else dict(env)
    api_key = merged.get("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        raise LLMWikiError("DEEPSEEK_API_KEY is required for provider=deepseek")
    base_url = merged.get("LLM_WIKI_DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip().rstrip("/")
    model = merged.get("LLM_WIKI_DEEPSEEK_MODEL", "deepseek-v4-pro").strip()
    return {"api_key": api_key, "base_url": base_url or "https://api.deepseek.com", "model": model or "deepseek-v4-pro"}


def project_path(value: str | Path) -> Path:
    return Path(value).expanduser().resolve()


def ensure_project(project: str | Path) -> dict[str, Any]:
    root = project_path(project)
    if root.exists() and not root.is_dir():
        raise LLMWikiError(f"Project is not a directory: {root}")

    raw_dir = root / "raw"
    wiki_dir = root / "wiki"
    nexus_dir = root / ".nexus"
    created: list[str] = []
    for path, label in ((raw_dir, "raw"), (wiki_dir, "wiki"), (nexus_dir, ".nexus")):
        if not path.exists():
            created.append(label)
    raw_dir.mkdir(parents=True, exist_ok=True)
    wiki_dir.mkdir(parents=True, exist_ok=True)
    nexus_dir.mkdir(parents=True, exist_ok=True)

    schema_path = nexus_dir / "llm-wiki-schema.md"
    if not schema_path.exists():
        schema_path.write_text(schema_template(), encoding="utf-8")
        created.append(".nexus/llm-wiki-schema.md")

    index_path = wiki_dir / "index.md"
    if not index_path.exists():
        index_path.write_text(
            "---\n"
            'title: "LLM Wiki Index"\n'
            "type: index\n"
            "sources: []\n"
            f"updated: {date.today().isoformat()}\n"
            "---\n\n"
            "# LLM Wiki Index\n\n"
            "No compiled pages yet.\n",
            encoding="utf-8",
        )
        created.append("wiki/index.md")

    log_path = wiki_dir / "log.md"
    if not log_path.exists():
        log_path.write_text(
            "---\n"
            'title: "LLM Wiki Log"\n'
            "type: log\n"
            "sources: []\n"
            f"updated: {date.today().isoformat()}\n"
            "---\n\n"
            "# LLM Wiki Log\n\n",
            encoding="utf-8",
        )
        created.append("wiki/log.md")

    return {
        "ok": True,
        "operation": "ensure",
        "project": str(root),
        "paths": ["raw", "wiki", ".nexus/llm-wiki-schema.md", "wiki/index.md", "wiki/log.md"],
        "created": created,
    }


def validate_slug(slug: str) -> str:
    value = slug.strip()
    if not value:
        raise LLMWikiError("Slug cannot be empty")
    if any(ord(ch) < 32 for ch in value):
        raise LLMWikiError(f"Slug contains control characters: {slug!r}")
    if value.startswith(("/", "\\")):
        raise LLMWikiError(f"Slug cannot be absolute: {slug}")
    if "\\" in value or "/" in value:
        raise LLMWikiError(f"Slug cannot contain path separators: {slug}")
    if value in {".", ".."} or ".." in value:
        raise LLMWikiError(f"Slug cannot escape the wiki directory: {slug}")
    return value


def slugify(value: str, fallback: str = "untitled") -> str:
    text = value.strip() or fallback
    text = re.sub(r"[\\/]+", " ", text)
    text = re.sub(r"[^\w\s.-]+", " ", text, flags=re.UNICODE)
    text = re.sub(r"[\s_]+", "-", text.strip().lower())
    text = re.sub(r"-{2,}", "-", text).strip(".-")
    return validate_slug(text or fallback)


def posix_rel(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def assert_inside(root: Path, target: Path) -> Path:
    base = root.resolve()
    candidate = target.resolve()
    try:
        candidate.relative_to(base)
    except ValueError as exc:
        raise LLMWikiError(f"Path escapes root: {target}") from exc
    return candidate


def first_heading(content: str) -> str | None:
    for line in content.splitlines():
        match = re.match(r"^\s*#\s+(.+?)\s*$", line)
        if match:
            return match.group(1)
    return None


def first_summary_line(content: str) -> str:
    for line in content.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            return stripped[:240]
    return "Compiled from the source note."


def collect_raw_files(project: Path) -> list[Path]:
    raw_dir = project / "raw"
    if not raw_dir.exists():
        return []
    files = [
        p
        for p in raw_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in SUPPORTED_RAW_EXTENSIONS and not p.name.startswith(".")
    ]
    return sorted(files, key=lambda p: p.relative_to(raw_dir).as_posix().lower())


def build_fixture_plan(project: Path) -> list[dict[str, str]]:
    raw_files = collect_raw_files(project)
    if not raw_files:
        raise LLMWikiError("No raw markdown files found")

    used_slugs: set[str] = set()
    entries: list[dict[str, str]] = []
    for raw_file in raw_files:
        content = raw_file.read_text(encoding="utf-8")
        title = first_heading(content) or raw_file.stem
        base_slug = slugify(title)
        slug = base_slug
        suffix = 2
        while slug in used_slugs:
            slug = f"{base_slug}-{suffix}"
            suffix += 1
        used_slugs.add(slug)
        source = posix_rel(raw_file, project)
        entries.append(
            {
                "slug": slug,
                "title": title,
                "source": source,
                "summary": first_summary_line(content),
            }
        )
    return entries


def validate_plan(project: Path, entries: list[dict[str, str]]) -> list[dict[str, str]]:
    raw_dir = project / "raw"
    validated: list[dict[str, str]] = []
    for entry in entries:
        slug = validate_slug(str(entry.get("slug", "")))
        title = str(entry.get("title", "")).strip()
        source = str(entry.get("source", "")).strip().replace("\\", "/")
        summary = str(entry.get("summary", "")).strip()
        if not title:
            raise LLMWikiError(f"Missing title for slug {slug}")
        if not source:
            raise LLMWikiError(f"Missing source for slug {slug}")
        source_path = assert_inside(raw_dir, project / source)
        if not source_path.exists():
            raise LLMWikiError(f"Source does not exist for slug {slug}: {source}")
        validated.append({"slug": slug, "title": title, "source": source, "summary": summary})
    return validated


def write_generated_page(project: Path, entry: dict[str, str]) -> str:
    today = date.today().isoformat()
    slug = validate_slug(entry["slug"])
    target = assert_inside(project / "wiki", project / "wiki" / f"{slug}.md")
    body = (
        "---\n"
        f"title: {json.dumps(entry['title'], ensure_ascii=False)}\n"
        "type: compiled-note\n"
        "sources:\n"
        f"  - {entry['source']}\n"
        f"updated: {today}\n"
        "---\n\n"
        f"# {entry['title']}\n\n"
        f"{entry['summary']}\n\n"
        f"Source: `{entry['source']}`\n\n"
        "Back to [[index]].\n"
    )
    target.write_text(body, encoding="utf-8")
    return posix_rel(target, project)


def write_index(project: Path, entries: list[dict[str, str]]) -> str:
    today = date.today().isoformat()
    lines = [
        "---",
        'title: "LLM Wiki Index"',
        "type: index",
        "sources:",
    ]
    lines.extend(f"  - {entry['source']}" for entry in entries)
    lines.extend(
        [
            f"updated: {today}",
            "---",
            "",
            "# LLM Wiki Index",
            "",
            "Compiled pages:",
            "",
        ]
    )
    lines.extend(f"- [[{entry['slug']}|{entry['title']}]]" for entry in entries)
    target = project / "wiki" / "index.md"
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return posix_rel(target, project)


def append_log(project: Path, entries: list[dict[str, str]]) -> str:
    target = project / "wiki" / "log.md"
    if not target.exists():
        ensure_project(project)
    existing = target.read_text(encoding="utf-8")
    today = date.today().isoformat()
    entry_lines = [
        f"\n## [{today}] ingest | fixture provider",
        "",
        f"- compiled pages: {len(entries)}",
    ]
    entry_lines.extend(f"- [[{entry['slug']}]] from `{entry['source']}`" for entry in entries)
    target.write_text(existing.rstrip() + "\n" + "\n".join(entry_lines) + "\n", encoding="utf-8")
    return posix_rel(target, project)


@contextmanager
def project_write_lock(project: Path):
    ensure_project(project)
    lock_path = project / ".nexus" / "llm-wiki-write.lock"
    deadline = time.monotonic() + 30
    fd: int | None = None
    while fd is None:
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode("utf-8"))
        except FileExistsError as exc:
            if time.monotonic() >= deadline:
                raise LLMWikiError("Timed out waiting for LLM Wiki write lock") from exc
            time.sleep(0.05)
    try:
        yield
    finally:
        if fd is not None:
            os.close(fd)
        try:
            lock_path.unlink()
        except FileNotFoundError:
            pass


def existing_wiki_page_sources(project: Path, slug: str) -> list[str] | None:
    page_path = project / "wiki" / f"{validate_slug(slug)}.md"
    if not page_path.exists():
        return None
    frontmatter = parse_frontmatter(page_path.read_text(encoding="utf-8"))
    if frontmatter is None:
        return []
    return frontmatter_sources(frontmatter)


def sources_belong_to_raw(sources: list[str] | None, submitted_raw: str) -> bool:
    return sources is not None and set(sources) == {submitted_raw}


def ensure_wiki_slug_available_for_raw(project: Path, slug: str, submitted_raw: str, label: str) -> None:
    sources = existing_wiki_page_sources(project, slug)
    if sources is None or sources_belong_to_raw(sources, submitted_raw):
        return
    raise LLMWikiError(f"{label} slug already belongs to another raw: {slug}")


def unique_wiki_slug_for_raw(project: Path, base_slug: str, submitted_raw: str) -> str:
    slug = validate_slug(base_slug)
    suffix = 2
    while True:
        sources = existing_wiki_page_sources(project, slug)
        if sources is None or sources_belong_to_raw(sources, submitted_raw):
            return slug
        slug = f"{base_slug}-{suffix}"
        suffix += 1


def ensure_deepseek_pages_available_for_raw(project: Path, pages: list[dict[str, Any]], submitted_raw: str) -> None:
    for page in pages:
        ensure_wiki_slug_available_for_raw(project, page["slug"], submitted_raw, f"page {page['slug']}")


def collect_wiki_index_entries(project: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for page in sorted((project / "wiki").glob("*.md"), key=lambda p: p.stem.lower()):
        if page.name in {"index.md", "log.md"}:
            continue
        frontmatter = parse_frontmatter(page.read_text(encoding="utf-8"))
        if frontmatter is None:
            continue
        title = scalar_frontmatter_value(frontmatter, "title") or page.stem
        sources = frontmatter_sources(frontmatter)
        entries.append({"slug": page.stem, "title": title, "sources": sources})
    return entries


def rebuild_index_from_wiki(project: Path) -> str:
    today = date.today().isoformat()
    entries = collect_wiki_index_entries(project)
    sources = sorted({source for entry in entries for source in entry["sources"]})
    lines = ["---", 'title: "LLM Wiki Index"', "type: index", "sources:"]
    lines.extend(f"  - {source}" for source in sources)
    lines.extend([f"updated: {today}", "---", "", "# LLM Wiki Index", "", "Compiled pages:", ""])
    lines.extend(f"- [[{entry['slug']}|{entry['title']}]]" for entry in entries)
    target = project / "wiki" / "index.md"
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return posix_rel(target, project)


def load_project_schema(project: Path) -> str:
    schema_path = project / ".nexus" / "llm-wiki-schema.md"
    if not schema_path.exists():
        raise LLMWikiError("Project schema is missing: .nexus/llm-wiki-schema.md")
    schema = schema_path.read_text(encoding="utf-8").strip()
    if not schema:
        raise LLMWikiError("Project schema is empty: .nexus/llm-wiki-schema.md")
    return schema


def schema_contract_list(value: Any, label: str, allow_absent: bool = False) -> list[str]:
    if value is None and allow_absent:
        return []
    if not isinstance(value, list):
        raise LLMWikiError(f"schema_contract {label} must be a list")
    result: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise LLMWikiError(f"schema_contract {label} entries must be strings")
        path = item.strip().replace("\\", "/")
        if not path or path.startswith("/") or re.match(r"^[A-Za-z]:", path) or ".." in path or "\\" in item:
            raise LLMWikiError(f"schema_contract {label} contains unsafe path: {item}")
        result.append(path)
    return result


def validate_schema_special_files(value: Any) -> None:
    special_files = schema_contract_list(value, "special_files")
    required = {"wiki/index.md", "wiki/log.md"}
    if not required.issubset(set(special_files)):
        raise LLMWikiError("schema_contract special_files must include wiki/index.md and wiki/log.md")
    for path in special_files:
        if not path.startswith("wiki/") or path in {"wiki/", "wiki"}:
            raise LLMWikiError(f"schema_contract special_files must stay under wiki/: {path}")


def validate_schema_operations(value: Any) -> None:
    if not isinstance(value, dict) or not {"ingest", "query", "lint"}.issubset(value):
        raise LLMWikiError("schema_contract operations must include ingest, query, lint")
    for name in ("ingest", "query", "lint"):
        if not isinstance(value.get(name), dict):
            raise LLMWikiError(f"schema_contract operations.{name} must be an object")

    ingest = value["ingest"]
    ingest_writes = schema_contract_list(ingest.get("writes"), "operations.ingest.writes")
    ingest_never_writes = schema_contract_list(ingest.get("never_writes"), "operations.ingest.never_writes")
    schema_contract_list(ingest.get("reads"), "operations.ingest.reads", allow_absent=True)
    if "wiki/" not in ingest_writes:
        raise LLMWikiError("schema_contract operations.ingest.writes must include wiki/")
    if any(not path.startswith("wiki/") for path in ingest_writes):
        raise LLMWikiError("schema_contract operations.ingest.writes must stay under wiki/")
    if "raw/" not in ingest_never_writes:
        raise LLMWikiError("schema_contract operations.ingest.never_writes must include raw/")

    query = value["query"]
    schema_contract_list(query.get("reads"), "operations.query.reads", allow_absent=True)
    query_never_reads = schema_contract_list(query.get("never_reads"), "operations.query.never_reads")
    if "raw/" not in query_never_reads:
        raise LLMWikiError("schema_contract operations.query.never_reads must include raw/")

    lint = value["lint"]
    schema_contract_list(lint.get("reads"), "operations.lint.reads", allow_absent=True)
    lint_writes = schema_contract_list(lint.get("writes"), "operations.lint.writes", allow_absent=True)
    if lint_writes:
        raise LLMWikiError("schema_contract operations.lint.writes must be empty")


def validate_schema_contract(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise LLMWikiError("schema_contract must be an object")
    required = {"page_naming", "frontmatter_required", "link_syntax", "event_schema", "special_files", "operations"}
    missing = required - set(value)
    if missing:
        raise LLMWikiError(f"schema_contract missing keys: {', '.join(sorted(missing))}")

    frontmatter = value.get("frontmatter_required")
    if not isinstance(frontmatter, list) or not REQUIRED_FRONTMATTER_KEYS.issubset({str(item) for item in frontmatter}):
        raise LLMWikiError("schema_contract frontmatter_required must include title, type, sources, updated")

    validate_schema_special_files(value.get("special_files"))
    validate_schema_operations(value.get("operations"))

    event_schema = value.get("event_schema")
    if not isinstance(event_schema, list) or not EVENT_REQUIRED_KEYS.issubset({str(item) for item in event_schema}):
        raise LLMWikiError("schema_contract event_schema is incomplete")
    return value


def parse_deepseek_content(response: dict[str, Any]) -> dict[str, Any]:
    try:
        content = response["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMWikiError("DeepSeek response missing choices[0].message.content") from exc
    if not isinstance(content, str) or not content.strip():
        raise LLMWikiError("DeepSeek content must be a non-empty JSON string")
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise LLMWikiError("DeepSeek content was not valid JSON") from exc
    if not isinstance(parsed, dict):
        raise LLMWikiError("DeepSeek content JSON must be an object")
    return parsed


def read_raw_inputs(project: Path) -> list[dict[str, str]]:
    raw_files = collect_raw_files(project)
    if not raw_files:
        raise LLMWikiError("No raw markdown files found")
    return [
        {
            "path": posix_rel(raw_file, project),
            "content": raw_file.read_text(encoding="utf-8")[:20000],
        }
        for raw_file in raw_files
    ]


def normalize_raw_argument(project: Path, raw_path: str) -> tuple[str, Path]:
    raw = str(raw_path).strip()
    if (
        not raw.startswith("raw/")
        or raw in {"raw/", "raw/.md"}
        or raw.startswith("/")
        or re.match(r"^[A-Za-z]:", raw)
        or "\\" in raw
        or ".." in raw.split("/")
    ):
        raise LLMWikiError(f"raw path is invalid: {raw_path}")
    absolute = assert_inside(project / "raw", project / raw)
    if not absolute.is_file() or absolute.suffix.lower() not in SUPPORTED_RAW_EXTENSIONS:
        raise LLMWikiError(f"raw path does not exist or is not supported: {raw}")
    return posix_rel(absolute, project), absolute


def read_single_raw_input(project: Path, raw_path: str) -> dict[str, str]:
    raw, absolute = normalize_raw_argument(project, raw_path)
    return {"path": raw, "content": absolute.read_text(encoding="utf-8")[:20000]}


def collect_wiki_context(project: Path, max_files: int = 40, max_chars: int = 120000) -> list[dict[str, str]]:
    wiki_dir = project / "wiki"
    if not wiki_dir.exists():
        raise LLMWikiError("wiki directory is missing")

    markdown_files = {page.name: page for page in wiki_dir.glob("*.md") if page.is_file()}
    ordered: list[Path] = []
    for name in ("index.md", "log.md"):
        page = markdown_files.pop(name, None)
        if page is not None:
            ordered.append(page)
    ordered.extend(markdown_files[name] for name in sorted(markdown_files, key=str.lower))

    context: list[dict[str, str]] = []
    remaining_chars = max_chars
    for page in ordered[:max_files]:
        if remaining_chars <= 0:
            break
        content = page.read_text(encoding="utf-8")
        if len(content) > remaining_chars:
            content = content[:remaining_chars]
        context.append({"path": posix_rel(page, project), "content": content})
        remaining_chars -= len(content)

    if not context:
        raise LLMWikiError("No wiki context found")
    return context


def build_deepseek_compile_payload(config: dict[str, str], schema: str, raw_inputs: list[dict[str, str]]) -> dict[str, Any]:
    json_shape = {
        "schema_contract": {
            "page_naming": "flat lowercase hyphen markdown pages under wiki",
            "frontmatter_required": ["title", "type", "sources", "updated"],
            "link_syntax": "[[slug]]",
            "event_schema": sorted(EVENT_REQUIRED_KEYS),
            "special_files": ["wiki/index.md", "wiki/log.md"],
            "operations": {
                "ingest": {"reads": ["raw/"], "writes": ["wiki/"], "never_writes": ["raw/"]},
                "query": {"reads": ["wiki/"], "never_reads": ["raw/"]},
                "lint": {"reads": ["wiki/"], "writes": []},
            },
        },
        "pages": [
            {
                "slug": "lowercase-hyphen-slug",
                "title": "Page title",
                "type": "concept",
                "sources": ["raw/source.md"],
                "events": ["event-slug"],
                "body": "Markdown body. Use wikilinks only for generated page slugs, [[index]], or [[log]].",
            }
        ],
        "events": [
            {
                "slug": "event-slug",
                "title": "Event title",
                "time": "unknown",
                "actors": ["actor"],
                "location": "unknown",
                "action": "described",
                "object": "source material",
                "outcome": "wiki page generated",
                "sources": ["raw/source.md"],
                "confidence": "medium",
            }
        ],
    }
    user_content = (
        "Compile the raw inputs into LLM Wiki pages. Return only json matching json_shape. "
        "raw/ is read-only. Write only wiki/. Validate the LLM Wiki Schema before extracting pages and events.\n\n"
        "Every wikilink in page body must target one of the returned page slugs, [[index]], or [[log]]. "
        "Use plain text instead of wikilinks for concepts that are not returned as pages.\n\n"
        "json_shape:\n"
        f"{json.dumps(json_shape, ensure_ascii=False, indent=2)}\n\n"
        "LLM Wiki Schema:\n"
        f"{schema}\n\n"
        "Raw inputs:\n"
        f"{json.dumps(raw_inputs, ensure_ascii=False, indent=2)}"
    )
    return {
        "model": config["model"],
        "messages": [
            {
                "role": "system",
                "content": "You extract a schema_contract, pages, and events for an LLM Wiki. Respond with valid json only.",
            },
            {"role": "user", "content": user_content},
        ],
        "response_format": {"type": "json_object"},
        "thinking": {"type": "enabled"},
        "reasoning_effort": "high",
        "stream": False,
    }


def build_deepseek_query_payload(
    config: dict[str, str],
    schema: str,
    question: str,
    wiki_context: list[dict[str, str]],
) -> dict[str, Any]:
    json_shape = {
        "answer": "Answer grounded only in compiled wiki context, or say the compiled wiki is insufficient.",
        "citations": [{"path": "wiki/page.md", "quote": "short supporting quote"}],
    }
    user_content = (
        "Answer the question from compiled wiki context only. Cite wiki pages. "
        "Do not use raw/ files or outside knowledge. If the compiled wiki context is insufficient, "
        "say the compiled wiki is insufficient. Return only json matching json_shape.\n\n"
        "json_shape:\n"
        f"{json.dumps(json_shape, ensure_ascii=False, indent=2)}\n\n"
        "LLM Wiki Schema:\n"
        f"{schema}\n\n"
        "Question:\n"
        f"{question}\n\n"
        "Compiled wiki context:\n"
        f"{json.dumps(wiki_context, ensure_ascii=False, indent=2)}"
    )
    return {
        "model": config["model"],
        "messages": [
            {
                "role": "system",
                "content": "You answer questions against an LLM Wiki. Respond with valid json only.",
            },
            {"role": "user", "content": user_content},
        ],
        "response_format": {"type": "json_object"},
        "thinking": {"type": "enabled"},
        "reasoning_effort": "high",
        "stream": False,
    }


def validate_query_answer(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise LLMWikiError("query answer must be an object")
    answer = value.get("answer")
    if not isinstance(answer, str) or not answer.strip():
        raise LLMWikiError("query answer must include a non-empty answer")
    citations = value.get("citations")
    if not isinstance(citations, list):
        raise LLMWikiError("query answer citations must be a list")

    validated_citations: list[dict[str, str]] = []
    for citation in citations:
        if not isinstance(citation, dict):
            raise LLMWikiError("query answer citation must be an object")
        path = citation.get("path")
        if not isinstance(path, str):
            raise LLMWikiError("query answer citation path must be a string")
        normalized = path.strip().replace("\\", "/")
        if (
            not normalized.startswith("wiki/")
            or not normalized.endswith(".md")
            or normalized in {"wiki/", "wiki/.md"}
            or normalized.startswith("/")
            or re.match(r"^[A-Za-z]:", normalized)
            or ".." in normalized
        ):
            raise LLMWikiError(f"query answer citation path is invalid: {path}")
        validated: dict[str, str] = {"path": normalized}
        quote = citation.get("quote")
        if quote is not None:
            if not isinstance(quote, str):
                raise LLMWikiError("query answer citation quote must be a string")
            validated["quote"] = quote[:500]
        validated_citations.append(validated)

    return {"answer": answer.strip(), "citations": validated_citations}


def validate_deepseek_slug(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise LLMWikiError(f"{label} slug must be a string")
    slug = validate_slug(value)
    if not DEEPSEEK_SLUG_RE.match(slug):
        raise LLMWikiError(f"{label} slug must be lowercase hyphen format: {slug}")
    return slug


def validate_raw_source(project: Path, value: Any) -> str:
    if not isinstance(value, str):
        raise LLMWikiError("source path must be a string")
    source = value.strip().replace("\\", "/")
    if not source.startswith("raw/"):
        raise LLMWikiError(f"source must be under raw/: {source}")
    source_path = assert_inside(project / "raw", project / source)
    if not source_path.is_file():
        raise LLMWikiError(f"source does not exist: {source}")
    return posix_rel(source_path, project)


def validate_source_list(project: Path, value: Any, label: str) -> list[str]:
    if not isinstance(value, list) or not value:
        raise LLMWikiError(f"{label} sources must be a non-empty list")
    return [validate_raw_source(project, item) for item in value]


def validate_submitted_source_list(project: Path, value: Any, label: str, submitted_raw: str) -> list[str]:
    if not isinstance(value, list) or not value:
        raise LLMWikiError(f"{label} sources must be a non-empty list")
    for source in value:
        if not isinstance(source, str) or source != submitted_raw:
            raise LLMWikiError(f"{label} source must match submitted raw: {submitted_raw}")
    return validate_source_list(project, value, label)


def sanitize_body_wikilinks(body: str, allowed_slugs: set[str]) -> str:
    def replace(match: re.Match[str]) -> str:
        target = match.group(1).strip()
        if target in allowed_slugs:
            return match.group(0)
        return target

    return WIKILINK_RE.sub(replace, body)


def validate_deepseek_pages(project: Path, pages: Any) -> list[dict[str, Any]]:
    if not isinstance(pages, list) or not pages:
        raise LLMWikiError("pages must be a non-empty list")
    seen: set[str] = set()
    validated: list[dict[str, Any]] = []
    for page in pages:
        if not isinstance(page, dict):
            raise LLMWikiError("page must be an object")
        slug = validate_deepseek_slug(page.get("slug"), "page")
        if slug in seen:
            raise LLMWikiError(f"duplicate page slug: {slug}")
        seen.add(slug)
        title = str(page.get("title", "")).strip()
        page_type = str(page.get("type", "")).strip()
        body = str(page.get("body", "")).strip()
        if not title:
            raise LLMWikiError(f"page {slug} title is required")
        if page_type not in PAGE_TYPES:
            raise LLMWikiError(f"page {slug} type is invalid: {page_type}")
        if not isinstance(page.get("events"), list):
            raise LLMWikiError(f"page {slug} events must be a list")
        if not body:
            raise LLMWikiError(f"page {slug} body is required")
        validated.append(
            {
                "slug": slug,
                "title": title,
                "type": page_type,
                "sources": validate_source_list(project, page.get("sources"), f"page {slug}"),
                "events": [validate_deepseek_slug(event, f"page {slug} event") for event in page["events"]],
                "body": body,
            }
        )
    return validated


def validate_deepseek_references(
    pages: list[dict[str, Any]], events: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    event_slugs = {event["slug"] for event in events}
    page_slugs = {page["slug"] for page in pages} | {"index", "log"}
    normalized: list[dict[str, Any]] = []

    for page in pages:
        missing_events = [event for event in page["events"] if event not in event_slugs]
        if missing_events:
            raise LLMWikiError(f"page {page['slug']} references missing event: {missing_events[0]}")
        next_page = dict(page)
        next_page["body"] = sanitize_body_wikilinks(page["body"], page_slugs)
        normalized.append(next_page)

    return normalized


def validate_deepseek_events(project: Path, events: Any) -> list[dict[str, Any]]:
    if not isinstance(events, list):
        raise LLMWikiError("events must be a list")
    validated: list[dict[str, Any]] = []
    seen: set[str] = set()
    for event in events:
        if not isinstance(event, dict):
            raise LLMWikiError("event must be an object")
        missing = EVENT_REQUIRED_KEYS - set(event)
        if missing:
            raise LLMWikiError(f"event missing required keys: {', '.join(sorted(missing))}")
        slug = validate_deepseek_slug(event.get("slug"), "event")
        if slug in seen:
            raise LLMWikiError(f"duplicate event slug: {slug}")
        seen.add(slug)
        actors = event.get("actors")
        if not isinstance(actors, list) or not [actor for actor in actors if str(actor).strip()]:
            raise LLMWikiError(f"event {slug} actors must be a non-empty list")
        confidence = str(event.get("confidence", "")).strip()
        if confidence not in {"high", "medium", "low"}:
            raise LLMWikiError(f"event {slug} confidence must be high, medium, or low")
        normalized = {
            "slug": slug,
            "title": str(event.get("title", "")).strip(),
            "time": str(event.get("time", "")).strip(),
            "actors": [str(actor).strip() for actor in actors if str(actor).strip()],
            "location": str(event.get("location", "")).strip(),
            "action": str(event.get("action", "")).strip(),
            "object": str(event.get("object", "")).strip(),
            "outcome": str(event.get("outcome", "")).strip(),
            "sources": validate_source_list(project, event.get("sources"), f"event {slug}"),
            "confidence": confidence,
        }
        for key in ("title", "time", "location", "action", "object", "outcome"):
            if not normalized[key]:
                raise LLMWikiError(f"event {slug} {key} is required")
        validated.append(normalized)
    return validated


def validate_deepseek_pages_for_raw(project: Path, pages: Any, submitted_raw: str) -> list[dict[str, Any]]:
    if isinstance(pages, list):
        for page in pages:
            if isinstance(page, dict):
                validate_submitted_source_list(project, page.get("sources"), f"page {page.get('slug', '')}", submitted_raw)
    pages_out = validate_deepseek_pages(project, pages)
    normalized: list[dict[str, Any]] = []
    for page in pages_out:
        next_page = dict(page)
        next_page["sources"] = validate_submitted_source_list(
            project, page["sources"], f"page {page['slug']}", submitted_raw
        )
        normalized.append(next_page)
    return normalized


def validate_deepseek_events_for_raw(project: Path, events: Any, submitted_raw: str) -> list[dict[str, Any]]:
    if isinstance(events, list):
        for event in events:
            if isinstance(event, dict):
                validate_submitted_source_list(
                    project, event.get("sources"), f"event {event.get('slug', '')}", submitted_raw
                )
    events_out = validate_deepseek_events(project, events)
    normalized: list[dict[str, Any]] = []
    for event in events_out:
        next_event = dict(event)
        next_event["sources"] = validate_submitted_source_list(
            project, event["sources"], f"event {event['slug']}", submitted_raw
        )
        normalized.append(next_event)
    return normalized


def write_deepseek_page(project: Path, page: dict[str, Any], events: dict[str, dict[str, Any]]) -> str:
    today = date.today().isoformat()
    slug = validate_deepseek_slug(page["slug"], "page")
    target = assert_inside(project / "wiki", project / "wiki" / f"{slug}.md")
    lines = [
        "---",
        f"title: {json.dumps(page['title'], ensure_ascii=False)}",
        f"type: {page['type']}",
        "sources:",
    ]
    lines.extend(f"  - {source}" for source in page["sources"])
    lines.extend([f"updated: {today}", "---", "", f"# {page['title']}", "", page["body"].rstrip(), "", "## Events", ""])
    if page["events"]:
        for event_slug in page["events"]:
            event = events.get(event_slug)
            if event is None:
                raise LLMWikiError(f"page {slug} references missing event: {event_slug}")
            lines.extend(
                [
                    f"### {event['title']}",
                    "",
                    f"- Time: {event['time']}",
                    f"- Actors: {', '.join(event['actors'])}",
                    f"- Location: {event['location']}",
                    f"- Action: {event['action']}",
                    f"- Object: {event['object']}",
                    f"- Outcome: {event['outcome']}",
                    f"- Confidence: {event['confidence']}",
                    f"- Sources: {', '.join(event['sources'])}",
                    "",
                ]
            )
    else:
        lines.extend(["No structured events extracted.", ""])
    target.write_text("\n".join(lines), encoding="utf-8")
    return posix_rel(target, project)


def write_deepseek_index(project: Path, pages: list[dict[str, Any]]) -> str:
    today = date.today().isoformat()
    sources = sorted({source for page in pages for source in page["sources"]})
    lines = ["---", 'title: "LLM Wiki Index"', "type: index", "sources:"]
    lines.extend(f"  - {source}" for source in sources)
    lines.extend([f"updated: {today}", "---", "", "# LLM Wiki Index", "", "Compiled pages:", ""])
    lines.extend(f"- [[{page['slug']}|{page['title']}]]" for page in pages)
    target = project / "wiki" / "index.md"
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return posix_rel(target, project)


def append_deepseek_log(project: Path, pages: list[dict[str, Any]], events: list[dict[str, Any]]) -> str:
    target = project / "wiki" / "log.md"
    if not target.exists():
        ensure_project(project)
    existing = target.read_text(encoding="utf-8")
    today = date.today().isoformat()
    entry_lines = [
        f"\n## [{today}] ingest | deepseek provider",
        "",
        f"- compiled pages: {len(pages)}",
        f"- extracted events: {len(events)}",
    ]
    entry_lines.extend(f"- [[{page['slug']}]] from `{', '.join(page['sources'])}`" for page in pages)
    target.write_text(existing.rstrip() + "\n" + "\n".join(entry_lines) + "\n", encoding="utf-8")
    return posix_rel(target, project)


def ingest_project(
    project: str | Path,
    provider: str = "fixture",
    env: dict[str, str] | None = None,
    http_post: HttpPost = http_post_json,
) -> dict[str, Any]:
    root = project_path(project)
    ensure_project(root)

    if provider == "fixture":
        entries = build_fixture_plan(root)
    elif provider == "malformed-fixture":
        entries = [{"slug": "../escape", "title": "Bad", "source": "raw/note.md", "summary": "Bad"}]
    else:
        entries = []

    if provider in {"fixture", "malformed-fixture"}:
        validated = validate_plan(root, entries)
        written = [write_index(root, validated), append_log(root, validated)]
        written.extend(write_generated_page(root, entry) for entry in validated)
    elif provider == "deepseek":
        config = deepseek_config(env)
        schema = load_project_schema(root)
        raw_inputs = read_raw_inputs(root)
        payload = build_deepseek_compile_payload(config, schema, raw_inputs)
        response = http_post(
            f"{config['base_url']}/chat/completions",
            {"Authorization": f"Bearer {config['api_key']}"},
            payload,
            120.0,
        )
        content = parse_deepseek_content(response)
        validate_schema_contract(content.get("schema_contract"))
        pages = validate_deepseek_pages(root, content.get("pages"))
        events = validate_deepseek_events(root, content.get("events"))
        pages = validate_deepseek_references(pages, events)
        event_map = {event["slug"]: event for event in events}
        written = [write_deepseek_index(root, pages), append_deepseek_log(root, pages, events)]
        written.extend(write_deepseek_page(root, page, event_map) for page in pages)
    else:
        raise LLMWikiError(f"Unsupported provider: {provider}")

    lint = lint_project(root)
    return {
        "ok": lint["ok"],
        "operation": "ingest",
        "provider": provider,
        "written": written,
        "issues": lint["issues"],
    }


def ingest_file_project(
    project: str | Path,
    raw_path: str,
    provider: str = "fixture",
    env: dict[str, str] | None = None,
    http_post: HttpPost = http_post_json,
) -> dict[str, Any]:
    root = project_path(project)
    ensure_project(root)
    submitted_raw, _absolute = normalize_raw_argument(root, raw_path)

    if provider == "fixture":
        raw_input = read_single_raw_input(root, submitted_raw)
        title = first_heading(raw_input["content"]) or Path(submitted_raw).stem
        with project_write_lock(root):
            entry = {
                "slug": unique_wiki_slug_for_raw(root, slugify(title), submitted_raw),
                "title": title,
                "source": submitted_raw,
                "summary": first_summary_line(raw_input["content"]),
            }
            validated = validate_plan(root, [entry])
            written = [write_generated_page(root, item) for item in validated]
            written.append(rebuild_index_from_wiki(root))
            written.append(append_log(root, validated))
        lint = lint_project(root)
        return {
            "ok": lint["ok"],
            "operation": "ingest-file",
            "provider": provider,
            "raw": submitted_raw,
            "written": written,
            "pages": [item["slug"] for item in validated],
            "events": [],
            "issues": lint["issues"],
        }

    if provider != "deepseek":
        raise LLMWikiError(f"Unsupported provider: {provider}")

    config = deepseek_config(env)
    schema = load_project_schema(root)
    raw_input = read_single_raw_input(root, submitted_raw)
    payload = build_deepseek_compile_payload(config, schema, [raw_input])
    response = http_post(
        f"{config['base_url']}/chat/completions",
        {"Authorization": f"Bearer {config['api_key']}"},
        payload,
        120.0,
    )
    content = parse_deepseek_content(response)
    validate_schema_contract(content.get("schema_contract"))
    pages = validate_deepseek_pages_for_raw(root, content.get("pages"), submitted_raw)
    events = validate_deepseek_events_for_raw(root, content.get("events"), submitted_raw)
    pages = validate_deepseek_references(pages, events)
    event_map = {event["slug"]: event for event in events}
    with project_write_lock(root):
        ensure_deepseek_pages_available_for_raw(root, pages, submitted_raw)
        written = [write_deepseek_page(root, page, event_map) for page in pages]
        written.append(rebuild_index_from_wiki(root))
        written.append(append_deepseek_log(root, pages, events))
    lint = lint_project(root)
    return {
        "ok": lint["ok"],
        "operation": "ingest-file",
        "provider": provider,
        "raw": submitted_raw,
        "written": written,
        "pages": [page["slug"] for page in pages],
        "events": [event["slug"] for event in events],
        "issues": lint["issues"],
        "usage": response.get("usage") if isinstance(response.get("usage"), dict) else {},
    }


def query_project(
    project: str | Path,
    question: str,
    env: dict[str, str] | None = None,
    http_post: HttpPost = http_post_json,
) -> dict[str, Any]:
    root = project_path(project)
    ensure_project(root)
    if not question.strip():
        raise LLMWikiError("question is required")
    config = deepseek_config(env)
    schema = load_project_schema(root)
    wiki_context = collect_wiki_context(root)
    payload = build_deepseek_query_payload(config, schema, question.strip(), wiki_context)
    response = http_post(
        f"{config['base_url']}/chat/completions",
        {"Authorization": f"Bearer {config['api_key']}"},
        payload,
        120.0,
    )
    answer = validate_query_answer(parse_deepseek_content(response))
    return {
        "ok": True,
        "operation": "query",
        "answer": answer["answer"],
        "citations": answer["citations"],
        "read": [entry["path"] for entry in wiki_context],
        "usage": response.get("usage") if isinstance(response.get("usage"), dict) else {},
    }


def parse_frontmatter(content: str) -> dict[str, Any] | None:
    if not content.startswith("---\n"):
        return None
    end = content.find("\n---", 4)
    if end < 0:
        return None
    frontmatter = content[4:end].strip().splitlines()
    result: dict[str, Any] = {}
    current_key = ""
    for line in frontmatter:
        key_match = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if key_match:
            current_key = key_match.group(1).strip()
            result[current_key] = key_match.group(2).strip()
            continue
        item_match = re.match(r"^\s*-\s*(.+?)\s*$", line)
        if item_match and current_key:
            existing = result.get(current_key)
            if not isinstance(existing, list):
                result[current_key] = []
            result[current_key].append(item_match.group(1).strip())
            continue
    return result


def scalar_frontmatter_value(frontmatter: dict[str, Any], key: str) -> str:
    value = frontmatter.get(key, "")
    if isinstance(value, list):
        return ""
    return str(value).strip().strip("\"'")


def frontmatter_sources(frontmatter: dict[str, Any]) -> list[str]:
    value = frontmatter.get("sources")
    if isinstance(value, list):
        return [str(item).strip().strip("\"'") for item in value if str(item).strip().strip("\"'")]
    text = str(value or "").strip()
    if text.startswith("[") and text.endswith("]"):
        inner = text[1:-1].strip()
        if not inner:
            return []
        return [item.strip().strip("\"'") for item in inner.split(",") if item.strip().strip("\"'")]
    cleaned = text.strip("\"'")
    return [cleaned] if cleaned else []


def frontmatter_value_issues(frontmatter: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    if not scalar_frontmatter_value(frontmatter, "title"):
        issues.append("title must be non-empty")
    if not scalar_frontmatter_value(frontmatter, "type"):
        issues.append("type must be non-empty")
    if not frontmatter_sources(frontmatter):
        issues.append("sources must contain at least one source")

    updated = scalar_frontmatter_value(frontmatter, "updated")
    try:
        parsed = date.fromisoformat(updated)
    except ValueError:
        parsed = None
    if parsed is None or parsed.isoformat() != updated:
        issues.append("updated must be an ISO date YYYY-MM-DD")
    return issues


def markdown_targets(project: Path) -> set[str]:
    targets: set[str] = set()
    for md in project.rglob("*.md"):
        if any(part in {".git", "node_modules"} for part in md.parts):
            continue
        rel = md.relative_to(project).as_posix()
        without_ext = rel[:-3] if rel.endswith(".md") else rel
        targets.add(without_ext.lower())
        targets.add(md.stem.lower())
    return targets


def link_target_variants(target: str) -> list[str]:
    value = target.strip().replace("\\", "/").lower()
    if value.endswith(".md"):
        value = value[:-3]
    variants = [value]
    if "/" not in value:
        variants.append(f"wiki/{value}")
        variants.append(f"raw/{value}")
    return variants


def lint_project(project: str | Path) -> dict[str, Any]:
    root = project_path(project)
    wiki_dir = root / "wiki"
    issues: list[dict[str, str]] = []

    if not wiki_dir.exists():
        issues.append({"code": "missing-wiki-dir", "path": "wiki", "message": "wiki directory is missing"})
        return {"ok": False, "operation": "lint", "issues": issues}

    for required in ("index.md", "log.md"):
        if not (wiki_dir / required).exists():
            issues.append(
                {"code": "missing-required-page", "path": f"wiki/{required}", "message": f"{required} is missing"}
            )

    all_targets = markdown_targets(root)
    linked_targets: set[str] = set()
    wiki_pages = sorted(wiki_dir.glob("*.md"), key=lambda p: p.name.lower())
    for page in wiki_pages:
        rel = posix_rel(page, root)
        content = page.read_text(encoding="utf-8")
        frontmatter = parse_frontmatter(content)
        if page.name not in {"index.md", "log.md"}:
            if frontmatter is None:
                issues.append({"code": "missing-frontmatter", "path": rel, "message": "frontmatter is missing"})
            else:
                missing = sorted(REQUIRED_FRONTMATTER_KEYS - set(frontmatter))
                if missing:
                    issues.append(
                        {
                            "code": "incomplete-frontmatter",
                            "path": rel,
                            "message": f"missing frontmatter keys: {', '.join(missing)}",
                        }
                    )
                else:
                    value_issues = frontmatter_value_issues(frontmatter)
                    if value_issues:
                        issues.append(
                            {
                                "code": "invalid-frontmatter",
                                "path": rel,
                                "message": "; ".join(value_issues),
                            }
                        )

        for match in WIKILINK_RE.finditer(content):
            target = match.group(1).strip()
            variants = link_target_variants(target)
            linked_targets.update(variants)
            if not any(variant in all_targets for variant in variants):
                issues.append({"code": "broken-link", "path": rel, "message": f"unresolved wikilink: {target}"})

    for page in wiki_pages:
        if page.name in {"index.md", "log.md"}:
            continue
        stem = page.stem.lower()
        if stem not in linked_targets and f"wiki/{stem}" not in linked_targets:
            issues.append({"code": "orphan-page", "path": posix_rel(page, root), "message": "page is not linked"})

    return {"ok": len(issues) == 0, "operation": "lint", "issues": issues}


def run_cli(argv: list[str]) -> tuple[str, int]:
    parser = JSONArgumentParser(prog="llm_wiki.py")
    sub = parser.add_subparsers(dest="command", required=True, parser_class=JSONArgumentParser)

    ensure_parser = sub.add_parser("ensure")
    ensure_parser.add_argument("--project", required=True)

    ingest_parser = sub.add_parser("ingest")
    ingest_parser.add_argument("--project", required=True)
    ingest_parser.add_argument("--provider", default="fixture")

    ingest_file_parser = sub.add_parser("ingest-file")
    ingest_file_parser.add_argument("--project", required=True)
    ingest_file_parser.add_argument("--raw", required=True)
    ingest_file_parser.add_argument("--provider", default="fixture")

    lint_parser = sub.add_parser("lint")
    lint_parser.add_argument("--project", required=True)

    query_parser = sub.add_parser("query")
    query_parser.add_argument("--project", required=True)
    query_parser.add_argument("--question", required=True)

    try:
        args = parser.parse_args(argv)
        if args.command == "ensure":
            result = ensure_project(args.project)
        elif args.command == "ingest":
            result = ingest_project(args.project, args.provider)
        elif args.command == "ingest-file":
            result = ingest_file_project(args.project, args.raw, args.provider)
        elif args.command == "lint":
            result = lint_project(args.project)
        elif args.command == "query":
            result = query_project(args.project, args.question)
        else:
            raise LLMWikiError(f"Unknown command: {args.command}")
        return json.dumps(result, ensure_ascii=False), 0 if result.get("ok") else 1
    except Exception as exc:
        operation = argv[0] if argv else "unknown"
        payload = {"ok": False, "operation": operation, "error": str(exc)}
        return json.dumps(payload, ensure_ascii=False), 1


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except AttributeError:
            pass
    payload, exit_code = run_cli(sys.argv[1:])
    print(payload)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
