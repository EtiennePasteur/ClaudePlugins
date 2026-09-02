#!/bin/bash
set -euo pipefail

# TaskCompleted hook: buzz Flipper when a task is marked done.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/_runtime.sh"

if [ ! -S "$SOCKET" ]; then
    exit 0
fi

echo '{"action":"notify","sound":"success","vibro":true,"text":"Task","subtext":"Completed"}' \
    | nc -U "$SOCKET" 2>/dev/null &

exit 0
