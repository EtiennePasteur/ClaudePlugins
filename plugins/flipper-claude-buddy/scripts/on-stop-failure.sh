#!/bin/bash
set -euo pipefail

# StopFailure hook: notify Flipper when a turn ends with an API error.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/_runtime.sh"

if [ ! -S "$SOCKET" ]; then
    exit 0
fi

echo '{"action":"notify","sound":"error","vibro":true,"text":"Claude","subtext":"API Error"}' \
    | nc -U "$SOCKET" 2>/dev/null &

exit 0
