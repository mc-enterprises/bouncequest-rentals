"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db, deletePriceTemplate, savePriceTemplate } from "@louez/db";
import { getCurrentStore, hasPermission } from "@/lib/store-context";

const tierSchema = z.object({
  period: z.number().int().min(1).max(60 * 24 * 60),
  price: z.number().min(0).max(1_000_000),
});

const templateSchema = z.object({
  id: z.string().max(21).nullable().optional(),
  name: z.string().trim().min(1).max(255),
  pricingKind: z.enum(["fixed", "duration"]),
  pricingMode: z.enum(["hour", "day", "week"]),
  price: z.number().min(0).max(1_000_000),
  basePeriodMinutes: z.number().int().min(1).max(60 * 24 * 60).nullable(),
  enforceStrictTiers: z.boolean(),
  tiers: z.array(tierSchema).max(20),
  productIds: z.array(z.string().max(21)).max(500),
});

export type PriceTemplateFormInput = z.infer<typeof templateSchema>;

async function authorize() {
  const store = await getCurrentStore();
  if (!store) return { error: "errors.unauthorized" as const };
  if (!hasPermission(store.role, "manage_settings")) {
    return { error: "errors.permissionDenied" as const };
  }
  return { store };
}

export async function savePriceTemplateAction(data: PriceTemplateFormInput) {
  const auth = await authorize();
  if ("error" in auth) return { error: auth.error };
  const parsed = templateSchema.safeParse(data);
  if (!parsed.success) return { error: "errors.invalidData" };

  const { id, productIds, ...input } = parsed.data;
  const result = await db.transaction((tx) =>
    savePriceTemplate(tx, { storeId: auth.store.id, templateId: id ?? null, input, productIds }),
  );

  revalidatePath("/dashboard/settings/price-templates");
  revalidatePath("/dashboard/products", "layout");
  return { success: true as const, id: result.id, applied: result.applied };
}

export async function deletePriceTemplateAction(templateId: string) {
  const auth = await authorize();
  if ("error" in auth) return { error: auth.error };
  if (!templateId || templateId.length > 21) return { error: "errors.invalidData" };
  await db.transaction((tx) =>
    deletePriceTemplate(tx, { storeId: auth.store.id, templateId }),
  );
  revalidatePath("/dashboard/settings/price-templates");
  return { success: true as const };
}
