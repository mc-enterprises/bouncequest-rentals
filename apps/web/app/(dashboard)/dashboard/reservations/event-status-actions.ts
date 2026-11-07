"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import {
  db,
  deriveEventStatus,
  isEventStatus,
  louezStatusForEventStatus,
  planLouezStatusPath,
  queueStatusWebhook,
  reservations,
  type EventStatus,
} from "@louez/db";
import { cancelStoreReservation, updateStoreReservationStatus } from "@/lib/reservations/status-change";
import { auth } from "@/lib/auth";
import { getCurrentStore } from "@/lib/store-context";

async function getActorUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id || null;
}

/**
 * Set a BounceQuest (InflatableOffice) event status. The reservation walks the
 * allowed Louez transitions to the matching Louez status, so stock, payments and
 * emails behave as for any status change; then the narrowing label (Partial vs
 * Quote, Hold vs Contracted) is stored. Every change fires the n8n webhook.
 */
export async function setReservationEventStatus(reservationId: string, eventStatus: string) {
  if (!isEventStatus(eventStatus)) return { error: "errors.invalidData" };
  const store = await getCurrentStore();
  if (!store) return { error: "errors.unauthorized" };

  const scope = and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id));
  const [current] = await db
    .select({
      status: reservations.status,
      eventStatus: reservations.eventStatus,
      signedAt: reservations.signedAt,
    })
    .from(reservations)
    .where(scope)
    .limit(1);
  if (!current) return { error: "errors.reservationNotFound" };

  const previousEventStatus = deriveEventStatus(current);
  if (previousEventStatus === eventStatus) return { success: true as const };

  const target = louezStatusForEventStatus(eventStatus as EventStatus);
  const path = planLouezStatusPath(current.status, target);
  if (path === null) {
    return {
      error: `A ${previousEventStatus} event cannot become ${eventStatus}. Create a new event instead.`,
    };
  }

  const actorUserId = await getActorUserId();
  for (const step of path) {
    const outcome =
      step === "cancelled"
        ? await cancelStoreReservation({ store, reservationId, actor: "store_user", actorUserId })
        : await updateStoreReservationStatus({
            store,
            reservationId,
            status: step,
            actor: "store_user",
            actorUserId,
          });
    if (!outcome.ok) {
      const message =
        "message" in outcome && typeof outcome.message === "string"
          ? outcome.message
          : `Could not move the event to ${step} (${outcome.error}).`;
      return { error: message };
    }
  }

  await db.update(reservations).set({ eventStatus, updatedAt: new Date() }).where(scope);
  if (path.length === 0) {
    // Label-only change (Partial <-> Quote, Hold <-> Contracted): Louez did not fire one.
    queueStatusWebhook({
      reservationId,
      previousStatus: current.status,
      previousEventStatus,
      expectedStatus: target,
      actor: "store_user",
    });
  }

  revalidatePath(`/dashboard/reservations/${reservationId}`);
  revalidatePath("/dashboard/reservations");
  return { success: true as const };
}
