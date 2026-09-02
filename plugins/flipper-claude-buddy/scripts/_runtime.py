"""Shared runtime paths for flipper-claude-buddy hook scripts.

Imported by the Python hooks; mirrored in _runtime.sh and bridge/config.py.

Runtime files live in a per-user private directory instead of the shared
/tmp, so no other local process can squat the socket path (and thereby
answer permission requests on the user's behalf) or forge the pidfile.
"""

import os


def runtime_dir() -> str:
    explicit = os.environ.get("FLIPPER_BRIDGE_RUNTIME_DIR", "")
    if explicit:
        return explicit.rstrip("/")
    xdg = os.environ.get("XDG_RUNTIME_DIR", "")
    if xdg and os.path.isdir(xdg):
        return xdg.rstrip("/")  # Linux: /run/user/<uid>, mode 700
    tmp = os.environ.get("TMPDIR", "")
    if tmp:
        return tmp.rstrip("/")  # macOS: /var/folders/../T, mode 700
    return "/tmp"


RUNTIME_DIR = runtime_dir()
SOCKET_PATH = os.environ.get(
    "FLIPPER_BRIDGE_SOCKET", os.path.join(RUNTIME_DIR, "claude-flipper-bridge.sock")
)
STATS_PATH = os.path.join(RUNTIME_DIR, "claude-flipper-turn-stats.json")
SKIP_STOP_FLAG = os.path.join(RUNTIME_DIR, "claude-flipper-skip-stop.flag")
