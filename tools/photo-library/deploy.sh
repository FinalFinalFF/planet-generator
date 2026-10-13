#!/usr/bin/env bash
# Publish the local photo library (photo-library/) to its hosted Cloudflare
# Pages project, with the shared-curation function. Re-runnable: Pages only
# uploads files whose content changed.
#
#   tools/photo-library/deploy.sh
#
# First run creates the project (an unguessable *.pages.dev name — there is no
# Cloudflare Access in front yet, so the link is the only way in), a write key
# for shared curation, and .orbgen-hosted.json (gitignored: project, URL, key).
# Prints the team invite link.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
LIB="$REPO/photo-library"
DEPLOY="$REPO/.photo-library-deploy"
SITE="$REPO/tools/photo-library/site"
STATE="$REPO/.orbgen-hosted.json"
ENV_FILE="/Users/pete/Sites/creeklab/mcp-skills/.env"

[ -f "$LIB/catalog.json" ] || { echo "No $LIB/catalog.json — run npm run photos:build first" >&2; exit 1; }

# Credentials from the shared .env, never echoed (see the cloudflare skill).
export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-$(grep '^CLOUDFLARE_API_TOKEN=' "$ENV_FILE" | cut -d= -f2-)}"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(grep '^CLOUDFLARE_ACCOUNT_ID=' "$ENV_FILE" | cut -d= -f2-)}"
CF="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects"
AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json")

if [ ! -f "$STATE" ]; then
  # openssl, not `tr </dev/urandom | head`: that pipe ends in SIGPIPE, which
  # pipefail + set -e turn into a silent exit.
  PROJECT="orbgen-library-$(openssl rand -hex 5)"
  KEY="$(openssl rand -hex 16)"
  echo "Creating Pages project ${PROJECT}…"
  curl -s -X POST "$CF" "${AUTH[@]}" \
    --data "{\"name\":\"$PROJECT\",\"production_branch\":\"main\"}" | jq -e '.success' >/dev/null \
    || { echo "Project creation failed" >&2; exit 1; }
  curl -s -X PATCH "$CF/$PROJECT" "${AUTH[@]}" \
    --data "{\"deployment_configs\":{\"production\":{\"env_vars\":{\"WRITE_KEY\":{\"type\":\"secret_text\",\"value\":\"$KEY\"}}}}}" \
    | jq -e '.success' >/dev/null || { echo "Setting WRITE_KEY failed" >&2; exit 1; }
  SUB="$(curl -s "$CF/$PROJECT" "${AUTH[@]}" | jq -r '.result.subdomain')"
  jq -n --arg p "$PROJECT" --arg u "https://$SUB" --arg k "$KEY" '{project:$p, url:$u, key:$k}' > "$STATE"
  chmod 600 "$STATE"
fi
PROJECT="$(jq -r .project "$STATE")"
URL="$(jq -r .url "$STATE")"
KEY="$(jq -r .key "$STATE")"

# A clean upload folder of hard links: only what the site needs, never the
# local tmp files or anything else that lands in photo-library/.
rm -rf "$DEPLOY"
mkdir -p "$DEPLOY"
rsync -a --link-dest="$LIB" --include='/catalog.json' --include='/prefs.json' \
  --include='/full/***' --include='/thumbs/***' --exclude='*' "$LIB/" "$DEPLOY/"
cp "$SITE/_headers" "$SITE/robots.txt" "$SITE/_routes.json" "$DEPLOY/"
[ -f "$DEPLOY/prefs.json" ] || echo '{"favorites":[],"hidden":[],"framing":{}}' > "$DEPLOY/prefs.json"
echo "Uploading $(find "$DEPLOY" -type f | wc -l | tr -d ' ') files ($(du -sh "$DEPLOY" | cut -f1)) to ${PROJECT}…"

# wrangler picks up functions/ from the working directory.
cd "$SITE"
npx --yes wrangler@4 pages deploy "$DEPLOY" --project-name "$PROJECT" --branch main --commit-dirty=true

echo
echo "Hosted library: $URL"
echo "Team invite link (keep it internal — it is the only lock until Access is set up):"
echo "  https://orbs.fnfn.us/?library=$URL&key=$KEY"
