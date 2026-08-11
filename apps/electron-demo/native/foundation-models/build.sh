#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Skipping Foundation Models addon build: non-darwin host."
  exit 0
fi

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "Skipping Foundation Models addon build: FoundationModels requires Apple Silicon."
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to locate Node-API headers." >&2
  exit 1
fi

NODE_INCLUDE="${NODE_INCLUDE:-$(node -p 'require("node:path").join(require("node:path").dirname(process.execPath), "..", "include", "node")')}"
if [[ ! -f "$NODE_INCLUDE/node_api.h" ]]; then
  echo "Node-API headers not found at $NODE_INCLUDE." >&2
  echo "Set NODE_INCLUDE to the directory containing node_api.h." >&2
  exit 1
fi
export NODE_INCLUDE
SWIFT_CACHE_ROOT="${TMPDIR:-/tmp}/foundation-models-cache"
SWIFT_SCRATCH_DIR="$SWIFT_CACHE_ROOT/scratch"
SWIFT_MODULE_CACHE_DIR="$SWIFT_CACHE_ROOT/clang-module-cache"
export XDG_CACHE_HOME="$SWIFT_CACHE_ROOT/xdg-cache"
export CLANG_MODULE_CACHE_PATH="$SWIFT_MODULE_CACHE_DIR"
mkdir -p "$SWIFT_SCRATCH_DIR" "$SWIFT_MODULE_CACHE_DIR"
mkdir -p "$XDG_CACHE_HOME"

swift build \
  --scratch-path "$SWIFT_SCRATCH_DIR" \
  --configuration release \
  --product foundation_models \
  -Xcc "-fmodules-cache-path=$SWIFT_MODULE_CACHE_DIR"

mkdir -p build/Release
cp .build/release/libfoundation_models.dylib build/Release/foundation_models.node

mkdir -p ../../dist-electron/native
cp build/Release/foundation_models.node ../../dist-electron/native/foundation_models.node

echo "Built build/Release/foundation_models.node"
echo "Copied ../../dist-electron/native/foundation_models.node"
