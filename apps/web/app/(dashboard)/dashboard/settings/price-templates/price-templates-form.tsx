"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  toastManager,
} from "@louez/ui";

import { deletePriceTemplateAction, savePriceTemplateAction } from "./actions";

export interface PriceTemplateRow {
  id: string | null;
  name: string;
  pricingKind: "fixed" | "duration";
  pricingMode: "hour" | "day" | "week";
  price: number;
  basePeriodMinutes: number | null;
  enforceStrictTiers: boolean;
  tiers: Array<{ period: number; price: number }>;
  productIds: string[];
}

interface ProductOption {
  id: string;
  name: string;
}

const NEW_TEMPLATE: PriceTemplateRow = {
  id: null,
  name: "",
  pricingKind: "fixed",
  pricingMode: "hour",
  price: 0,
  basePeriodMinutes: 240,
  enforceStrictTiers: true,
  tiers: [],
  productIds: [],
};

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm shadow-xs/5 outline-none focus-visible:ring-2 focus-visible:ring-ring";

function hours(minutes: number | null) {
  return minutes ? Math.round((minutes / 60) * 100) / 100 : 0;
}

function TemplateEditor({
  initial,
  products,
  currency,
  onDone,
}: {
  initial: PriceTemplateRow;
  products: ProductOption[];
  currency: string;
  onDone: () => void;
}) {
  const [row, setRow] = useState<PriceTemplateRow>(initial);
  const [isPending, startTransition] = useTransition();
  const tiered = row.pricingKind === "duration";

  function update<K extends keyof PriceTemplateRow>(key: K, value: PriceTemplateRow[K]) {
    setRow((current) => ({ ...current, [key]: value }));
  }

  function save() {
    startTransition(async () => {
      const result = await savePriceTemplateAction({
        id: row.id,
        name: row.name,
        pricingKind: row.pricingKind,
        pricingMode: "hour",
        price: Number(row.price) || 0,
        basePeriodMinutes: tiered ? row.basePeriodMinutes || 60 : null,
        enforceStrictTiers: row.enforceStrictTiers,
        tiers: tiered ? row.tiers : [],
        productIds: row.productIds,
      });
      if ("error" in result) {
        toastManager.add({ title: "Could not save the template", type: "error" });
        return;
      }
      toastManager.add({
        title: `Saved. ${result.applied} item${result.applied === 1 ? "" : "s"} updated.`,
        type: "success",
      });
      onDone();
    });
  }

  function remove() {
    if (!row.id) return onDone();
    if (!window.confirm(`Delete the shared price "${row.name}"? Linked items keep their current price.`)) return;
    startTransition(async () => {
      const result = await deletePriceTemplateAction(row.id as string);
      if ("error" in result) {
        toastManager.add({ title: "Could not delete the template", type: "error" });
        return;
      }
      onDone();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{row.id ? row.name || "Shared price" : "New shared price"}</CardTitle>
        <CardDescription>
          {tiered
            ? "Tiered by hours: the customer pays the first tier that covers the event length."
            : "Flat: one price per event, whatever the length."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`name-${row.id ?? "new"}`}>Name</Label>
            <Input
              id={`name-${row.id ?? "new"}`}
              value={row.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder="Standard bounce house"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`kind-${row.id ?? "new"}`}>Type</Label>
            <select
              id={`kind-${row.id ?? "new"}`}
              className={selectClass}
              value={row.pricingKind}
              onChange={(event) =>
                update("pricingKind", event.target.value === "duration" ? "duration" : "fixed")
              }
            >
              <option value="fixed">Flat per event</option>
              <option value="duration">Tiered by hours</option>
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor={`price-${row.id ?? "new"}`}>
              {tiered ? `Base price (${currency})` : `Price per event (${currency})`}
            </Label>
            <Input
              id={`price-${row.id ?? "new"}`}
              type="number"
              min={0}
              step="0.01"
              value={row.price}
              onChange={(event) => update("price", Number(event.target.value))}
            />
          </div>
          {tiered ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={`base-${row.id ?? "new"}`}>Base covers (hours)</Label>
                <Input
                  id={`base-${row.id ?? "new"}`}
                  type="number"
                  min={0.5}
                  step="0.5"
                  value={hours(row.basePeriodMinutes)}
                  onChange={(event) =>
                    update("basePeriodMinutes", Math.round(Number(event.target.value) * 60))
                  }
                />
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <Checkbox
                  checked={row.enforceStrictTiers}
                  onCheckedChange={(checked) => update("enforceStrictTiers", checked === true)}
                />
                Round up to the next tier
              </label>
            </>
          ) : null}
        </div>

        {tiered ? (
          <div className="space-y-2">
            <Label>Longer events</Label>
            {row.tiers.map((tier, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  aria-label="Hours"
                  type="number"
                  min={0.5}
                  step="0.5"
                  className="w-28"
                  value={hours(tier.period)}
                  onChange={(event) => {
                    const tiers = [...row.tiers];
                    tiers[index] = { ...tier, period: Math.round(Number(event.target.value) * 60) };
                    update("tiers", tiers);
                  }}
                />
                <span className="text-sm text-muted-foreground">hours for</span>
                <Input
                  aria-label="Price"
                  type="number"
                  min={0}
                  step="0.01"
                  className="w-32"
                  value={tier.price}
                  onChange={(event) => {
                    const tiers = [...row.tiers];
                    tiers[index] = { ...tier, price: Number(event.target.value) };
                    update("tiers", tiers);
                  }}
                />
                <span className="text-sm text-muted-foreground">{currency}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => update("tiers", row.tiers.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const last = row.tiers.at(-1)?.period ?? row.basePeriodMinutes ?? 240;
                update("tiers", [...row.tiers, { period: last + 120, price: row.price }]);
              }}
            >
              Add tier
            </Button>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label>Items using this price</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {products.map((product) => (
              <label key={product.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={row.productIds.includes(product.id)}
                  onCheckedChange={(checked) =>
                    update(
                      "productIds",
                      checked === true
                        ? [...row.productIds, product.id]
                        : row.productIds.filter((id) => id !== product.id),
                    )
                  }
                />
                {product.name}
              </label>
            ))}
            {products.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items yet.</p>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="destructive" onClick={remove} disabled={isPending}>
            {row.id ? "Delete" : "Cancel"}
          </Button>
          <Button type="button" onClick={save} disabled={isPending || !row.name.trim()}>
            Save shared price
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PriceTemplatesForm({
  templates,
  products,
  currency,
}: {
  templates: PriceTemplateRow[];
  products: ProductOption[];
  currency: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);

  function done() {
    setAdding(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {templates.map((template) => (
        <TemplateEditor
          key={`${template.id}-${template.productIds.join(",")}-${template.price}`}
          initial={template}
          products={products}
          currency={currency}
          onDone={done}
        />
      ))}
      {adding ? (
        <TemplateEditor initial={NEW_TEMPLATE} products={products} currency={currency} onDone={done} />
      ) : (
        <Button type="button" variant="outline" onClick={() => setAdding(true)}>
          New shared price
        </Button>
      )}
    </div>
  );
}
