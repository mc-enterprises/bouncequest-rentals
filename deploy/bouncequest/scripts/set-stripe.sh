#!/usr/bin/env bash
# Q's one step for payments. Run on the VPS:
#   sudo /opt/bouncequest-rentals/scripts/set-stripe.sh
# Paste the Stripe secret key (sk_test_... or sk_live_...) and publishable key (pk_...)
# when asked; nothing is echoed. The script then creates the webhook endpoint
#   https://$BQ_DOMAIN/api/webhooks/stripe/connect
# on that Stripe account, stores its signing secret, restarts the app and links the
# store to the account (direct mode). Re-running replaces the keys and the endpoint.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=.env
# shellcheck disable=SC1090
BQ_DOMAIN="$(grep '^BQ_DOMAIN=' "$ENV_FILE" | cut -d= -f2-)"

read -r -s -p "Stripe secret key (sk_...): " SK; echo
read -r -s -p "Stripe publishable key (pk_...): " PK; echo
case "$SK" in sk_test_*|sk_live_*|rk_test_*|rk_live_*) ;; *) echo "not a Stripe secret key"; exit 1;; esac
case "$PK" in pk_test_*|pk_live_*) ;; *) echo "not a Stripe publishable key"; exit 1;; esac

URL="https://${BQ_DOMAIN}/api/webhooks/stripe/connect"
# Remove an earlier BounceQuest endpoint for the same URL, then create a fresh one.
for id in $(curl -fsS -u "$SK:" "https://api.stripe.com/v1/webhook_endpoints?limit=100" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const e of JSON.parse(s).data){if(e.url===process.argv[1])console.log(e.id)}})' "$URL"); do
  curl -fsS -u "$SK:" -X DELETE "https://api.stripe.com/v1/webhook_endpoints/$id" >/dev/null
  echo "replaced endpoint $id"
done
CREATED="$(curl -fsS -u "$SK:" https://api.stripe.com/v1/webhook_endpoints \
  -d url="$URL" \
  -d description="BounceQuest Rentals (rentals deposit -> Confirmed)" \
  -d "enabled_events[]=checkout.session.completed" \
  -d "enabled_events[]=checkout.session.expired" \
  -d "enabled_events[]=checkout.session.async_payment_succeeded" \
  -d "enabled_events[]=checkout.session.async_payment_failed" \
  -d "enabled_events[]=payment_intent.amount_capturable_updated" \
  -d "enabled_events[]=payment_intent.canceled" \
  -d "enabled_events[]=payment_intent.payment_failed" \
  -d "enabled_events[]=charge.refunded" \
  -d "enabled_events[]=charge.captured")"
WHSEC="$(printf '%s' "$CREATED" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).secret))')"
WHID="$(printf '%s' "$CREATED" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')"

umask 077
tmp="$(mktemp)"
grep -v -E '^(STRIPE_SECRET_KEY|STRIPE_PUBLISHABLE_KEY|STRIPE_WEBHOOK_SECRET)=' "$ENV_FILE" > "$tmp" || true
{
  printf 'STRIPE_SECRET_KEY=%s\n' "$SK"
  printf 'STRIPE_PUBLISHABLE_KEY=%s\n' "$PK"
  printf 'STRIPE_WEBHOOK_SECRET=%s\n' "$WHSEC"
} >> "$tmp"
mv "$tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"
unset SK PK WHSEC

docker compose --env-file "$ENV_FILE" up -d app
docker compose --env-file "$ENV_FILE" run --rm seed sh -c "npm install --no-audit --no-fund --omit=dev >/dev/null && node seed.mjs"
echo "Stripe connected. Webhook endpoint: $WHID -> $URL"
