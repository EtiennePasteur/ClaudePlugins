# Shared runtime paths for flipper-claude-buddy hook scripts.
# Sourced by the .sh hooks; mirrored in _runtime.py and bridge/config.py.
#
# Runtime files live in a per-user private directory instead of the shared
# /tmp, so no other local process can squat the socket path (and thereby
# answer permission requests on the user's behalf) or forge the pidfile.

flipper_runtime_dir() {
    if [ -n "${FLIPPER_BRIDGE_RUNTIME_DIR:-}" ]; then
        printf '%s' "${FLIPPER_BRIDGE_RUNTIME_DIR%/}"
    elif [ -n "${XDG_RUNTIME_DIR:-}" ] && [ -d "${XDG_RUNTIME_DIR}" ]; then
        printf '%s' "${XDG_RUNTIME_DIR%/}"   # Linux: /run/user/<uid>, mode 700
    elif [ -n "${TMPDIR:-}" ]; then
        printf '%s' "${TMPDIR%/}"            # macOS: /var/folders/../T, mode 700
    else
        printf '%s' "/tmp"
    fi
}

FLIPPER_RUNTIME_DIR="$(flipper_runtime_dir)"
SOCKET="${FLIPPER_BRIDGE_SOCKET:-$FLIPPER_RUNTIME_DIR/claude-flipper-bridge.sock}"
PIDFILE="$FLIPPER_RUNTIME_DIR/claude-flipper-bridge.pid"
LOG="$FLIPPER_RUNTIME_DIR/claude-flipper-bridge.log"
REFCOUNT_FILE="$FLIPPER_RUNTIME_DIR/claude-flipper-bridge.refcount"
STATS="$FLIPPER_RUNTIME_DIR/claude-flipper-turn-stats.json"
SKIP_FLAG="$FLIPPER_RUNTIME_DIR/claude-flipper-skip-stop.flag"
