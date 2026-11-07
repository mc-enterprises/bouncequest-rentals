#!/usr/bin/env node
// BounceQuest Phase 1 seed: store settings, 5 categories, 9 SAMPLE items on shared
// price templates (flat + tiered by hours), checkout questions (surface, venue type)
// and the rental agreement / safety waiver. Idempotent: re-running updates in place.
//
// Usage (inside the compose network):  DATABASE_URL=mysql://... node seed.mjs [--wait]
//   --wait  poll every 30 s until the first admin account exists (Q registers at /register),
//           then seed and exit. Without --wait it exits 3 when no account exists yet.
//
// Item names, quantities and prices are SAMPLE values for Q to edit in the dashboard
// (Settings > Shared prices, Products). No real BounceQuest inventory was available.

import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";

const DIRECT_STRIPE_ACCOUNT_ID = "acct_bouncequest_direct";
const STORE_SLUG = process.env.BQ_STORE_SLUG || "bouncequest";
const WAIT = process.argv.includes("--wait");
// Re-runs keep Q's dashboard edits; --force re-applies every BounceQuest default.
const FORCE = process.argv.includes("--force");

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";
const nanoid = (size = 21) =>
  Array.from(randomBytes(size), (byte) => ALPHABET[byte & 63]).join("");
const slugify = (value) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
const hours = (h) => Math.round(h * 60);

const CATEGORIES = ["Bounce Houses", "Water Rides", "Slides & Combos", "Generator", "Concessions"];

// Shared prices. Tiered templates: base price covers basePeriod; tiers are { hours, price }.
const TEMPLATES = [
  {
    key: "bounce",
    name: "Standard bounce house (by hours)",
    kind: "duration",
    price: 150,
    baseHours: 4,
    tiers: [
      { hours: 6, price: 175 },
      { hours: 8, price: 195 },
      { hours: 12, price: 225 },
    ],
  },
  {
    key: "water",
    name: "Water slide (by hours)",
    kind: "duration",
    price: 275,
    baseHours: 4,
    tiers: [
      { hours: 6, price: 300 },
      { hours: 8, price: 325 },
    ],
  },
  {
    key: "combo",
    name: "Combo with slide (by hours)",
    kind: "duration",
    price: 225,
    baseHours: 4,
    tiers: [
      { hours: 6, price: 250 },
      { hours: 8, price: 275 },
    ],
  },
  { key: "obstacle", name: "Obstacle course (flat per event)", kind: "fixed", price: 350 },
  { key: "generator", name: "Generator (flat per event)", kind: "fixed", price: 75 },
  { key: "concession", name: "Concession machine (flat per event)", kind: "fixed", price: 65 },
];

const ITEMS = [
  {
    name: "Classic Castle Bounce House",
    category: "Bounce Houses",
    template: "bounce",
    quantity: 1,
    description:
      "13 x 13 ft castle bouncer. Needs a 15 x 15 ft flat area and one outlet within 50 ft. Ages 3-12, up to 8 kids at a time.",
  },
  {
    name: "Princess Palace Bounce House",
    category: "Bounce Houses",
    template: "bounce",
    quantity: 1,
    description: "13 x 13 ft pink and purple bouncer with an inside basketball hoop. Space: 15 x 15 ft.",
  },
  {
    name: "Sports Arena Bounce House",
    category: "Bounce Houses",
    template: "bounce",
    quantity: 1,
    description: "15 x 15 ft sports bouncer with hoop and soccer goal. Space: 17 x 17 ft.",
  },
  {
    name: "Tropical Water Slide (18 ft)",
    category: "Water Rides",
    template: "water",
    quantity: 1,
    description: "18 ft tall wet slide with splash pool. Needs a garden hose within 50 ft. Space: 15 x 35 ft.",
  },
  {
    name: "Splash Zone Wet/Dry Combo",
    category: "Water Rides",
    template: "water",
    quantity: 1,
    description: "Bounce area, climbing wall and slide into a splash pool. Use wet or dry. Space: 20 x 30 ft.",
  },
  {
    name: "Jungle Combo with Slide",
    category: "Slides & Combos",
    template: "combo",
    quantity: 1,
    description: "Bounce, climb and slide combo. Dry use only. Space: 20 x 25 ft.",
  },
  {
    name: "Mega Obstacle Course (40 ft)",
    category: "Slides & Combos",
    template: "obstacle",
    quantity: 1,
    description: "Two-lane race course with pop-ups, tunnel and slide finish. Space: 12 x 45 ft.",
  },
  {
    name: "Quiet Generator (7,500 W)",
    category: "Generator",
    template: "generator",
    quantity: 2,
    description: "Runs one inflatable or two concession machines when no outlet is within 50 ft.",
  },
  {
    name: "Popcorn Machine",
    category: "Concessions",
    template: "concession",
    quantity: 2,
    description: "8 oz kettle on a cart. Includes supplies for 50 servings.",
  },
];

