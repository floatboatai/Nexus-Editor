#!/usr/bin/env python3
"""Thin entry shim so the eval can be launched either way:

    python3 eval/run_eval.py            # direct path (used by `pnpm eval`)
    python3 -m harness.main             # module style (from within eval/)

Both delegate to `harness.main.main`.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from harness.main import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
