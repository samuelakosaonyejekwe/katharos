#!/usr/bin/env bash
# Publishes the current build to every mirror you have credentials for — runnable from any machine,
# so the app can be re-published even if GitHub is unavailable.
#   CLOUDFLARE_PROJECT=katharos CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=…  → Cloudflare Pages
#   NETLIFY_SITE_ID=…  NETLIFY_AUTH_TOKEN=…                                     → Netlify
#   VERCEL_TOKEN=…                                                              → Vercel
#   SURGE_DOMAIN=katharos.surge.sh  SURGE_TOKEN=…                               → Surge
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
[ -n "${CLOUDFLARE_PROJECT:-}" ] && npx --yes wrangler@4 pages deploy dist --project-name "$CLOUDFLARE_PROJECT" --branch main
[ -n "${NETLIFY_SITE_ID:-}" ] && npx --yes netlify-cli@17 deploy --dir dist --prod --site "$NETLIFY_SITE_ID"
[ -n "${VERCEL_TOKEN:-}" ] && npx --yes vercel@latest deploy dist --prod --yes --token "$VERCEL_TOKEN"
[ -n "${SURGE_DOMAIN:-}" ] && npx --yes surge@0.23 dist "$SURGE_DOMAIN"
echo "done"
