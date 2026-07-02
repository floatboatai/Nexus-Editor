"""Environment & configuration for the table-drag eval harness."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

# eval/harness/env.py -> eval/ -> repo root
HARNESS_DIR = Path(__file__).resolve().parent
EVAL_DIR = HARNESS_DIR.parent
REPO_ROOT = EVAL_DIR.parent

CORPUS_FILE = EVAL_DIR / "corpus" / "table-drag.yaml"
BRIDGE_DIR = EVAL_DIR / "bridge"
TABLEOPS_DIST = BRIDGE_DIR / "dist" / "table-ops-bridge.mjs"
TABLEOPS_ENTRY = BRIDGE_DIR / "table-ops-bridge.ts"
PREVIEW_SETUP = BRIDGE_DIR / "setup-dom.ts"
BRIDGE_CONFIG = BRIDGE_DIR / "tsup.config.ts"
CORE_SRC = REPO_ROOT / "packages" / "core" / "src"
TSUP_BIN = REPO_ROOT / "node_modules" / ".bin" / "tsup"

TABLE_DRAG_PREFIX = "tabledrag"


@dataclass(frozen=True)
class Config:
    """Run configuration, populated from CLI flags in `main`."""

    tag: str | None = None
    id_substr: str | None = None
    verbose: bool = False
    as_json: bool = False
    rebuild: bool = False
    timeout_s: float = 60.0
    node_bin: str = "node"
    baseline_pass_rate: float | None = 1.0
