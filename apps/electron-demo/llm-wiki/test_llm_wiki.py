import concurrent.futures
import json
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import llm_wiki


class LLMWikiSidecarTests(unittest.TestCase):
    def valid_deepseek_contract(self):
        return {
            "page_naming": "flat lowercase hyphen markdown pages under wiki",
            "frontmatter_required": ["title", "type", "sources", "updated"],
            "link_syntax": "[[slug]]",
            "event_schema": [
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
            ],
            "special_files": ["wiki/index.md", "wiki/log.md"],
            "operations": {
                "ingest": {"reads": ["raw/"], "writes": ["wiki/"], "never_writes": ["raw/"]},
                "query": {"reads": ["wiki/"], "never_reads": ["raw/"]},
                "lint": {"reads": ["wiki/"], "writes": []},
            },
        }

    def valid_deepseek_content(self, contract=None):
        return {
            "schema_contract": contract or self.valid_deepseek_contract(),
            "pages": [
                {
                    "slug": "note",
                    "title": "Note",
                    "type": "compiled-note",
                    "sources": ["raw/note.md"],
                    "events": ["note-event"],
                    "body": "Body with [[index]].",
                }
            ],
            "events": [
                {
                    "slug": "note-event",
                    "title": "Note event",
                    "time": "unknown",
                    "actors": ["Compiler"],
                    "location": "unknown",
                    "action": "compiled",
                    "object": "raw note",
                    "outcome": "wiki note generated",
                    "sources": ["raw/note.md"],
                    "confidence": "high",
                }
            ],
        }

    def test_schema_template_defines_contract_fields_for_deepseek_extraction(self):
        schema = llm_wiki.schema_template()

        self.assertIn("Page naming", schema)
        self.assertIn("Frontmatter", schema)
        self.assertIn("[[slug]]", schema)
        self.assertIn("index.md", schema)
        self.assertIn("log.md", schema)
        self.assertIn("Event model", schema)
        self.assertIn("actors", schema)
        self.assertIn("outcome", schema)
        self.assertIn("Structured output", schema)
        self.assertIn("Ingest", schema)
        self.assertIn("Query", schema)
        self.assertIn("Lint", schema)
        self.assertIn("raw/ is read-only", schema)

    def test_read_sidecar_env_loads_known_deepseek_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text(
                "LLM_WIKI_PROVIDER=deepseek\n"
                "LLM_WIKI_DEEPSEEK_BASE_URL=https://api.deepseek.com\n"
                "LLM_WIKI_DEEPSEEK_MODEL=deepseek-v4-pro\n"
                "DEEPSEEK_API_KEY=secret-value\n"
                "UNRELATED_SECRET=must-not-matter\n",
                encoding="utf-8",
            )

            parsed = llm_wiki.read_env_file(env_path)

            self.assertEqual(parsed["LLM_WIKI_PROVIDER"], "deepseek")
            self.assertEqual(parsed["LLM_WIKI_DEEPSEEK_MODEL"], "deepseek-v4-pro")
            self.assertEqual(parsed["DEEPSEEK_API_KEY"], "secret-value")
            self.assertNotIn("UNRELATED_SECRET", parsed)

    def test_ensure_creates_project_structure_without_root_claude_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)

            result = llm_wiki.ensure_project(project)

            self.assertTrue(result["ok"])
            self.assertTrue((project / "raw").is_dir())
            self.assertTrue((project / "wiki" / "index.md").is_file())
            self.assertTrue((project / "wiki" / "log.md").is_file())
            self.assertTrue((project / ".nexus" / "llm-wiki-schema.md").is_file())
            self.assertFalse((project / "CLAUDE.md").exists())

    def test_fixture_ingest_writes_wiki_pages_and_leaves_raw_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            raw = project / "raw" / "Compiled RAG Notes.md"
            original = "# Compiled RAG Notes\n\nCompiled wiki turns raw notes into linked markdown."
            raw.write_text(original, encoding="utf-8")

            result = llm_wiki.ingest_project(project, provider="fixture")

            self.assertTrue(result["ok"])
            self.assertIn("wiki/compiled-rag-notes.md", result["written"])
            self.assertEqual(raw.read_text(encoding="utf-8"), original)
            page = project / "wiki" / "compiled-rag-notes.md"
            self.assertIn("[[index]]", page.read_text(encoding="utf-8"))
            self.assertTrue(llm_wiki.lint_project(project)["ok"])

    def test_ingest_rejects_malformed_provider_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            (project / "raw" / "note.md").write_text("# Note", encoding="utf-8")

            with self.assertRaises(llm_wiki.LLMWikiError):
                llm_wiki.ingest_project(project, provider="malformed-fixture")

    def test_deepseek_ingest_requires_api_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            (project / "raw" / "note.md").write_text("# Note\n\nBody", encoding="utf-8")

            with self.assertRaisesRegex(llm_wiki.LLMWikiError, "DEEPSEEK_API_KEY"):
                llm_wiki.ingest_project(project, provider="deepseek", env={})

    def test_deepseek_ingest_explicit_empty_env_ignores_sidecar_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "project"
            sidecar = Path(tmp) / "sidecar"
            sidecar.mkdir()
            (sidecar / ".env").write_text("DEEPSEEK_API_KEY=secret-value\n", encoding="utf-8")
            llm_wiki.ensure_project(project)
            (project / "raw" / "note.md").write_text("# Note\n\nBody", encoding="utf-8")
            original_sidecar_dir = llm_wiki.sidecar_dir
            called = False

            def fake_http(url, headers, payload, timeout):
                nonlocal called
                called = True
                raise AssertionError("http_post must not be called without explicit env API key")

            llm_wiki.sidecar_dir = lambda: sidecar
            try:
                with self.assertRaisesRegex(llm_wiki.LLMWikiError, "DEEPSEEK_API_KEY"):
                    llm_wiki.ingest_project(project, provider="deepseek", env={}, http_post=fake_http)
            finally:
                llm_wiki.sidecar_dir = original_sidecar_dir
            self.assertFalse(called)

    def test_sanitize_provider_error_redacts_secrets_and_truncates(self):
        value = "failure DEEPSEEK_API_KEY=secret-value token = abc sk-abcdefghijklmnopqrstuvwxyz0123456789 " + (
            "x" * 800
        )

        sanitized = llm_wiki.sanitize_provider_error(value)

        self.assertNotIn("secret-value", sanitized)
        self.assertNotIn("abcdefghijklmnopqrstuvwxyz0123456789", sanitized)
        self.assertIn("DEEPSEEK_API_KEY=[redacted]", sanitized)
        self.assertIn("sk-[redacted]", sanitized)
        self.assertLessEqual(len(sanitized), 500)

    def test_deepseek_ingest_sends_schema_extracts_events_and_writes_valid_pages(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            raw = project / "raw" / "compiled rag.md"
            raw.write_text("# Compiled RAG\n\nCompiled wiki uses schema rules.", encoding="utf-8")
            captured = {}

            def fake_http(url, headers, payload, timeout):
                captured["url"] = url
                captured["payload"] = payload
                return {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "schema_contract": {
                                            "page_naming": "flat lowercase hyphen markdown pages under wiki",
                                            "frontmatter_required": ["title", "type", "sources", "updated"],
                                            "link_syntax": "[[slug]]",
                                            "event_schema": [
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
                                            ],
                                            "special_files": ["wiki/index.md", "wiki/log.md"],
                                            "operations": {
                                                "ingest": {
                                                    "reads": ["raw/"],
                                                    "writes": ["wiki/"],
                                                    "never_writes": ["raw/"],
                                                },
                                                "query": {"reads": ["wiki/"], "never_reads": ["raw/"]},
                                                "lint": {"reads": ["wiki/"], "writes": []},
                                            },
                                        },
                                        "pages": [
                                            {
                                                "slug": "compiled-rag",
                                                "title": "Compiled RAG",
                                                "type": "concept",
                                                "sources": ["raw/compiled rag.md"],
                                                "events": ["compiled-wiki-follows-schema"],
                                                "body": "Compiled wiki follows [[index]] and schema rules.",
                                            }
                                        ],
                                        "events": [
                                            {
                                                "slug": "compiled-wiki-follows-schema",
                                                "title": "Compiled wiki follows schema",
                                                "time": "unknown",
                                                "actors": ["LLM Wiki compiler"],
                                                "location": "unknown",
                                                "action": "compiled",
                                                "object": "raw source into wiki page",
                                                "outcome": "schema-backed page was generated",
                                                "sources": ["raw/compiled rag.md"],
                                                "confidence": "high",
                                            }
                                        ],
                                    },
                                    ensure_ascii=False,
                                )
                            }
                        }
                    ],
                    "usage": {"total_tokens": 42},
                }

            result = llm_wiki.ingest_project(
                project,
                provider="deepseek",
                env={
                    "DEEPSEEK_API_KEY": "test-key",
                    "LLM_WIKI_DEEPSEEK_BASE_URL": "https://api.deepseek.com",
                    "LLM_WIKI_DEEPSEEK_MODEL": "deepseek-v4-pro",
                },
                http_post=fake_http,
            )

            messages_text = json.dumps(captured["payload"]["messages"], ensure_ascii=False)
            self.assertIn("LLM Wiki Schema", messages_text)
            self.assertIn("schema_contract", messages_text)
            self.assertIn("events", messages_text)
            self.assertIn("raw/ is read-only", messages_text)
            self.assertEqual(captured["payload"].get("response_format"), {"type": "json_object"})
            self.assertIn("wiki/compiled-rag.md", result["written"])
            self.assertTrue((project / "wiki" / "compiled-rag.md").is_file())
            self.assertIn("## Events", (project / "wiki" / "compiled-rag.md").read_text(encoding="utf-8"))
            self.assertEqual(raw.read_text(encoding="utf-8"), "# Compiled RAG\n\nCompiled wiki uses schema rules.")

    def test_fixture_ingest_file_reads_only_requested_raw_and_writes_page(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            requested = project / "raw" / "note.md"
            other = project / "raw" / "other.md"
            requested_original = "# Note\n\nRequested source."
            other_original = "# Other\n\nMust not be compiled."
            requested.write_text(requested_original, encoding="utf-8")
            other.write_text(other_original, encoding="utf-8")

            result = llm_wiki.ingest_file_project(project, "raw/note.md", provider="fixture")

            self.assertTrue(result["ok"])
            self.assertEqual(result["operation"], "ingest-file")
            self.assertEqual(result["raw"], "raw/note.md")
            self.assertEqual(result["pages"], ["note"])
            self.assertEqual(result["events"], [])
            self.assertIn("wiki/note.md", result["written"])
            self.assertTrue((project / "wiki" / "note.md").is_file())
            self.assertFalse((project / "wiki" / "other.md").exists())
            self.assertEqual(requested.read_text(encoding="utf-8"), requested_original)
            self.assertEqual(other.read_text(encoding="utf-8"), other_original)

    def test_fixture_ingest_file_concurrent_preserves_index_and_log(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            (project / "raw" / "alpha.md").write_text("# Alpha\n\nFirst source.", encoding="utf-8")
            (project / "raw" / "beta.md").write_text("# Beta\n\nSecond source.", encoding="utf-8")

            def ingest(raw_path):
                return llm_wiki.ingest_file_project(project, raw_path, provider="fixture")

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(ingest, ["raw/alpha.md", "raw/beta.md"]))

            self.assertEqual(sorted(page for result in results for page in result["pages"]), ["alpha", "beta"])
            index = (project / "wiki" / "index.md").read_text(encoding="utf-8")
            log = (project / "wiki" / "log.md").read_text(encoding="utf-8")
            self.assertIn("[[alpha|Alpha]]", index)
            self.assertIn("[[beta|Beta]]", index)
            self.assertIn("raw/alpha.md", log)
            self.assertIn("raw/beta.md", log)

    def test_fixture_ingest_file_uses_unique_slug_for_existing_other_raw(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            (project / "raw" / "a.md").write_text("# Shared\n\nFirst source.", encoding="utf-8")
            (project / "raw" / "b.md").write_text("# Shared\n\nSecond source.", encoding="utf-8")

            first = llm_wiki.ingest_file_project(project, "raw/a.md", provider="fixture")
            second = llm_wiki.ingest_file_project(project, "raw/b.md", provider="fixture")

            self.assertEqual(first["pages"], ["shared"])
            self.assertEqual(second["pages"], ["shared-2"])
            self.assertIn("raw/a.md", (project / "wiki" / "shared.md").read_text(encoding="utf-8"))
            self.assertIn("raw/b.md", (project / "wiki" / "shared-2.md").read_text(encoding="utf-8"))
            index = (project / "wiki" / "index.md").read_text(encoding="utf-8")
            self.assertIn("[[shared|Shared]]", index)
            self.assertIn("[[shared-2|Shared]]", index)

    def test_deepseek_ingest_file_reads_only_requested_raw_and_writes_pages(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            requested = project / "raw" / "note.md"
            other = project / "raw" / "other.md"
            requested.write_text("# Note\n\nRequested source.", encoding="utf-8")
            other.write_text("# Other\n\nMust not be sent.", encoding="utf-8")
            captured = {}
            content = self.valid_deepseek_content()
            content["pages"][0]["sources"] = ["raw/note.md"]
            content["events"][0]["sources"] = ["raw/note.md"]

            def fake_http(url, headers, payload, timeout):
                captured["payload"] = payload
                return {"choices": [{"message": {"content": json.dumps(content)}}]}

            result = llm_wiki.ingest_file_project(
                project,
                "raw/note.md",
                provider="deepseek",
                env={"DEEPSEEK_API_KEY": "test-key"},
                http_post=fake_http,
            )

            raw_inputs = json.dumps(captured["payload"]["messages"], ensure_ascii=False)
            self.assertIn("raw/note.md", raw_inputs)
            self.assertIn("Requested source.", raw_inputs)
            self.assertNotIn("raw/other.md", raw_inputs)
            self.assertNotIn("Must not be sent.", raw_inputs)
            self.assertTrue(result["ok"])
            self.assertEqual(result["operation"], "ingest-file")
            self.assertEqual(result["raw"], "raw/note.md")
            self.assertEqual(result["pages"], ["note"])
            self.assertEqual(result["events"], ["note-event"])
            self.assertIn("wiki/note.md", result["written"])
            self.assertEqual(requested.read_text(encoding="utf-8"), "# Note\n\nRequested source.")

    def test_deepseek_ingest_file_rejects_raw_path_escape(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            (project / "raw" / "note.md").write_text("# Note", encoding="utf-8")

            with self.assertRaisesRegex(llm_wiki.LLMWikiError, "raw path"):
                llm_wiki.ingest_file_project(
                    project,
                    "../note.md",
                    provider="deepseek",
                    env={"DEEPSEEK_API_KEY": "test-key"},
                    http_post=lambda url, headers, payload, timeout: {},
                )

    def test_deepseek_ingest_file_rejects_raw_path_matrix_before_http(self):
        invalid_paths = ["/raw/note.md", "C:/tmp/note.md", "raw/missing.md", "raw/note.pdf"]
        for raw_path in invalid_paths:
            with self.subTest(raw_path=raw_path):
                with tempfile.TemporaryDirectory() as tmp:
                    project = Path(tmp)
                    llm_wiki.ensure_project(project)
                    (project / "raw" / "note.md").write_text("# Note", encoding="utf-8")
                    (project / "raw" / "note.pdf").write_text("not markdown", encoding="utf-8")
                    called = False

                    def fake_http(url, headers, payload, timeout):
                        nonlocal called
                        called = True
                        return {}

                    with self.assertRaisesRegex(llm_wiki.LLMWikiError, "raw path"):
                        llm_wiki.ingest_file_project(
                            project,
                            raw_path,
                            provider="deepseek",
                            env={"DEEPSEEK_API_KEY": "test-key"},
                            http_post=fake_http,
                        )

                    self.assertFalse(called)

    def test_deepseek_ingest_file_rejects_raw_backslash_escape(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            (project / "raw" / "note.md").write_text("# Note", encoding="utf-8")

            with self.assertRaisesRegex(llm_wiki.LLMWikiError, "raw path"):
                llm_wiki.ingest_file_project(
                    project,
                    "raw\\note.md",
                    provider="deepseek",
                    env={"DEEPSEEK_API_KEY": "test-key"},
                    http_post=lambda url, headers, payload, timeout: {},
                )

    def test_deepseek_ingest_file_rejects_provider_sources_for_other_raw_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            (project / "raw" / "note.md").write_text("# Note", encoding="utf-8")
            (project / "raw" / "other.md").write_text("# Other", encoding="utf-8")
            content = self.valid_deepseek_content()
            content["pages"][0]["sources"] = ["raw/other.md"]
            content["events"][0]["sources"] = ["raw/other.md"]

            def fake_http(url, headers, payload, timeout):
                return {"choices": [{"message": {"content": json.dumps(content)}}]}

            with self.assertRaisesRegex(llm_wiki.LLMWikiError, "submitted raw"):
                llm_wiki.ingest_file_project(
                    project,
                    "raw/note.md",
                    provider="deepseek",
                    env={"DEEPSEEK_API_KEY": "test-key"},
                    http_post=fake_http,
                )

            self.assertFalse((project / "wiki" / "note.md").exists())

    def test_deepseek_ingest_file_rejects_provider_source_backslash_alias(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            (project / "raw" / "note.md").write_text("# Note", encoding="utf-8")
            content = self.valid_deepseek_content()
            content["pages"][0]["sources"] = ["raw\\note.md"]
            content["events"][0]["sources"] = ["raw\\note.md"]

            def fake_http(url, headers, payload, timeout):
                return {"choices": [{"message": {"content": json.dumps(content)}}]}

            with self.assertRaisesRegex(llm_wiki.LLMWikiError, "submitted raw"):
                llm_wiki.ingest_file_project(
                    project,
                    "raw/note.md",
                    provider="deepseek",
                    env={"DEEPSEEK_API_KEY": "test-key"},
                    http_post=fake_http,
                )

            self.assertFalse((project / "wiki" / "note.md").exists())

    def test_deepseek_ingest_file_rejects_provider_source_dot_alias(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            (project / "raw" / "note.md").write_text("# Note", encoding="utf-8")
            content = self.valid_deepseek_content()
            content["pages"][0]["sources"] = ["raw/./note.md"]
            content["events"][0]["sources"] = ["raw/./note.md"]

            def fake_http(url, headers, payload, timeout):
                return {"choices": [{"message": {"content": json.dumps(content)}}]}

            with self.assertRaisesRegex(llm_wiki.LLMWikiError, "submitted raw"):
                llm_wiki.ingest_file_project(
                    project,
                    "raw/note.md",
                    provider="deepseek",
                    env={"DEEPSEEK_API_KEY": "test-key"},
                    http_post=fake_http,
                )

            self.assertFalse((project / "wiki" / "note.md").exists())

    def test_deepseek_ingest_file_rejects_slug_owned_by_other_raw(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            (project / "raw" / "a.md").write_text("# A\n\nFirst source.", encoding="utf-8")
            (project / "raw" / "b.md").write_text("# B\n\nSecond source.", encoding="utf-8")

            def content_for(raw_path):
                content = self.valid_deepseek_content()
                content["pages"][0]["slug"] = "shared"
                content["pages"][0]["title"] = "Shared"
                content["pages"][0]["sources"] = [raw_path]
                content["events"][0]["sources"] = [raw_path]
                return content

            def fake_http_a(url, headers, payload, timeout):
                return {"choices": [{"message": {"content": json.dumps(content_for("raw/a.md"))}}]}

            def fake_http_b(url, headers, payload, timeout):
                return {"choices": [{"message": {"content": json.dumps(content_for("raw/b.md"))}}]}

            first = llm_wiki.ingest_file_project(
                project,
                "raw/a.md",
                provider="deepseek",
                env={"DEEPSEEK_API_KEY": "test-key"},
                http_post=fake_http_a,
            )

            with self.assertRaisesRegex(llm_wiki.LLMWikiError, "belongs to another raw"):
                llm_wiki.ingest_file_project(
                    project,
                    "raw/b.md",
                    provider="deepseek",
                    env={"DEEPSEEK_API_KEY": "test-key"},
                    http_post=fake_http_b,
                )

            self.assertEqual(first["pages"], ["shared"])
            shared = (project / "wiki" / "shared.md").read_text(encoding="utf-8")
            self.assertIn("raw/a.md", shared)
            self.assertNotIn("raw/b.md", shared)

    def test_ingest_file_cli_runs_fixture_provider(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            (project / "raw" / "note.md").write_text("# Note\n\nCLI source.", encoding="utf-8")

            payload, exit_code = llm_wiki.run_cli(
                ["ingest-file", "--project", str(project), "--raw", "raw/note.md", "--provider", "fixture"]
            )

            parsed = json.loads(payload)
            self.assertEqual(exit_code, 0)
            self.assertTrue(parsed["ok"])
            self.assertEqual(parsed["operation"], "ingest-file")
            self.assertEqual(parsed["raw"], "raw/note.md")

    def test_deepseek_ingest_rejects_missing_schema_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            (project / "raw" / "note.md").write_text("# Note", encoding="utf-8")

            def fake_http(url, headers, payload, timeout):
                return {"choices": [{"message": {"content": json.dumps({"pages": []})}}]}

            with self.assertRaisesRegex(llm_wiki.LLMWikiError, "schema_contract"):
                llm_wiki.ingest_project(
                    project,
                    provider="deepseek",
                    env={"DEEPSEEK_API_KEY": "test-key"},
                    http_post=fake_http,
                )

    def test_deepseek_ingest_rejects_unsafe_schema_special_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            (project / "raw" / "note.md").write_text("# Note", encoding="utf-8")
            contract = self.valid_deepseek_contract()
            contract["special_files"] = ["../escape"]

            def fake_http(url, headers, payload, timeout):
                return {"choices": [{"message": {"content": json.dumps(self.valid_deepseek_content(contract))}}]}

            with self.assertRaisesRegex(llm_wiki.LLMWikiError, "special_files|schema_contract"):
                llm_wiki.ingest_project(
                    project,
                    provider="deepseek",
                    env={"DEEPSEEK_API_KEY": "test-key"},
                    http_post=fake_http,
                )

    def test_deepseek_ingest_rejects_unsafe_schema_operations(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            (project / "raw" / "note.md").write_text("# Note", encoding="utf-8")
            contract = self.valid_deepseek_contract()
            contract["operations"] = {
                "ingest": {"reads": ["raw/"], "writes": ["raw/"], "never_writes": []},
                "query": {"reads": ["wiki/"], "never_reads": ["raw/"]},
                "lint": {"reads": ["wiki/"], "writes": []},
            }

            def fake_http(url, headers, payload, timeout):
                return {"choices": [{"message": {"content": json.dumps(self.valid_deepseek_content(contract))}}]}

            with self.assertRaisesRegex(llm_wiki.LLMWikiError, "operations|schema_contract"):
                llm_wiki.ingest_project(
                    project,
                    provider="deepseek",
                    env={"DEEPSEEK_API_KEY": "test-key"},
                    http_post=fake_http,
                )

    def test_deepseek_ingest_rejects_missing_event_elements(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            (project / "raw" / "note.md").write_text("# Note", encoding="utf-8")

            def fake_http(url, headers, payload, timeout):
                return {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "schema_contract": {
                                            "page_naming": "flat lowercase hyphen markdown pages under wiki",
                                            "frontmatter_required": ["title", "type", "sources", "updated"],
                                            "link_syntax": "[[slug]]",
                                            "event_schema": [
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
                                            ],
                                            "special_files": ["wiki/index.md", "wiki/log.md"],
                                            "operations": {
                                                "ingest": {
                                                    "reads": ["raw/"],
                                                    "writes": ["wiki/"],
                                                    "never_writes": ["raw/"],
                                                },
                                                "query": {"reads": ["wiki/"], "never_reads": ["raw/"]},
                                                "lint": {"reads": ["wiki/"], "writes": []},
                                            },
                                        },
                                        "pages": [
                                            {
                                                "slug": "note",
                                                "title": "Note",
                                                "type": "compiled-note",
                                                "sources": ["raw/note.md"],
                                                "events": ["bad-event"],
                                                "body": "Body",
                                            }
                                        ],
                                        "events": [{"slug": "bad-event", "title": "Bad event"}],
                                    }
                                )
                            }
                        }
                    ]
                }

            with self.assertRaisesRegex(llm_wiki.LLMWikiError, "event"):
                llm_wiki.ingest_project(
                    project,
                    provider="deepseek",
                    env={"DEEPSEEK_API_KEY": "test-key"},
                    http_post=fake_http,
                )

    def test_deepseek_ingest_sanitizes_unresolved_body_wikilinks_before_lint(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            (project / "raw" / "note.md").write_text("# Note", encoding="utf-8")
            content = self.valid_deepseek_content()
            content["pages"][0]["body"] = "Valid [[index]] link and unresolved [[missing-page]] link."

            def fake_http(url, headers, payload, timeout):
                return {"choices": [{"message": {"content": json.dumps(content)}}]}

            result = llm_wiki.ingest_project(
                project,
                provider="deepseek",
                env={"DEEPSEEK_API_KEY": "test-key"},
                http_post=fake_http,
            )

            self.assertTrue(result["ok"])
            page = (project / "wiki" / "note.md").read_text(encoding="utf-8")
            self.assertIn("[[index]]", page)
            self.assertIn("missing-page", page)
            self.assertNotIn("[[missing-page]]", page)

    def test_deepseek_ingest_rejects_missing_page_event_before_writing(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            (project / "raw" / "note.md").write_text("# Note", encoding="utf-8")
            content = self.valid_deepseek_content()
            content["pages"][0]["events"] = ["missing-event"]

            def fake_http(url, headers, payload, timeout):
                return {"choices": [{"message": {"content": json.dumps(content)}}]}

            with self.assertRaisesRegex(llm_wiki.LLMWikiError, "missing event"):
                llm_wiki.ingest_project(
                    project,
                    provider="deepseek",
                    env={"DEEPSEEK_API_KEY": "test-key"},
                    http_post=fake_http,
                )

            self.assertFalse((project / "wiki" / "note.md").exists())

    def test_query_reads_schema_and_wiki_without_raw(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            (project / "raw" / "secret.md").write_text("raw-only secret", encoding="utf-8")
            (project / "wiki" / "index.md").write_text(
                "---\ntitle: Index\ntype: index\nsources: []\nupdated: 2026-06-22\n---\n\n# Index\n\n- [[compiled-rag]]\n",
                encoding="utf-8",
            )
            (project / "wiki" / "compiled-rag.md").write_text(
                "---\ntitle: Compiled RAG\ntype: concept\nsources:\n  - raw/secret.md\nupdated: 2026-06-22\n---\n\n# Compiled RAG\n\ncompiled wiki fact\n",
                encoding="utf-8",
            )
            captured = {}

            def fake_http(url, headers, payload, timeout):
                captured["payload"] = payload
                return {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "answer": "The answer is based on compiled wiki fact.",
                                        "citations": [{"path": "wiki/compiled-rag.md", "quote": "compiled wiki fact"}],
                                    },
                                    ensure_ascii=False,
                                )
                            }
                        }
                    ]
                }

            result = llm_wiki.query_project(
                project,
                "What does the wiki say?",
                env={"DEEPSEEK_API_KEY": "test-key"},
                http_post=fake_http,
            )

            messages_text = json.dumps(captured["payload"]["messages"], ensure_ascii=False)
            self.assertIn("LLM Wiki Schema", messages_text)
            self.assertIn("compiled wiki fact", messages_text)
            self.assertNotIn("raw-only secret", messages_text)
            self.assertEqual(captured["payload"].get("response_format"), {"type": "json_object"})
            self.assertEqual(result["answer"], "The answer is based on compiled wiki fact.")
            self.assertEqual(result["citations"][0]["path"], "wiki/compiled-rag.md")
            self.assertEqual(result["read"], ["wiki/index.md", "wiki/log.md", "wiki/compiled-rag.md"])

    def test_query_rejects_invalid_citation_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            (project / "wiki" / "compiled-rag.md").write_text(
                "---\ntitle: Compiled RAG\ntype: concept\nsources:\n  - raw/source.md\nupdated: 2026-06-22\n---\n\n# Compiled RAG\n\ncompiled wiki fact\n",
                encoding="utf-8",
            )

            def fake_http(url, headers, payload, timeout):
                return {"choices": [{"message": {"content": json.dumps({"answer": "bad", "citations": [{"path": "raw/source.md", "quote": "bad"}]})}}]}

            with self.assertRaisesRegex(llm_wiki.LLMWikiError, "citation"):
                llm_wiki.query_project(project, "question", env={"DEEPSEEK_API_KEY": "test-key"}, http_post=fake_http)

    def test_query_cli_returns_structured_json_error_without_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch("llm_wiki.sidecar_env", return_value={}):
                payload, exit_code = llm_wiki.run_cli(["query", "--project", tmp, "--question", "hello"])
            parsed = json.loads(payload)
            self.assertEqual(exit_code, 1)
            self.assertFalse(parsed["ok"])
            self.assertEqual(parsed["operation"], "query")
            self.assertIn("error", parsed)

    def test_slug_and_path_guards_reject_escape_attempts(self):
        unsafe = ["../escape", "/absolute", "folder\\escape", "bad\x00name", "a..b", ""]
        for value in unsafe:
            with self.subTest(value=value):
                with self.assertRaises(llm_wiki.LLMWikiError):
                    llm_wiki.validate_slug(value)

    def test_lint_reports_broken_links_and_missing_frontmatter(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            broken = project / "wiki" / "broken.md"
            broken.write_text("# Broken\n\n[[missing-target]]", encoding="utf-8")

            result = llm_wiki.lint_project(project)

            self.assertFalse(result["ok"])
            issue_codes = {issue["code"] for issue in result["issues"]}
            self.assertIn("missing-frontmatter", issue_codes)
            self.assertIn("broken-link", issue_codes)

    def test_lint_reports_invalid_frontmatter_values_on_linked_page(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            llm_wiki.ensure_project(project)
            index = project / "wiki" / "index.md"
            index.write_text(
                index.read_text(encoding="utf-8") + "\n- [[bad-frontmatter]]\n",
                encoding="utf-8",
            )
            bad = project / "wiki" / "bad-frontmatter.md"
            bad.write_text(
                "---\n"
                'title: ""\n'
                'type: ""\n'
                "sources: []\n"
                "updated: not-a-date\n"
                "---\n\n"
                "# Bad Frontmatter\n\n"
                "Back to [[index]].\n",
                encoding="utf-8",
            )

            result = llm_wiki.lint_project(project)

            self.assertFalse(result["ok"])
            issue_codes = {issue["code"] for issue in result["issues"]}
            self.assertEqual({"invalid-frontmatter"}, issue_codes)

    def test_cli_errors_are_structured_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload, exit_code = llm_wiki.run_cli(["ingest", "--project", tmp, "--provider", "fixture"])

            parsed = json.loads(payload)
            self.assertEqual(exit_code, 1)
            self.assertFalse(parsed["ok"])
            self.assertEqual(parsed["operation"], "ingest")

    def test_cli_parse_errors_are_structured_json(self):
        payload, exit_code = llm_wiki.run_cli(["unknown-command"])

        parsed = json.loads(payload)
        self.assertEqual(exit_code, 1)
        self.assertFalse(parsed["ok"])
        self.assertEqual(parsed["operation"], "unknown-command")
        self.assertIn("error", parsed)


if __name__ == "__main__":
    unittest.main()
