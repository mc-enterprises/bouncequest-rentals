import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db, priceTemplates, products } from "@louez/db";
import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { getCurrentStore } from "@/lib/store-context";
import { PriceTemplatesForm, type PriceTemplateRow } from "./price-templates-form";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
export const instant = false;

export default async function PriceTemplatesPage() {
  const store = await getCurrentStore();
  if (!store) redirect("/onboarding");

  const [templates, productRows] = await Promise.all([
    db
      .select()
      .from(priceTemplates)
      .where(eq(priceTemplates.storeId, store.id))
      .orderBy(asc(priceTemplates.name)),
    db
      .select({ id: products.id, name: products.name, priceTemplateId: products.priceTemplateId })
      .from(products)
      .where(eq(products.storeId, store.id))
      .orderBy(asc(products.name)),
  ]);

  const rows: PriceTemplateRow[] = templates.map((template) => ({
    id: template.id,
    name: template.name,
    pricingKind: template.pricingKind,
    pricingMode: template.pricingMode,
    price: Number(template.price),
    basePeriodMinutes: template.basePeriodMinutes,
    enforceStrictTiers: template.enforceStrictTiers,
    tiers: template.tiers ?? [],
    productIds: productRows.filter((p) => p.priceTemplateId === template.id).map((p) => p.id),
  }));

  return (
    <SettingsPageShell
      title="Shared prices"
      description="One price used by many items. Flat prices charge once per event; tiered prices charge by the number of hours. Saving a template updates every linked item."
    >
      <PriceTemplatesForm
        templates={rows}
        products={productRows.map((p) => ({ id: p.id, name: p.name }))}
        currency={store.settings?.currency ?? "USD"}
      />
    </SettingsPageShell>
  );
}
