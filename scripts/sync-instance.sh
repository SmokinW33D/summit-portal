#!/usr/bin/env bash
#
# Push this template's code to the LIVE instance repo and let Cloudflare deploy it.
#
# WHY THIS EXISTS
#   The live portal runs from  SmokinW33D/summit-booking-portal  (created by the
#   "Deploy to Cloudflare" button; it's connected to Cloudflare and holds the D1
#   `database_id`).  THIS repo (summit-portal) is the clean, generic template.
#   They must stay in lockstep — the ONLY file that legitimately differs is
#   wrangler.toml (the instance's database_id).  Run this after ANY change here
#   so the two can never silently drift.
#
# USAGE
#   bash scripts/sync-instance.sh
#
# Requires: git configured with push access to summit-booking-portal.
set -euo pipefail

INSTANCE_URL="https://github.com/SmokinW33D/summit-booking-portal.git"
TEMPLATE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

git clone --depth 1 "$INSTANCE_URL" "$WORK/inst" >/dev/null 2>&1
cd "$WORK/inst"

# Mirror code + config verbatim — but NEVER the instance's own wrangler.toml.
rm -rf src migrations test
cp -R "$TEMPLATE_DIR"/src "$TEMPLATE_DIR"/migrations "$TEMPLATE_DIR"/test ./
cp "$TEMPLATE_DIR"/package.json "$TEMPLATE_DIR"/pnpm-lock.yaml \
   "$TEMPLATE_DIR"/tsconfig.json "$TEMPLATE_DIR"/.dev.vars.example \
   "$TEMPLATE_DIR"/.gitignore ./

if [ -z "$(git status --short)" ]; then
  echo "✓ Instance already in sync with the template — nothing to push."
  exit 0
fi

git add -A
git commit -q -m "Sync from summit-portal template ($(cd "$TEMPLATE_DIR" && git rev-parse --short HEAD))"
git push -q
echo "✓ Instance synced + pushed — Cloudflare auto-deploys in ~1-2 min."
