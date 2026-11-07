import { createHmac } from "node:crypto";

import { EVENT_STATUSES, type EventStatus } from "./schema";
import { getAllowedReservationStatusTransitions } from "./consumable-stock";
import type { reservations } from "./schema";

/**
 * BounceQuest event statuses (InflatableOffice vocabulary) layered on Louez's
 * reservation lifecycle. Louez's `status` stays the engine: it drives stock,
 * payments and emails. `event_status` only narrows two Louez statuses that
 * InflatableOffice splits in two:
 *
 *   Cancelled  -> cancelled | rejected | declined
 *   Partial    -> quote      (an unfinished lead; does not reserve inventory)
 *   Quote      -> quote      (does not reserve inventory)
 *   Hold       -> pending    (reserves inventory, contract not signed)
 *   Contracted -> pending    (reserves inventory, contract signed, unpaid)
 *   Confirmed  -> confirmed | ongoing (deposit paid)
 *   Complete   -> completed
 *
 * Hold through Complete reserve inventory because pending, confirmed, ongoing
 * and completed are the blocking Louez statuses (unit-availability.ts).
 */

type LouezStatus = (typeof reservations.$inferSelect)["status"];

export { EVENT_STATUSES };
export type { EventStatus };

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  cancelled: "Cancelled",
  partial: "Partial",
  quote: "Quote",
  hold: "Hold",
  contracted: "Contracted",
  confirmed: "Confirmed",
  complete: "Complete",
};

export const INVENTORY_RESERVING_EVENT_STATUSES: readonly EventStatus[] = [
  "hold",
  "contracted",
  "confirmed",
  "complete",
];

export function isEventStatus(value: unknown): value is EventStatus {
  return typeof value === "string" && (EVENT_STATUSES as readonly string[]).includes(value);
}

/** The Louez status an event status lives under. */
export function louezStatusForEventStatus(eventStatus: EventStatus): LouezStatus {
  switch (eventStatus) {
    case "cancelled":
      return "cancelled";
    case "partial":
    case "quote":
      return "quote";
    case "hold":
    case "contracted":
      return "pending";
    case "confirmed":
      return "confirmed";
    case "complete":
      return "completed";
  }
}

/** The event status to show for a reservation row. */
export function deriveEventStatus(row: {
  status: LouezStatus;
  eventStatus?: string | null;
  signedAt?: Date | null;
}): EventStatus {
  const stored = isEventStatus(row.eventStatus) ? row.eventStatus : null;
  switch (row.status) {
    case "quote":
      return stored === "partial" ? "partial" : "quote";
    case "pending":
      if (stored === "hold" || stored === "contracted") return stored;
      return row.signedAt ? "contracted" : "hold";
    case "confirmed":
    case "ongoing":
      return "confirmed";
    case "completed":
      return "complete";
    case "cancelled":
    case "rejected":
    case "declined":
      return "cancelled";
  }
}

/**
 * The event status to store after Louez moves a reservation to `to`. A move
 * between Louez statuses resets the narrowing, except that a pending
 * reservation keeps the contract signal.
 */
export function eventStatusAfterLouezChange(
  to: LouezStatus,
  signedAt: Date | null | undefined,
): EventStatus {
  return deriveEventStatus({ status: to, eventStatus: null, signedAt });
}

/**
 * The chain of Louez statuses that takes a reservation from `from` to `to`
 * through allowed transitions only (shortest path). Empty when `from === to`;
 * null when no path exists.
 */
export function planLouezStatusPath(from: LouezStatus, to: LouezStatus): LouezStatus[] | null {
  if (from === to) return [];
  const previous = new Map<LouezStatus, LouezStatus | null>([[from, null]]);
  const queue: LouezStatus[] = [from];
  while (queue.length > 0) {
    const current = queue.shift() as LouezStatus;
    for (const next of getAllowedReservationStatusTransitions(current)) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      if (next === to) {
        const path: LouezStatus[] = [];
        let step: LouezStatus | null = next;
        while (step && step !== from) {
          path.unshift(step);
          step = previous.get(step) ?? null;
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Outgoing status webhook (n8n). Fired after the status transaction commits.
// ---------------------------------------------------------------------------

export interface StatusWebhookPayload {
  event: "reservation.status_changed" | "reservation.created";
  reservationId: string;
  storeId: string;
  number?: string | null;
  previousStatus: string | null;
  status: string;
  previousEventStatus: EventStatus | null;
  eventStatus: EventStatus;
  actor?: string | null;
  occurredAt: string;
}

export interface StatusWebhookSnapshot {
  id: string;
  storeId: string;
  number: string | null;
  status: LouezStatus;
  eventStatus: string | null;
  signedAt: Date | null;
}

export type StatusWebhookLoader = (reservationId: string) => Promise<StatusWebhookSnapshot | null>;

let snapshotLoader: StatusWebhookLoader | null = null;

/** Registered once by the db package so the webhook can read the committed row. */
export function registerStatusWebhookLoader(loader: StatusWebhookLoader) {
  snapshotLoader = loader;
}

function webhookUrl(): string | null {
  const value = process.env.BQ_STATUS_WEBHOOK_URL?.trim();
  return value ? value : null;
}

export function signStatusWebhookBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

async function postStatusWebhook(payload: StatusWebhookPayload): Promise<void> {
  const url = webhookUrl();
  if (!url) return;
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "bouncequest-rentals/1",
  };
  const secret = process.env.BQ_STATUS_WEBHOOK_SECRET?.trim();
  if (secret) headers["x-bouncequest-signature"] = `sha256=${signStatusWebhookBody(body, secret)}`;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
  }
  console.error("[bouncequest] status webhook failed", payload.reservationId, lastError);
}

/**
 * Queue a status webhook. It runs after a short delay so the caller's
 * transaction has committed, re-reads the row and only sends when the
 * committed status still matches (a rolled-back change sends nothing).
 */
export function queueStatusWebhook(input: {
  reservationId: string;
  previousStatus: LouezStatus | null;
  previousEventStatus: EventStatus | null;
  expectedStatus: LouezStatus;
  actor?: string | null;
  event?: StatusWebhookPayload["event"];
}): void {
  if (!webhookUrl()) return;
  const timer = setTimeout(() => {
    void (async () => {
      try {
        const row = snapshotLoader ? await snapshotLoader(input.reservationId) : null;
        if (!row || row.status !== input.expectedStatus) return;
        const eventStatus = deriveEventStatus(row);
        await postStatusWebhook({
          event: input.event ?? "reservation.status_changed",
          reservationId: row.id,
          storeId: row.storeId,
          number: row.number,
          previousStatus: input.previousStatus,
          status: row.status,
          previousEventStatus: input.previousEventStatus,
          eventStatus,
          actor: input.actor ?? null,
          occurredAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error("[bouncequest] status webhook error", input.reservationId, error);
      }
    })();
  }, 1_500);
  timer.unref?.();
}