const CHECKOUT_FIELDS = [
  {
    key: "event_surface",
    label: "Setup surface",
    options: ["Grass", "Concrete", "Asphalt", "Artificial turf", "Dirt", "Indoor (gym or hall)"],
    help: "Where the inflatable will sit. We stake into grass and use sandbags on hard surfaces.",
  },
  {
    key: "venue_type",
    label: "Venue type",
    options: ["Residential / backyard", "Park", "School", "Church", "Business", "Apartment complex", "Other"],
    help: "Parks and schools may need a permit; tell us in the notes if you have one.",
  },
];

const AGREEMENT = `BOUNCEQUEST RENTAL AGREEMENT AND SAFETY WAIVER (SAMPLE TEXT - REVIEW BEFORE USE)

1. Rental period. The rental runs from delivery to pickup at the times shown on this agreement. BounceQuest sets up and takes down every unit.
2. Deposit and balance. A deposit of the percentage shown at checkout is paid online to reserve the date. The balance is due on the event day before setup.
3. Weather. Inflatables cannot be used in winds above 15 mph, rain or lightning. If weather forces a cancellation before setup, the deposit moves to a new date.
4. Supervision. A responsible adult (18+) must supervise the unit at all times. Follow the posted rules: no shoes, no sharp objects, no food or drink, no flips, keep riders of similar size together and within the posted capacity.
5. Power and water. The customer provides a working outlet within 50 ft of the unit (or rents a generator) and, for water rides, a hose connection.
6. Damage. The customer is responsible for damage beyond normal wear, including cuts, burns, stains and damage from silly string, paint or pets.
7. Assumption of risk and release. The customer understands that inflatable play involves a risk of injury. To the fullest extent allowed by law, the customer releases BounceQuest, its owners and staff from claims arising from the use of the equipment, except claims caused by BounceQuest's gross negligence, and agrees to inform every participant's guardian of these rules.
8. Electronic signature. Typing your full name at checkout signs this agreement. The name, date, time and IP address are recorded with the signed copy, which is e-mailed to you.`;

