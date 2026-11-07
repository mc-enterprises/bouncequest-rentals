# BounceQuest Rentals — Phase 1 deployment

Fork of [Synapsr/Louez](https://github.com/Synapsr/Louez) (AGPL-3.0). Source of this
deployment: https://github.com/mc-enterprises/bouncequest-rentals.

| What | Where |
| --- | --- |
| Storefront | `https://rentals.316fatboyz.com/` |
| Admin login | `https://rentals.316fatboyz.com/login` (first account: `/register`) |
| Admin | `https://rentals.316fatboyz.com/dashboard` |
| Stripe webhook | `https://rentals.316fatboyz.com/api/webhooks/stripe/connect` |
| Host | Hetzner `McEntprises` 5.161.122.138, `/opt/bouncequest-rentals` |
| Image | `ghcr.io/mc-enterprises/bouncequest-rentals` (built by `.github/workflows/bouncequest-image.yml`) |

## What Phase 1 adds to Louez

- **Event statuses** (InflatableOffice): Cancelled, Partial, Quote, Hold, Contracted, Confirmed,
  Complete (`packages/db/src/event-status.ts`). Hold → Complete reserve inventory; availability is
  stock minus overlapping reservations across delivery → return plus the 90-minute setup buffer.
  Staff set it on the event page (Event status card); the list shows it as a badge.
- **Shared prices**: Settings → Shared prices. Flat per event or tiered by hours; saving a template
  rewrites every linked item.
- **Storefront**: dates first, only available items, cart, miles-based delivery fee (price per
  mile each way, minimum per leg, max distance), required Setup surface + Venue type questions,
  rental agreement + safety waiver signed by typing a full name (name, time and IP recorded and
  printed on the PDF), Stripe Checkout for the deposit (25% default).
- **Stripe direct mode**: the store uses BounceQuest's own Stripe account (no Connect). The
  webhook marks the payment and moves the event to Confirmed.
- **Settings**: business hours and blackout dates (Hours), days of notice and **max advance days**
  (Reservations), deposit %, tax rate (Taxes).
- **Emails**: quote, confirmation with *Paid today* and *Balance due*, signed agreement PDF attached.
- **n8n**: every status change (and creation) POSTs JSON to `BQ_STATUS_WEBHOOK_URL`, signed with
  `x-bouncequest-signature: sha256=<hmac of body with BQ_STATUS_WEBHOOK_SECRET>`.

## Operate

```bash
cd /opt/bouncequest-rentals
sudo ./scripts/init-env.sh                 # once: generates secrets into .env (600)
sudo docker compose --env-file .env pull && sudo docker compose --env-file .env up -d
sudo ./scripts/set-stripe.sh               # Q pastes Stripe keys; creates the webhook endpoint
sudo ./scripts/set-smtp.sh                 # Q pastes SMTP credentials
sudo docker compose --env-file .env logs -f app
```

The `seed` service waits for the first account, then creates/configures the store with the
sample catalog (9 items, 5 categories — edit names and prices in the dashboard). Re-runs keep
dashboard edits; `node seed.mjs --force` re-applies the defaults.

Backups: nightly `mysqldump` to `/opt/bouncequest-rentals/backups` (14 days). The VPS has no
provider backups; copy these off-host.
