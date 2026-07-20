#!/bin/bash
# Generate a changeset file from conventional commits since the last tag.
# Usage: ./.changeset/changeset-gen.sh <package> [bump]
#
#   package: npm name, e.g. @wdio/elements
#   bump:    major | minor | patch (inferred from commits if omitted)
#
# Commits are filtered to only those that touched the package's directory.
# Inferred bumps: feat/feature → minor, BREAKING CHANGE → major, else patch.
# Changelog body groups commits by type (Features / Fixes / Improvements).
# chore, ci, test, build, and deps commits are excluded from the body.

set -euo pipefail

PACKAGE="${1:-}"
BUMP="${2:-}"

if [ -z "$PACKAGE" ]; then
  echo "Usage: $0 <package> [bump]"
  echo "  package: npm name, e.g. @wdio/elements"
  echo "  bump:    major | minor | patch (inferred from commits if omitted)"
  exit 1
fi

# ---- Resolve package name to directory ----
PKG_DIR=""
for d in packages/*/package.json; do
  if [ "$(jq -r '.name' "$d")" = "$PACKAGE" ]; then
    PKG_DIR="$(dirname "$d")"
    break
  fi
done

if [ -z "$PKG_DIR" ]; then
  echo "❌ Package '$PACKAGE' not found in packages/*/package.json"
  exit 1
fi

LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null) || { echo "No git tags found"; exit 1; }
COMMITS=$(git log "$LAST_TAG"..HEAD --format="%s" --no-merges -- "$PKG_DIR")

if [ -z "$COMMITS" ]; then
  echo "No commits touching $PKG_DIR since $LAST_TAG"
  exit 0
fi

# ---- Infer bump type ----
if [ -z "$BUMP" ]; then
  if echo "$COMMITS" | grep -q "BREAKING CHANGE"; then
    BUMP="major"
  elif echo "$COMMITS" | grep -qiE "^(feat|feature)[(:]"; then
    BUMP="minor"
  else
    BUMP="patch"
  fi
fi

# ---- Group commits by type, stripping the conventional prefix ----
# Include: feat, fix, refactor, perf, revert
# Exclude: chore, ci, test, build, docs, style, deps

strip_prefix() { sed -E 's/^[a-z]+(\([^)]*\))?:\s*//i'; }

FEATS=$(echo "$COMMITS"  | grep -iE  "^(feat|feature)[(:]"     | strip_prefix || true)
FIXES=$(echo "$COMMITS"  | grep -iE  "^(fix)[(:]"              | strip_prefix || true)
PERF=$(echo "$COMMITS"   | grep -iE  "^(perf|performance)[(:]" | strip_prefix || true)
REFAC=$(echo "$COMMITS"  | grep -iE  "^(refactor)[(:]"         | strip_prefix || true)
REVERT=$(echo "$COMMITS" | grep -iE  "^(revert)[(:]"           | strip_prefix || true)

# ---- Generate the changeset file ----
SLUG=$(date +%s)-$(($$ % 10000))-$(openssl rand -hex 2 2>/dev/null || echo "$RANDOM")
OUT=".changeset/$SLUG.md"

{
  echo "---"
  echo "\"$PACKAGE\": $BUMP"
  echo "---"
  echo ""

  if [ -n "$FEATS" ]; then
    echo "### 🚀 Features"
    while IFS= read -r line; do [ -n "$line" ] && echo "- $line"; done <<< "$FEATS"
    echo ""
  fi

  if [ -n "$FIXES" ]; then
    echo "### 🐛 Fixes"
    while IFS= read -r line; do [ -n "$line" ] && echo "- $line"; done <<< "$FIXES"
    echo ""
  fi

  if [ -n "$PERF" ] || [ -n "$REFAC" ]; then
    echo "### ⚡ Improvements"
    while IFS= read -r line; do [ -n "$line" ] && echo "- $line"; done <<< "$PERF"
    while IFS= read -r line; do [ -n "$line" ] && echo "- $line"; done <<< "$REFAC"
    echo ""
  fi

  if [ -n "$REVERT" ]; then
    echo "### ↩ Reverts"
    while IFS= read -r line; do [ -n "$line" ] && echo "- $line"; done <<< "$REVERT"
    echo ""
  fi

} > "$OUT"

echo "✅ $OUT  (bump: $BUMP, scope: $PKG_DIR)"
echo ""
echo "--- Preview ---"
cat "$OUT"

# ---- If package is private, bump all published dependents ----
IS_PRIVATE=$(jq -r '.private // false' "$PKG_DIR/package.json")
if [ "$IS_PRIVATE" = "true" ]; then
  echo ""
  echo "📦 $PACKAGE is private — bumping published dependents..."

  DEP_IDX=0
  for f in packages/*/package.json; do
    CONSUMER_NAME=$(jq -r '.name' "$f")
    CONSUMER_PRIVATE=$(jq -r '.private // false' "$f")

    [ "$CONSUMER_NAME" = "$PACKAGE" ] && continue
    [ "$CONSUMER_PRIVATE" = "true" ] && continue

    if grep -q "\"$PACKAGE\"" "$f" 2>/dev/null; then
      DEP_IDX=$((DEP_IDX + 1))
      echo "  → $CONSUMER_NAME (patch)"

      DEP_SLUG=$(date +%s)-$(($$ % 10000))-$DEP_IDX-$(openssl rand -hex 2 2>/dev/null || echo "$RANDOM")
      DEP_OUT=".changeset/$DEP_SLUG.md"

      {
        echo "---"
        echo "\"$CONSUMER_NAME\": patch"
        echo "---"
        echo ""
        echo "- Bump $PACKAGE dependency"
      } > "$DEP_OUT"

      echo "✅ $DEP_OUT"
    fi
  done

  [ "$DEP_IDX" -eq 0 ] && echo "  (no published dependents found)"
fi
