#!/usr/bin/env bash
# Q's one step for e-mail. Run on the VPS:
#   sudo /opt/bouncequest-rentals/scripts/set-smtp.sh
# Works with any SMTP relay. For Gmail: host smtp.gmail.com, port 587, user = the Gmail
# address, password = a Google app password (myaccount.google.com/apppasswords).
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=.env
read -r -p "SMTP host [smtp.gmail.com]: " HOST; HOST="${HOST:-smtp.gmail.com}"
read -r -p "SMTP port [587]: " PORT; PORT="${PORT:-587}"
read -r -p "SMTP user (full e-mail address): " USER_NAME
read -r -s -p "SMTP password (not shown): " PASS; echo
read -r -p "From address [BounceQuest Rentals <${USER_NAME}>]: " FROM; FROM="${FROM:-BounceQuest Rentals <${USER_NAME}>}"
SECURE=false; [ "$PORT" = "465" ] && SECURE=true

umask 077
tmp="$(mktemp)"
grep -v -E '^SMTP_(HOST|PORT|SECURE|USER|PASSWORD|FROM)=' "$ENV_FILE" > "$tmp" || true
{
  printf 'SMTP_HOST=%s\nSMTP_PORT=%s\nSMTP_SECURE=%s\nSMTP_USER=%s\n' "$HOST" "$PORT" "$SECURE" "$USER_NAME"
  printf 'SMTP_PASSWORD=%s\nSMTP_FROM=%s\n' "$PASS" "$FROM"
} >> "$tmp"
mv "$tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"
unset PASS
docker compose --env-file "$ENV_FILE" up -d app
echo "SMTP saved; app restarted."
