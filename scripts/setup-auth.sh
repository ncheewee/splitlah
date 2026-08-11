#!/usr/bin/env bash
# One-shot setup for v62 Google sign-in. Run from the repo root:
#   bash scripts/setup-auth.sh
#
# Does three things: sets the Worker session secret, runs the DB migration,
# deploys the Worker. Idempotent — safe to re-run.
#
# Nothing here is echoed or written to disk. The session secret is generated
# locally and piped straight into wrangler; you never see it and neither does
# anyone else.

set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

say "SplitLah v62 auth setup"
echo "Repo: $(pwd)"

# ---------------------------------------------------------------- 1. secret
say "1/3 · Worker session secret"
if npx wrangler secret list 2>/dev/null | grep -q SESSION_SECRET; then
  echo "SESSION_SECRET already set."
  read -r -p "Rotate it? (this signs everyone out) [y/N] " rot
  if [[ "${rot:-N}" =~ ^[Yy]$ ]]; then
    openssl rand -base64 48 | npx wrangler secret put SESSION_SECRET
    echo "Rotated."
  else
    echo "Kept existing secret."
  fi
else
  echo "Generating a 48-byte random secret and sending it to Cloudflare…"
  openssl rand -base64 48 | npx wrangler secret put SESSION_SECRET
  echo "Done. The value was never printed."
fi

# ------------------------------------------------------------- 2. migration
say "2/3 · Neon migration"
echo "Creates legacy_uids + a GIN index, and seeds the CONFIG row switched OFF."
if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "Using DATABASE_URL from the environment."
  node scripts/setup-auth.mjs
else
  echo "Paste your Neon pooled connection string (input hidden):"
  read -r -s DBURL
  echo
  DATABASE_URL="$DBURL" node scripts/setup-auth.mjs
  unset DBURL
fi

# ---------------------------------------------------------------- 3. deploy
say "3/3 · Deploy the Worker"
echo "The app itself deploys from GitHub Pages on push; the Worker does not."
read -r -p "Deploy the Worker now? [Y/n] " dep
if [[ "${dep:-Y}" =~ ^[Yy]$|^$ ]]; then
  npx wrangler deploy
else
  echo "Skipped. Run 'npm run deploy:worker' when ready."
fi

say "Setup complete"
cat <<'NOTE'
Sign-in is INSTALLED BUT OFF. Nobody is gated and nothing changed for users.

Verify:
  curl -s https://splitlah-api.ncheewee.workers.dev/config | jq
  -> requireAuth:false, authCreateOnly:false, clientId set

Then in the app: Edit profile -> Sign in with Google.

When you are ready to require accounts for NEW users (order matters):
  node scripts/rollout-auth.mjs snapshot   # grandfather today's users FIRST
  node scripts/rollout-auth.mjs enable

Kill switch, any time, no redeploy:
  node scripts/rollout-auth.mjs disable
NOTE
