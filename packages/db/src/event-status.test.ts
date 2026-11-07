import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deriveEventStatus,
  INVENTORY_RESERVING_EVENT_STATUSES,
  louezStatusForEventStatus,
  planLouezStatusPath,
  signStatusWebhookBody,
} from "./event-status";
import { BLOCKING_RESERVATION_STATUSES, getBlockingReservationStatuses } from "./unit-availability";

describe("BounceQuest event statuses", () => {
  it("derives InflatableOffice labels from Louez statuses", () => {
    assert.equal(deriveEventStatus({ status: "quote" }), "quote");
    assert.equal(deriveEventStatus({ status: "quote", eventStatus: "partial" }), "partial");
    assert.equal(deriveEventStatus({ status: "pending" }), "hold");
    assert.equal(deriveEventStatus({ status: "pending", signedAt: new Date() }), "contracted");
    assert.equal(deriveEventStatus({ status: "pending", eventStatus: "hold", signedAt: new Date() }), "hold");
    assert.equal(deriveEventStatus({ status: "confirmed" }), "confirmed");
    assert.equal(deriveEventStatus({ status: "ongoing" }), "confirmed");
    assert.equal(deriveEventStatus({ status: "completed" }), "complete");
    for (const status of ["cancelled", "rejected", "declined"] as const) {
      assert.equal(deriveEventStatus({ status }), "cancelled");
    }
  });

  it("ignores a stored label that does not fit the Louez status", () => {
    assert.equal(deriveEventStatus({ status: "confirmed", eventStatus: "hold" }), "confirmed");
    assert.equal(deriveEventStatus({ status: "quote", eventStatus: "contracted" }), "quote");
  });

  it("Hold through Complete reserve inventory; Cancelled, Partial and Quote do not", () => {
    const blocking: readonly string[] = BLOCKING_RESERVATION_STATUSES;
    for (const eventStatus of ["hold", "contracted", "confirmed", "complete"] as const) {
      assert.ok(INVENTORY_RESERVING_EVENT_STATUSES.includes(eventStatus));
      assert.ok(blocking.includes(louezStatusForEventStatus(eventStatus)), eventStatus);
    }
    for (const eventStatus of ["cancelled", "partial", "quote"] as const) {
      assert.ok(!blocking.includes(louezStatusForEventStatus(eventStatus)), eventStatus);
    }
    assert.ok(getBlockingReservationStatuses(false).includes("completed"));
  });

  it("plans Louez transitions for an event status change", () => {
    assert.deepEqual(planLouezStatusPath("quote", "pending"), ["pending"]);
    assert.deepEqual(planLouezStatusPath("pending", "completed"), ["confirmed", "ongoing", "completed"]);
    assert.deepEqual(planLouezStatusPath("confirmed", "completed"), ["ongoing", "completed"]);
    assert.deepEqual(planLouezStatusPath("pending", "pending"), []);
    assert.equal(planLouezStatusPath("completed", "pending"), null);
    assert.equal(planLouezStatusPath("cancelled", "confirmed"), null);
  });

  it("signs webhook bodies with HMAC-SHA256", () => {
    assert.equal(signStatusWebhookBody("x", "y"), signStatusWebhookBody("x", "y"));
    assert.notEqual(signStatusWebhookBody("x", "y"), signStatusWebhookBody("x", "z"));
    assert.match(signStatusWebhookBody("x", "y"), /^[0-9a-f]{64}$/);
  });
});
