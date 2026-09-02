#!/usr/bin/env bash
#
# Sync the vendored `flipper-claude-buddy` plugin from Etienne's fork.
#
# The plugin lives in the `plugin/` subdirectory of the flipper-claude-buddy
# repo, so we use a blobless + sparse clone to fetch only that folder rather
# than the whole repo (which also carries the Flipper firmware sources).
# This OVERWRITES plugins/flipper-claude-buddy with upstream content, then
# re-pins the provenance record. Any local edits to the plugin are discarded.
#
# Usage:  ./scripts/sync-flipper-claude-buddy-plugin.sh [ref]
#   ref   optional git ref to pin to (branch, tag, or SHA). Default: main
set -euo pipefail

UPSTREAM_REPO="https://github.com/EtiennePasteur/flipper-claude-buddy.git"
UPSTREAM_PATH="plugin"
REF="${1:-main}"

# Resolve repo root from this script's location (script lives in <root>/scripts).
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$REPO_ROOT/plugins/flipper-claude-buddy"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ Fetching $UPSTREAM_PATH @ $REF from $UPSTREAM_REPO"
git clone --no-checkout --depth 1 --filter=blob:none --branch "$REF" \
  "$UPSTREAM_REPO" "$TMP/repo" 2>/dev/null \
  || git clone --no-checkout --filter=blob:none "$UPSTREAM_REPO" "$TMP/repo"
cd "$TMP/repo"
git sparse-checkout init --cone
git sparse-checkout set "$UPSTREAM_PATH" LICENSE
git checkout --quiet "$REF" 2>/dev/null || git checkout --quiet
COMMIT="$(git rev-parse HEAD)"

if [ ! -f "$UPSTREAM_PATH/.claude-plugin/plugin.json" ]; then
  echo "✗ Upstream path '$UPSTREAM_PATH' not found at $REF — aborting." >&2
  exit 1
fi

echo "→ Vendoring into $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$TMP/repo/$UPSTREAM_PATH/." "$DEST/"
cp "$TMP/repo/LICENSE" "$DEST/LICENSE"
# Drop build/runtime cruft that must never be vendored.
find "$DEST" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
find "$DEST" \( -name '*.pyc' -o -name '.DS_Store' \) -delete 2>/dev/null || true

cat > "$DEST/UPSTREAM.md" <<EOF
# Provenance

This plugin is **vendored** from Etienne's fork of \`jxw1102/flipper-claude-buddy\`.
It is not authored here — do not hand-edit it, as
\`scripts/sync-flipper-claude-buddy-plugin.sh\` overwrites this directory on
each sync. Fix things in the fork, push, then re-run the sync.

| | |
|---|---|
| Vendored from | <https://github.com/EtiennePasteur/flipper-claude-buddy> |
| Original upstream | <https://github.com/jxw1102/flipper-claude-buddy> |
| Path | \`$UPSTREAM_PATH\` |
| Pinned commit | \`$COMMIT\` |
| License | MIT — see [\`LICENSE\`](./LICENSE) (Copyright jxw1102) |

The fork carries a security hardening patch not present upstream: runtime
files (socket, pidfile, log, stats) moved out of the shared \`/tmp\` into a
per-user private directory, and the IPC socket created \`0600\` instead of
\`0666\`. See commit \`756c46d\` in the fork.

To update to the latest version, run from the repo root:

\`\`\`bash
./scripts/sync-flipper-claude-buddy-plugin.sh
\`\`\`
EOF

echo "✓ Synced flipper-claude-buddy plugin @ ${COMMIT:0:12}"
echo "  Review changes:  git -C \"$REPO_ROOT\" diff --stat -- plugins/flipper-claude-buddy"
