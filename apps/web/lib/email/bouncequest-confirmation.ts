import { and, eq } from "drizzle-orm";

import { db, payments } from "@louez/db";
import { log } from "@/lib/evlog";
import { generateContract } from "@/lib/pdf/generate";

import type { EmailAttachment } from "./client";

/**
 * BounceQuest confirmation extras: what has been paid, the balance due on the
 * day of the event, and the signed rental agreement as a PDF attachment.
 */
export async function getBounceQuestConfirmationExtras(params: {
  reservationId: string;
  reservationNumber: string;
  totalAmount: number;
  existingAttachments: EmailAttachment[];
}): Promise<{ amountPaid: number; balanceDue: number; attachments: EmailAttachment[] }> {
  let amountPaid = 0;
  try {
    const rows = await db
      .select({ amount: payments.amount, type: payments.type, status: payments.status })
      .from(payments)
      .where(and(eq(payments.reservationId, params.reservationId), eq(payments.status, "completed")));
    amountPaid = rows
      .filter((row) => row.type === "rental")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  } catch (error) {
    log.warn("email", `could not read payments for ${params.reservationId}: ${String(error)}`);
  }
  amountPaid = Math.round(amountPaid * 100) / 100;
  const balanceDue = Math.max(0, Math.round((params.totalAmount - amountPaid) * 100) / 100);

  const attachments: EmailAttachment[] = [];
  if (!params.existingAttachments.some((a) => a.cid.startsWith("contract-"))) {
    try {
      const contract = await generateContract({ reservationId: params.reservationId });
      const prefix = "data:application/pdf;base64,";
      if (contract?.fileUrl?.startsWith(prefix)) {
        attachments.push({
          filename: `BounceQuest-rental-agreement-${params.reservationNumber}.pdf`,
          content: Buffer.from(contract.fileUrl.slice(prefix.length), "base64"),
          cid: `contract-${contract.id}`,
        });
      }
    } catch (error) {
      log.warn("email", `contract PDF not attached for ${params.reservationId}: ${String(error)}`);
    }
  }

  return { amountPaid, balanceDue, attachments };
}
