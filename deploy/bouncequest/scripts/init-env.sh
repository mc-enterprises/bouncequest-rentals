#!/usr/bin/env bash
# Create /opt/bouncequest-rentals/.env with generated secrets (once). Never prints values.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=.env
umask 077
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

rand() { openssl rand -hex "${1:-24}"; }
set_default() {
  local key="$1" value="$2"
  if ! grep -q "^${key}=" "$ENV_FILE"; then
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    echo "set ${key}"
  fi
}

set_default BQ_DOMAIN "${BQ_DOMAIN:-rentals.316fatboyz.com}"
set_default BQ_PUBLIC_IP "${BQ_PUBLIC_IP:-5.161.122.138}"
set_default BQ_IMAGE "ghcr.io/mc-enterprises/bouncequest-rentals:latest"
set_default ACME_EMAIL "${ACME_EMAIL:-}"
set_default AUTH_SECRET "$(openssl rand -base64 32 | tr -d '\n')"
set_default DB_PASSWORD "$(rand)"
set_default DB_ROOT_PASSWORD "$(rand)"
set_default MINIO_ROOT_USER "bouncequest"
set_default MINIO_ROOT_PASSWORD "$(rand)"
set_default CRON_SECRET "$(rand)"
set_default BQ_STATUS_WEBHOOK_SECRET "$(rand)"
set_default BQ_STATUS_WEBHOOK_URL "${BQ_STATUS_WEBHOOK_URL:-}"
set_default BQ_DEPOSIT_PERCENT "25"
set_default STRIPE_SECRET_KEY ""
set_default STRIPE_PUBLISHABLE_KEY ""
set_default STRIPE_WEBHOOK_SECRET ""
set_default SMTP_HOST ""
set_default SMTP_PORT "587"
set_default SMTP_SECURE "false"
set_default SMTP_USER ""
set_default SMTP_PASSWORD ""
set_default SMTP_FROM ""
set_default GOOGLE_PLACES_API_KEY ""
echo "env ready: $(grep -c '=' "$ENV_FILE") keys in $(pwd)/$ENV_FILE"
