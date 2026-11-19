#!/usr/bin/env bash
# Install the marketplace as a user does, in throwaway homes, and check what
# landed against the tree (scripts/tests/smoke_plugins.py says how).
#   smoke-plugins.sh [--claude] [--codex] [--tree DIR] [--work DIR]
#   smoke-plugins.sh --precedence-probe
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
exec python3 -I "$here/smoke_plugins.py" "$@"
