"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, toastManager } from "@louez/ui";

import { setReservationEventStatus } from "../event-status-actions";

// Kept in sync with packages/db/src/event-status.ts (client bundle cannot import @louez/db).
const EVENT_STATUS_OPTIONS = [
  { value: "cancelled", label: "Cancelled", reserves: false },
  { value: "partial", label: "Partial", reserves: false },
  { value: "quote", label: "Quote", reserves: false },
  { value: "hold", label: "Hold", reserves: true },
  { value: "contracted", label: "Contracted", reserves: true },
  { value: "confirmed", label: "Confirmed", reserves: true },
  { value: "complete", label: "Complete", reserves: true },
] as const;

type LouezStatus =
  | "pending"
  | "confirmed"
  | "ongoing"
  | "completed"
  | "cancelled"
  | "rejected"
  | "quote"
  | "declined";

export function deriveClientEventStatus(
  status: LouezStatus,
  eventStatus: string | null | undefined,
  signedAt: unknown,
): string {
  switch (status) {
    case "quote":
      return eventStatus === "partial" ? "partial" : "quote";
    case "pending":
      if (eventStatus === "hold" || eventStatus === "contracted") return eventStatus;
      return signedAt ? "contracted" : "hold";
    case "confirmed":
    case "ongoing":
      return "confirmed";
    case "completed":
      return "complete";
    default:
      return "cancelled";
  }
}

const BADGE: Record<string, string> = {
  cancelled: "bg-muted text-muted-foreground",
  partial: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  quote: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  hold: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  contracted: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  confirmed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  complete: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
};

export function EventStatusBadge({ value }: { value: string }) {
  const option = EVENT_STATUS_OPTIONS.find((o) => o.value === value);
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${BADGE[value] ?? ""}`}
    >
      {option?.label ?? value}
    </span>
  );
}

export function EventStatusCard({
  reservationId,
  status,
  eventStatus,
  signedAt,
  readOnly,
}: {
  reservationId: string;
  status: LouezStatus;
  eventStatus: string | null | undefined;
  signedAt: unknown;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const current = deriveClientEventStatus(status, eventStatus, signedAt);
  const [selected, setSelected] = useState(current);
  const [isPending, startTransition] = useTransition();
  const option = EVENT_STATUS_OPTIONS.find((o) => o.value === current);

  function save() {
    startTransition(async () => {
      const result = await setReservationEventStatus(reservationId, selected);
      if ("error" in result && result.error) {
        toastManager.add({ title: String(result.error), type: "error" });
        setSelected(current);
        return;
      }
      toastManager.add({ title: "Event status updated", type: "success" });
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Event status <EventStatusBadge value={current} />
        </CardTitle>
        <CardDescription>
          {option?.reserves
            ? "This event reserves its items from delivery to return."
            : "This event does not reserve inventory."}
        </CardDescription>
      </CardHeader>
      {!readOnly ? (
        <CardContent className="flex gap-2">
          <select
            aria-label="Event status"
            className="h-9 flex-1 rounded-lg border border-input bg-background px-2.5 text-sm"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            {EVENT_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Button type="button" onClick={save} disabled={isPending || selected === current}>
            Update
          </Button>
        </CardContent>
      ) : null}
    </Card>
  );
}
