#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"
cd "${COZE_WORKSPACE_PATH}"

# Install frozen dependencies separately with --ignore-scripts after reviewing the lockfile.
# Never reinstall or run installation lifecycle scripts as part of a build.
pnpm exec next build --webpack
pnpm exec tsup src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify
