#!/usr/bin/env bash
# Installs the packed service and elements beside a given WebdriverIO major, the
# way a user's project gets them, then proves they import and type-check there.
#
#   run.sh <webdriverio major> [work dir]
#
# Expects the workspace to be built. NPM overrides the npm command, so a local
# run can go through a package-age guard (NPM="pmg npm").
set -euo pipefail

MAJOR="${1:?usage: run.sh <webdriverio major> [work dir]}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
WORK="${2:-$(mktemp -d)}"
NPM="${NPM:-npm}"
PACKS="$WORK/packs"
PROJECT="$WORK/project"

rm -rf "$PACKS" "$PROJECT"
mkdir -p "$PACKS" "$PROJECT"

# The service's workspace:^ deps (backend, script, elements, and the app the
# backend serves) pack as ranges on versions that may not be published yet, so
# every one of them is installed from its local tarball rather than the registry.
for pkg in app script backend elements service; do
  (cd "$ROOT/packages/$pkg" && pnpm pack --pack-destination "$PACKS" >/dev/null)
done

repo_dev_version() {
  node -p "require('$ROOT/package.json').devDependencies['$1']"
}

cp "$HERE/check-imports.mjs" "$HERE/smoke.ts" "$HERE/tsconfig.json" "$PROJECT/"
cat > "$PROJECT/package.json" <<'JSON'
{ "name": "wdio-peer-smoke", "private": true, "type": "module" }
JSON

cd "$PROJECT"

# No --legacy-peer-deps or --force: a peer range that excludes this major has
# to fail the install, which is the first thing this job exists to catch.
$NPM install --no-audit --no-fund --strict-peer-deps \
  "webdriverio@^$MAJOR" \
  "@wdio/cli@^$MAJOR" \
  "@wdio/local-runner@^$MAJOR" \
  "@wdio/mocha-framework@^$MAJOR" \
  "@wdio/globals@^$MAJOR" \
  "@wdio/types@^$MAJOR" \
  "@wdio/protocols@^$MAJOR" \
  "@wdio/allure-reporter@^$MAJOR" \
  "typescript@$(repo_dev_version typescript)" \
  "@types/node@$(repo_dev_version @types/node)" \
  "$PACKS"/*.tgz

node check-imports.mjs "$MAJOR"
npx tsc -p tsconfig.json
echo "WebdriverIO $MAJOR: install, import and type-check passed"
