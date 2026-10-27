#!/usr/bin/env bash
# Usage: run-example.sh <name> <command...>; checks the zips the run wrote against smoke/expectations/<name>.json.
# The exit code is passed to the checker rather than gating here, because most examples fail on purpose.
set -uo pipefail

NAME="${1:?usage: run-example.sh <name> <command...>}"
shift
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
OUT="${SMOKE_OUT:-${RUNNER_TEMP:-/tmp}/examples-smoke}/$NAME"

rm -rf "$OUT"
mkdir -p "$OUT"
# Found by age, not path: each adapter resolves its output dir from the test file, the config or the cwd.
MARKER="$OUT/.started"
touch "$MARKER"

echo "::group::$NAME: $*"
(cd "$ROOT" && "$@") 2>&1 | tee "$OUT/run.log"
STATUS=${PIPESTATUS[0]}
echo "::endgroup::"
echo "$NAME exited $STATUS"

# Only examples/ and packages/ are searched, never .claude/worktrees or $OUT itself; a numbered directory
# per zip keeps two identically named zips from overwriting each other.
COUNT=0
while IFS= read -r -d '' ZIP; do
  COUNT=$((COUNT + 1))
  mkdir -p "$OUT/$COUNT"
  cp "$ZIP" "$OUT/$COUNT/"
  echo "collected ${ZIP#"$ROOT"/} as $COUNT/"
done < <(find "$ROOT/examples" "$ROOT/packages" \
  \( -name node_modules -o -name .claude -o -path "$OUT" \) -prune \
  -o -type f -name 'trace-*.zip' -newer "$MARKER" -print0)

cd "$ROOT" && pnpm -s smoke:assert --expect "$NAME" --exit-code "$STATUS" \
  --log "$OUT/run.log" "$OUT"
