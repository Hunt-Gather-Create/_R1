#!/bin/sh
# Deprecated: superseded by scripts/install-hooks.sh (fleet-standard, opeff#1008).
echo "scripts/hooks/install.sh is deprecated. Run scripts/install-hooks.sh instead." >&2
exec "$(git rev-parse --show-toplevel)/scripts/install-hooks.sh"
