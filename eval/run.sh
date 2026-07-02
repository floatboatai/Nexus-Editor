#!/bin/sh
# Launcher for the eval harness. Prefers the project-local venv (which has
# rich + pyyaml installed); falls back to system python3 otherwise.
#
# First-time setup (creates the venv + installs deps):
#   python3 -m venv eval/.venv && eval/.venv/bin/pip install -r eval/requirements.txt
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -x "$DIR/.venv/bin/python" ]; then
  PY="$DIR/.venv/bin/python"
else
  PY="python3"
fi

# pnpm forwards a literal "--" separator; drop it so flags pass through cleanly.
if [ "$1" = "--" ]; then
  shift
fi

exec "$PY" "$DIR/run_eval.py" "$@"
