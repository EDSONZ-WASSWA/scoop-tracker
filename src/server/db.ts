import { MongoClient, type Db } from "mongodb";
import type { Settings } from "../shared/types.js";
import type { CounterDoc, FlavorDoc, RestockRequestDoc, SaleDoc, StockLogDoc } from "./models.js";

const DEFAULT_URI = "mongodb://127.0.0.1:27017";
const DEFAULT_DB_NAME = "scoop_tracker";

let client: MongoClient | null = null;
let database: Db | null = null;

export async function connectToDatabase(): Promise<Db> {
  if (database) return database;
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  // ignoreUndefined skips optional fields that are not set, instead of saving
  // them as null, so documents only contain the fields they really have.
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, ignoreUndefined: true });
  await client.connect();
  database = client.db(process.env.DB_NAME ?? DEFAULT_DB_NAME);
  return database;
}

export async function closeDatabase(): Promise<void> {
  await client?.close();
  client = null;
  database = null;
}

function getDb(): Db {
  if (!database) throw new Error("Database is not connected yet");
  return database;
}

export const collections = {
  settings: () => getDb().collection<Settings>("settings"),
  flavors: () => getDb().collection<FlavorDoc>("flavors"),
  sales: () => getDb().collection<SaleDoc>("sales"),
  requests: () => getDb().collection<RestockRequestDoc>("restock_requests"),
  stockLogs: () => getDb().collection<StockLogDoc>("stock_logs"),
  counters: () => getDb().collection<CounterDoc>("counters"),
};

export async function ensureIndexes(): Promise<void> {
  await Promise.all([
    // Flavor names must be unique so the seller never sees two "Mango" cards.
    collections.flavors().createIndex({ name: 1 }, { unique: true }),
    // Supports the "only low flavors" filter and range queries on stock.
    collections.flavors().createIndex({ stockScoops: 1 }),
    // The manager inbox always filters by status and sorts by newest first,
    // so one compound index serves both the match and the sort.
    collections.requests().createIndex({ status: 1, requestedAt: -1 }),
    // Only one pending request per flavor. A partial unique index lets the
    // database enforce this even when two sellers click at the same moment.
    collections.requests().createIndex(
      { flavorId: 1 },
      { unique: true, partialFilterExpression: { status: "pending" }, name: "one_pending_per_flavor" },
    ),
    // Daily totals and reports filter sales by date.
    collections.sales().createIndex({ soldAt: 1 }),
    // items is an array, so this becomes a multikey index: one entry per
    // flavor inside each serving, which makes "sales containing Mango" fast.
    collections.sales().createIndex({ "items.flavorId": 1 }),
    // The audit trail is read per flavor, newest first.
    collections.stockLogs().createIndex({ flavorId: 1, at: -1 }),
  ]);
}
