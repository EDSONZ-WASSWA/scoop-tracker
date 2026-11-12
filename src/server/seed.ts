import "dotenv/config";
import type { WithId } from "mongodb";
import { closeDatabase, collections, connectToDatabase, ensureIndexes } from "./db.js";
import { startOfDaysAgo } from "./dates.js";
import type { FlavorDoc, RestockRequestDoc, SaleDoc, SaleItemDoc } from "./models.js";
import { resetDemoData } from "./services/demoService.js";
import { DEFAULT_SETTINGS } from "./services/settingsService.js";

const SELLERS = ["Amina", "Brian", "Grace"];
// Sales per day, from six days ago up to today. Adds up to 60 servings.
const SALES_PER_DAY = [7, 9, 8, 10, 8, 9, 9];
const OPEN_HOUR = 10;
const CLOSE_HOUR = 20;
const TODAY_SPREAD_HOURS = 6;
const POPULAR_MIX_SHARE = 0.6;
const MAX_FLAVORS_PER_SERVING = 3;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

// A few mixes come up often so the "popular combinations" report has a story.
const POPULAR_MIXES = [
  ["Vanilla", "Chocolate", "Strawberry"],
  ["Mango", "Passion Fruit", "Coconut"],
  ["Chocolate", "Cookies and Cream"],
  ["Vanilla"],
  ["Mint Choc Chip", "Chocolate"],
  ["Salted Caramel", "Vanilla", "Banana"],
];

// A small seeded random generator, so every seed run creates the same history.
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const random = createRandom(42);

function pick<T>(items: T[]): T {
  return items[Math.floor(random() * items.length)];
}

function pickDistinct<T>(items: T[], count: number): T[] {
  const pool = [...items];
  return Array.from({ length: count }, () => pool.splice(Math.floor(random() * pool.length), 1)[0]);
}

function splitScoops(flavors: WithId<FlavorDoc>[], total: number): SaleItemDoc[] {
  const counts = flavors.map(() => 1);
  for (let extra = flavors.length; extra < total; extra++) counts[Math.floor(random() * counts.length)]++;
  return flavors.map((flavor, index) => ({ flavorId: flavor._id, flavorName: flavor.name, scoops: counts[index] }));
}

function chooseServingFlavors(flavors: WithId<FlavorDoc>[]): WithId<FlavorDoc>[] {
  if (random() < POPULAR_MIX_SHARE) {
    const names = pick(POPULAR_MIXES);
    return flavors.filter((flavor) => names.includes(flavor.name));
  }
  return pickDistinct(flavors, 1 + Math.floor(random() * MAX_FLAVORS_PER_SERVING));
}

// Today's sales must lie in the past, so they are spread over the last few
// hours, starting at opening time when the seed runs during the day.
function todaySaleTime(): Date {
  const now = Date.now();
  const lastHours = now - TODAY_SPREAD_HOURS * MS_PER_HOUR;
  const opening = startOfDaysAgo(0).getTime() + OPEN_HOUR * MS_PER_HOUR;
  const earliest = opening < now ? Math.max(opening, lastHours) : Math.max(startOfDaysAgo(0).getTime(), lastHours);
  return new Date(earliest + random() * (now - MS_PER_MINUTE - earliest));
}

function saleTime(daysAgo: number): Date {
  if (daysAgo === 0) return todaySaleTime();
  const day = startOfDaysAgo(daysAgo).getTime();
  return new Date(day + OPEN_HOUR * MS_PER_HOUR + random() * (CLOSE_HOUR - OPEN_HOUR) * MS_PER_HOUR);
}

function buildPastSales(flavors: WithId<FlavorDoc>[]): SaleDoc[] {
  const sales: Omit<SaleDoc, "receiptNo">[] = [];
  SALES_PER_DAY.forEach((count, index) => {
    const daysAgo = SALES_PER_DAY.length - 1 - index;
    for (let n = 0; n < count; n++) {
      sales.push({
        items: splitScoops(chooseServingFlavors(flavors), DEFAULT_SETTINGS.scoopsPerSale),
        totalScoops: DEFAULT_SETTINGS.scoopsPerSale,
        amount: DEFAULT_SETTINGS.pricePerSale,
        soldBy: pick(SELLERS),
        soldAt: saleTime(daysAgo),
      });
    }
  });
  return sales
    .sort((a, b) => a.soldAt.getTime() - b.soldAt.getTime())
    .map((sale, index) => ({ ...sale, receiptNo: `R-${String(index + 1).padStart(4, "0")}` }));
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MS_PER_MINUTE);
}

function buildRequests(flavors: WithId<FlavorDoc>[]): RestockRequestDoc[] {
  const byName = (name: string): WithId<FlavorDoc> => {
    const flavor = flavors.find((candidate) => candidate.name === name);
    if (!flavor) throw new Error(`Seed flavor ${name} is missing`);
    return flavor;
  };

  const request = (
    name: string,
    requestedMinutesAgo: number,
    stockAtRequest: number,
    extra: Partial<RestockRequestDoc>,
  ): RestockRequestDoc => {
    const flavor = byName(name);
    return {
      flavorId: flavor._id,
      flavorName: flavor.name,
      requestedBy: pick(SELLERS),
      requestedAt: minutesAgo(requestedMinutesAgo),
      stockAtRequest,
      quantityRequested: flavor.capacityScoops - stockAtRequest,
      note: "",
      priority: stockAtRequest === 0 ? "urgent" : "normal",
      status: "pending",
      ...extra,
    };
  };

  const handled = (minutes: number, waitMinutes: number, status: "fulfilled" | "rejected"): Partial<RestockRequestDoc> => ({
    status,
    handledBy: "Stock manager",
    handledAt: minutesAgo(minutes - waitMinutes),
  });

  const day = 24 * 60;
  return [
    request("Mango", 25, 8, {}),
    request("Jackfruit", 50, 0, { note: "Customers keep asking for it" }),
    request("Vanilla", 2 * day, 9, handled(2 * day, 25, "fulfilled")),
    request("Chocolate", day + 120, 11, handled(day + 120, 40, "fulfilled")),
    request("Strawberry", 3 * day, 6, handled(3 * day, 15, "fulfilled")),
    request("Pistachio", 5 * day, 0, handled(5 * day, 55, "fulfilled")),
    request("Coconut", 4 * day, 7, { ...handled(4 * day, 30, "rejected"), note: "Delivery comes on Friday" }),
  ];
}

async function seed(): Promise<void> {
  const db = await connectToDatabase();
  await db.dropDatabase();
  await ensureIndexes();
  await resetDemoData();

  const flavors = await collections.flavors().find().sort({ name: 1 }).toArray();
  const sales = buildPastSales(flavors);
  await collections.sales().insertMany(sales);
  await collections.counters().insertOne({ _id: "receipt", seq: sales.length });
  await collections.requests().insertMany(buildRequests(flavors));

  console.log(`Seeded ${flavors.length} flavors, ${sales.length} sales and the default settings into "${db.databaseName}".`);
}

seed()
  .catch((error: unknown) => {
    console.error("Seeding failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