const BUSINESS_HOURS = {
  enabled: true,
  schedule: Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((day) => [
      day,
      { isOpen: true, ranges: [{ openTime: "07:00", closeTime: "22:00" }] },
    ]),
  ),
  closurePeriods: [],
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const conn = await mysql.createConnection({ uri: url, multipleStatements: false });

  let owner = null;
  for (;;) {
    const [rows] = await conn.query("SELECT id, email FROM users ORDER BY created_at ASC LIMIT 1");
    owner = rows[0] ?? null;
    if (owner || !WAIT) break;
    console.log("[seed] waiting for the first admin account (register at /register) ...");
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  if (!owner) {
    console.log("[seed] no admin account yet: register at /register, then run the seed again.");
    await conn.end();
    process.exit(3);
  }

  const now = new Date();
  await conn.beginTransaction();
  try {
    // ---- store ----
    let [stores] = await conn.query(
      "SELECT id, settings FROM stores ORDER BY onboarding_completed DESC, created_at ASC LIMIT 1",
    );
    let storeId = stores[0]?.id;
    const previous = stores[0]?.settings
      ? typeof stores[0].settings === "string"
        ? JSON.parse(stores[0].settings)
        : stores[0].settings
      : {};
    const firstRun = FORCE || !previous.bouncequestSeededAt;
    const defaults = {
      reservationMode: "payment",
      pendingBlocksAvailability: true,
      onlinePaymentDepositPercentage: Number(process.env.BQ_DEPOSIT_PERCENT || 25),
      minRentalMinutes: hours(4),
      maxRentalMinutes: hours(24),
      advanceNoticeMinutes: hours(48),
      maxAdvanceDays: 365,
      // Setup before delivery and teardown after pickup: inventory is held across it.
      turnoverBufferMinutes: 90,
      requireCustomerAddress: true,
      contractSignatureMode: "required",
      currency: "USD",
      country: "US",
      timezone: "America/Chicago",
      locale: "en",
      businessHours: BUSINESS_HOURS,
      tax: {
        enabled: true,
        defaultRate: 7.5,
        displayMode: "exclusive",
        taxLabel: "Sales tax",
      },
      delivery: {
        enabled: true,
        mode: "required",
        distanceUnit: "mi",
        pricePerKm: 2, // per mile, each way
        minimumFee: 20, // per leg (delivery and pickup)
        maximumDistance: 50, // miles from the warehouse
        freeDeliveryThreshold: null,
        minimumOrderAmountForDelivery: null,
      },
    };
    const settings = firstRun
      ? { ...previous, ...defaults, bouncequestSeededAt: now.toISOString() }
      : { ...defaults, ...previous };
    const update = (found) => !found || firstRun;
    const theme = { mode: "light", primaryColor: "#2563EB", catalogBrowseMode: "categories" };
    const stripeReady = Boolean(process.env.STRIPE_SECRET_KEY);

    if (!storeId) {
      storeId = nanoid();
      await conn.query(
        `INSERT INTO stores (id, user_id, name, slug, description, email, phone, address, latitude, longitude,
           tagline, settings, theme, cgv, include_cgv_in_contract, stripe_account_id, stripe_onboarding_complete,
           stripe_charges_enabled, onboarding_completed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 1, ?, ?)`,
        [
          storeId,
          owner.id,
          "BounceQuest Rentals",
          STORE_SLUG,
          "Bounce houses, water slides, combos and concessions delivered and set up for your party.",
          process.env.BQ_STORE_EMAIL || owner.email,
          process.env.BQ_STORE_PHONE || null,
          process.env.BQ_WAREHOUSE_ADDRESS || "Wichita, KS",
          process.env.BQ_WAREHOUSE_LAT || "37.6871761",
          process.env.BQ_WAREHOUSE_LNG || "-97.3300504",
          "Party rentals delivered, set up and picked up",
          JSON.stringify(settings),
          JSON.stringify(theme),
          AGREEMENT,
          stripeReady ? DIRECT_STRIPE_ACCOUNT_ID : null,
          stripeReady ? 1 : 0,
          stripeReady ? 1 : 0,
          now,
          now,
        ],
      );
      console.log(`[seed] created store ${storeId}`);
    } else {
      await conn.query(
        `UPDATE stores SET settings = ?, cgv = COALESCE(cgv, ?), include_cgv_in_contract = 1,
           onboarding_completed = 1, updated_at = ?,
           stripe_account_id = IF(?, ?, stripe_account_id),
           stripe_onboarding_complete = IF(?, 1, stripe_onboarding_complete),
           stripe_charges_enabled = IF(?, 1, stripe_charges_enabled)
         WHERE id = ?`,
        [
          JSON.stringify(settings),
          AGREEMENT,
          now,
          stripeReady,
          DIRECT_STRIPE_ACCOUNT_ID,
          stripeReady,
          stripeReady,
          storeId,
        ],
      );
      console.log(`[seed] updated store ${storeId}`);
    }

    // ---- owner membership ----
    const [members] = await conn.query(
      "SELECT id FROM store_members WHERE store_id = ? AND user_id = ?",
      [storeId, owner.id],
    );
    if (members.length === 0) {
      await conn.query(
        "INSERT INTO store_members (id, store_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, 'owner', ?, ?)",
        [nanoid(), storeId, owner.id, now, now],
      );
    }

    // ---- categories ----
    const categoryIds = {};
    for (const [index, name] of CATEGORIES.entries()) {
      const [found] = await conn.query("SELECT id FROM categories WHERE store_id = ? AND name = ?", [
        storeId,
        name,
      ]);
      if (found[0]) {
        categoryIds[name] = found[0].id;
        await conn.query("UPDATE categories SET `order` = ?, updated_at = ? WHERE id = ?", [
          index,
          now,
          found[0].id,
        ]);
      } else {
        categoryIds[name] = nanoid();
        await conn.query(
          "INSERT INTO categories (id, store_id, name, slug, `order`, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [categoryIds[name], storeId, name, slugify(name), index, now, now],
        );
      }
    }

    // ---- shared price templates ----
    const templates = {};
    for (const template of TEMPLATES) {
      const fixed = template.kind === "fixed";
      const tiers = fixed ? [] : template.tiers.map((t) => ({ period: hours(t.hours), price: t.price }));
      const row = {
        pricing_kind: template.kind,
        pricing_mode: "hour",
        price: template.price.toFixed(2),
        base_period_minutes: fixed ? null : hours(template.baseHours),
        enforce_strict_tiers: fixed ? 0 : 1,
        tiers: JSON.stringify(tiers),
      };
      const [found] = await conn.query("SELECT id FROM price_templates WHERE store_id = ? AND name = ?", [
        storeId,
        template.name,
      ]);
      const id = found[0]?.id ?? nanoid();
      if (found[0] && !update(found[0])) {
        // keep Q's edits
      } else if (found[0]) {
        await conn.query(
          `UPDATE price_templates SET pricing_kind=?, pricing_mode=?, price=?, base_period_minutes=?,
             enforce_strict_tiers=?, tiers=?, updated_at=? WHERE id=?`,
          [...Object.values(row), now, id],
        );
      } else {
        await conn.query(
          `INSERT INTO price_templates (id, store_id, name, pricing_kind, pricing_mode, price, base_period_minutes,
             enforce_strict_tiers, tiers, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, storeId, template.name, ...Object.values(row), now, now],
        );
      }
      templates[template.key] = { id, fixed, tiers, row };
    }

    // ---- items ----
    for (const [index, item] of ITEMS.entries()) {
      const template = templates[item.template];
      const categoryId = categoryIds[item.category];
      const [found] = await conn.query("SELECT id FROM products WHERE store_id = ? AND name = ?", [
        storeId,
        item.name,
      ]);
      const productId = found[0]?.id ?? nanoid();
      if (found[0] && !update(found[0])) continue;
      const values = [
        categoryId,
        item.description,
        template.row.price,
        template.row.base_period_minutes,
        template.row.pricing_mode,
        template.row.pricing_kind,
        template.row.enforce_strict_tiers,
        template.id,
        item.quantity,
        index,
      ];
      if (found[0]) {
        await conn.query(
          `UPDATE products SET category_id=?, description=?, price=?, base_period_minutes=?, pricing_mode=?,
             pricing_kind=?, enforce_strict_tiers=?, price_template_id=?, quantity=?, display_order=?,
             status='active', updated_at=? WHERE id=?`,
          [...values, now, productId],
        );
      } else {
        await conn.query(
          `INSERT INTO products (id, store_id, category_id, name, slug, description, images, image_history, price,
             deposit, base_period_minutes, pricing_mode, pricing_kind, stock_kind, enforce_strict_tiers,
             price_template_id, quantity, track_units, display_order, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', ?, '0', ?, ?, ?, 'returnable', ?, ?, ?, 0, ?, 'active', ?, ?)`,
          [productId, storeId, categoryId, item.name, slugify(item.name), item.description, template.row.price,
            template.row.base_period_minutes, template.row.pricing_mode, template.row.pricing_kind,
            template.row.enforce_strict_tiers, template.id, item.quantity, index, now, now],
        );
      }
      await conn.query("DELETE FROM product_categories WHERE product_id = ?", [productId]);
      await conn.query(
        "INSERT INTO product_categories (id, product_id, category_id, position, created_at) VALUES (?, ?, ?, 0, ?)",
        [nanoid(), productId, categoryId, now],
      );
      await conn.query("DELETE FROM product_pricing_tiers WHERE product_id = ?", [productId]);
      for (const [tierIndex, tier] of template.tiers.entries()) {
        await conn.query(
          `INSERT INTO product_pricing_tiers (id, product_id, period, price, display_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [nanoid(), productId, tier.period, tier.price.toFixed(2), tierIndex, now, now],
        );
      }
    }

    // ---- checkout questions ----
    for (const [index, field] of CHECKOUT_FIELDS.entries()) {
      const [found] = await conn.query(
        "SELECT id FROM customer_field_definitions WHERE store_id = ? AND `key` = ?",
        [storeId, field.key],
      );
      if (found[0] && !update(found[0])) continue;
      if (found[0]) {
        await conn.query(
          "UPDATE customer_field_definitions SET label=?, options=?, help_text=?, is_active=1, updated_at=? WHERE id=?",
          [field.label, JSON.stringify(field.options), field.help, now, found[0].id],
        );
      } else {
        await conn.query(
          `INSERT INTO customer_field_definitions (id, store_id, \`key\`, label, field_type, options, help_text,
             section, position, width, applies_to, is_required, is_sensitive, show_on_contract, is_searchable,
             show_in_list, is_active, scope, collect_mode, target_mode, customer_editable, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'select', ?, ?, 'Event details', ?, 'half', 'all', 1, 0, 1, 1, 1, 1, 'customer',
             'required', 'all', 0, ?, ?)`,
          [nanoid(), storeId, field.key, field.label, JSON.stringify(field.options), field.help, 100 + index, now, now],
        );
      }
    }

    await conn.commit();
    console.log(
      `[seed] done: store=${storeId} owner=${owner.id} categories=${CATEGORIES.length} items=${ITEMS.length} templates=${TEMPLATES.length} stripe=${stripeReady ? "direct" : "off"}`,
    );
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error("[seed] failed:", error);
  process.exit(1);
});
