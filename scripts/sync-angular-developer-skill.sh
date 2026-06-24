#!/usr/bin/env bash
#
# Sync the vendored `angular-developer` skill from the official Angular repo.
#
# The skill lives in a subdirectory of the angular/angular monorepo, so we use a
# blobless + sparse clone to fetch only that folder rather than the whole repo.
# This OVERWRITES plugins/angular/skills/angular-developer with upstream content,
# then re-pins the provenance record. Any local edits to the skill are discarded.
#
# Usage:  ./scripts/sync-angular-developer-skill.sh [ref]
#   ref   optional git ref to pin to (branch, tag, or SHA). Default: main
set -euo pipefail

UPSTREAM_REPO="https://github.com/angular/angular.git"
UPSTREAM_PATH="skills/dev-skills/angular-developer"
REF="${1:-main}"

# Resolve repo root from this script's location (script lives in <root>/scripts).
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$REPO_ROOT/plugins/angular/skills/angular-developer"

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

if [ ! -f "$UPSTREAM_PATH/SKILL.md" ]; then
  echo "✗ Upstream path '$UPSTREAM_PATH' not found at $REF — aborting." >&2
  exit 1
fi

echo "→ Vendoring into $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$TMP/repo/$UPSTREAM_PATH/." "$DEST/"
cp "$TMP/repo/LICENSE" "$DEST/LICENSE"

cat > "$DEST/UPSTREAM.md" <<EOF
# Provenance

This skill is **vendored** from the Angular team's official repository. It is
not authored here — do not hand-edit it, as \`scripts/sync-angular-developer-skill.sh\`
overwrites this directory on each sync.

| | |
|---|---|
| Upstream | <https://github.com/angular/angular> |
| Path | \`$UPSTREAM_PATH\` |
| Pinned commit | \`$COMMIT\` |
| License | MIT — see [\`LICENSE\`](./LICENSE) (Copyright Google LLC) |

To update to the latest upstream version, run from the repo root:

\`\`\`bash
./scripts/sync-angular-developer-skill.sh
\`\`\`
EOF

echo "✓ Synced angular-developer skill @ ${COMMIT:0:12}"
echo "  Review changes:  git -C \"$REPO_ROOT\" diff --stat -- plugins/angular/skills/angular-developer"
