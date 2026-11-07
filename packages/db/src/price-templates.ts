import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { Database, Transaction } from "./index";
import {
  priceTemplates,
  productPricingTiers,
  products,
  type PriceTemplateTier,
} from "./schema";

/**
 * BounceQuest shared prices. A template owns the price of every product linked to
 * it: applying it copies the price, pricing kind/mode, base period, strict-tier
 * flag and tiers onto each linked product, so the existing pricing engine keeps
 * reading product rows and nothing else in Louez has to know about templates.
 */

type Executor = Database | Transaction;

export interface PriceTemplateInput {
  name: string;
  pricingKind: "fixed" | "duration";
  pricingMode: "hour" | "day" | "week";
  price: number;
  basePeriodMinutes: number | null;
  enforceStrictTiers: boolean;
  tiers: PriceTemplateTier[];
}

export function normalizePriceTemplateInput(input: PriceTemplateInput): PriceTemplateInput {
  const fixed = input.pricingKind === "fixed";
  const tiers = fixed
    ? []
    : [...input.tiers]
        .filter((tier) => tier.period > 0 && tier.price >= 0)
        .filter((tier) => tier.period !== input.basePeriodMinutes)
        .sort((a, b) => a.period - b.period)
        .filter((tier, index, all) => index === 0 || all[index - 1].period !== tier.period);
  return {
    name: input.name.trim(),
    pricingKind: input.pricingKind,
    pricingMode: input.pricingMode,
    price: Math.round(input.price * 100) / 100,
    basePeriodMinutes: fixed ? null : (input.basePeriodMinutes ?? 60),
    enforceStrictTiers: fixed ? false : input.enforceStrictTiers,
    tiers,
  };
}

/** Copy a template onto every product linked to it (or onto `productIds` only). */
export async function applyPriceTemplate(
  executor: Executor,
  params: { storeId: string; templateId: string; productIds?: string[] },
): Promise<number> {
  const [template] = await executor
    .select()
    .from(priceTemplates)
    .where(and(eq(priceTemplates.id, params.templateId), eq(priceTemplates.storeId, params.storeId)))
    .limit(1);
  if (!template) return 0;

  const linked = await executor
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.storeId, params.storeId),
        eq(products.priceTemplateId, template.id),
        params.productIds && params.productIds.length > 0
          ? inArray(products.id, params.productIds)
          : undefined,
      ),
    );
  const ids = linked.map((row) => row.id);
  if (ids.length === 0) return 0;

  const fixed = template.pricingKind === "fixed";
  const now = new Date();
  await executor
    .update(products)
    .set({
      price: template.price,
      pricingKind: template.pricingKind,
      pricingMode: template.pricingMode,
      basePeriodMinutes: fixed ? null : template.basePeriodMinutes,
      enforceStrictTiers: fixed ? false : template.enforceStrictTiers,
      updatedAt: now,
    })
    .where(inArray(products.id, ids));

  await executor.delete(productPricingTiers).where(inArray(productPricingTiers.productId, ids));
  const tiers = fixed ? [] : (template.tiers ?? []);
  if (tiers.length > 0) {
    await executor.insert(productPricingTiers).values(
      ids.flatMap((productId) =>
        tiers.map((tier, index) => ({
          id: nanoid(),
          productId,
          period: tier.period,
          price: tier.price.toFixed(2),
          displayOrder: index,
          createdAt: now,
          updatedAt: now,
        })),
      ),
    );
  }
  return ids.length;
}

export async function savePriceTemplate(
  executor: Executor,
  params: { storeId: string; templateId?: string | null; input: PriceTemplateInput; productIds: string[] },
): Promise<{ id: string; applied: number }> {
  const input = normalizePriceTemplateInput(params.input);
  const now = new Date();
  const values = {
    name: input.name,
    pricingKind: input.pricingKind,
    pricingMode: input.pricingMode,
    price: input.price.toFixed(2),
    basePeriodMinutes: input.basePeriodMinutes,
    enforceStrictTiers: input.enforceStrictTiers,
    tiers: input.tiers,
    updatedAt: now,
  };

  let id = params.templateId ?? null;
  if (id) {
    await executor
      .update(priceTemplates)
      .set(values)
      .where(and(eq(priceTemplates.id, id), eq(priceTemplates.storeId, params.storeId)));
  } else {
    id = nanoid();
    await executor
      .insert(priceTemplates)
      .values({ id, storeId: params.storeId, ...values, createdAt: now });
  }

  // Unlink products that were removed from the template; they keep their last price.
  const current = await executor
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.storeId, params.storeId), eq(products.priceTemplateId, id)));
  const keep = new Set(params.productIds);
  const unlink = current.map((row) => row.id).filter((productId) => !keep.has(productId));
  if (unlink.length > 0) {
    await executor
      .update(products)
      .set({ priceTemplateId: null, updatedAt: now })
      .where(inArray(products.id, unlink));
  }
  if (params.productIds.length > 0) {
    await executor
      .update(products)
      .set({ priceTemplateId: id, updatedAt: now })
      .where(and(eq(products.storeId, params.storeId), inArray(products.id, params.productIds)));
  }

  const applied = await applyPriceTemplate(executor, { storeId: params.storeId, templateId: id });
  return { id, applied };
}

export async function deletePriceTemplate(
  executor: Executor,
  params: { storeId: string; templateId: string },
): Promise<void> {
  await executor
    .update(products)
    .set({ priceTemplateId: null, updatedAt: new Date() })
    .where(and(eq(products.storeId, params.storeId), eq(products.priceTemplateId, params.templateId)));
  await executor
    .delete(priceTemplates)
    .where(and(eq(priceTemplates.id, params.templateId), eq(priceTemplates.storeId, params.storeId)));
}
