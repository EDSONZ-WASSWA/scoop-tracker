import { ObjectId, type WithId } from "mongodb";
import type { QueryInfo, Settings } from "../../shared/types.js";
import { collections } from "../db.js";
import { startOfToday } from "../dates.js";
import { HttpError } from "../errors.js";
import type { FlavorDoc, SaleDoc, StockLogDoc } from "../models.js";
import { oid } from "../queryInfo.js";
import { asBody, personName, toObjectId } from "../validate.js";
import { getSettings, roundMoney } from "./settingsService.js";
import { writeStockLogs } from "./stockService.js";

const LATEST_SALES_LIMIT = 10;
const DEFAULT_SELLER = "Seller";

interface ServingLine {
  flavor: WithId<FlavorDoc>;
  scoops: number;
}

interface ParsedServing {
  scoopsByFlavor: Map<string, number>;
  soldBy: string;
}

function parseScoops(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new HttpError(400, "Every scoops value must be a positive whole number");
  }
  return value;
}

// The browser already blocks wrong servings, but the server checks everything
// again because any client could send any request.
export function parseServing(input: unknown, settings: Settings): ParsedServing {
  const body = asBody(input);
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new HttpError(400, "items must be a non-empty list of { flavorId, scoops }");
  }

  const scoopsByFlavor = new Map<string, number>();
  for (const rawItem of body.items) {
    const item = asBody(rawItem, "Each item");
    const flavorId = toObjectId(item.flavorId, "flavorId").toHexString();
    scoopsByFlavor.set(flavorId, (scoopsByFlavor.get(flavorId) ?? 0) + parseScoops(item.scoops));
  }

  const totalScoops = [...scoopsByFlavor.values()].reduce((sum, scoops) => sum + scoops, 0);
  if (totalScoops !== settings.scoopsPerSale) {
    throw new HttpError(
      400,
      `A serving must be exactly ${settings.scoopsPerSale} scoops, you sent ${totalScoops}`,
    );
  }
  return { scoopsByFlavor, soldBy: personName(body, "soldBy", DEFAULT_SELLER) };
}

async function loadServingLines(scoopsByFlavor: Map<string, number>): Promise<ServingLine[]> {
  const ids = [...scoopsByFlavor.keys()].map((id) => new ObjectId(id));
  const flavors = await collections.flavors().find({ _id: { $in: ids } }).toArray();

  return ids.map((id) => {
    const flavor = flavors.find((candidate) => candidate._id.equals(id));
    if (!flavor) throw new HttpError(400, `Flavor ${id.toHexString()} does not exist`);
    if (!flavor.isActive) throw new HttpError(400, `${flavor.name} is not on sale right now`);
    return { flavor, scoops: scoopsByFlavor.get(id.toHexString()) ?? 0 };
  });
}

function deductionQuery(line: ServingLine, now: Date): QueryInfo {
  return {
    collection: "flavors",
    operation: "updateOne",
    filter: { _id: oid(line.flavor._id), stockScoops: { $gte: line.scoops } },
    update: { $inc: { stockScoops: -line.scoops }, $set: { updatedAt: now } },
  };
}

// The filter only matches while enough scoops are left, and $inc changes the
// number inside the database in one step. Two sellers can never both take the
// last scoop: the second update simply matches nothing.
async function deductStock(line: ServingLine, now: Date): Promise<boolean> {
  const result = await collections
    .flavors()
    .updateOne(
      { _id: line.flavor._id, stockScoops: { $gte: line.scoops } },
      { $inc: { stockScoops: -line.scoops }, $set: { updatedAt: now } },
    );
  return result.matchedCount === 1;
}

async function rollbackDeductions(deducted: ServingLine[], by: string): Promise<void> {
  const logs: StockLogDoc[] = [];
  for (const line of deducted) {
    const restored = await collections
      .flavors()
      .findOneAndUpdate(
        { _id: line.flavor._id },
        { $inc: { stockScoops: line.scoops }, $set: { updatedAt: new Date() } },
        { returnDocument: "after" },
      );
    logs.push({
      flavorId: line.flavor._id,
      flavorName: line.flavor.name,
      type: "rollback",
      change: line.scoops,
      balanceAfter: restored?.stockScoops ?? 0,
      at: new Date(),
      by,
    });
  }
  await writeStockLogs(logs);
}

async function notEnoughStockError(line: ServingLine): Promise<HttpError> {
  const current = await collections.flavors().findOne({ _id: line.flavor._id });
  const left = current?.stockScoops ?? 0;
  if (left === 0) return new HttpError(409, `${line.flavor.name} is sold out`);
  return new HttpError(409, `Only ${left} scoop${left === 1 ? "" : "s"} of ${line.flavor.name} left`);
}

async function nextReceiptNo(): Promise<string> {
  // $inc on a counter document is atomic, so two sales at the same moment
  // still get different receipt numbers.
  const counter = await collections
    .counters()
    .findOneAndUpdate({ _id: "receipt" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return `R-${String(counter?.seq ?? 1).padStart(4, "0")}`;
}

async function balancesAfterSale(lines: ServingLine[]): Promise<Map<string, number>> {
  const ids = lines.map((line) => line.flavor._id);
  const flavors = await collections
    .flavors()
    .find({ _id: { $in: ids } }, { projection: { stockScoops: 1 } })
    .toArray();
  return new Map(flavors.map((flavor) => [flavor._id.toHexString(), flavor.stockScoops]));
}

// A multi-document transaction would also keep this all-or-nothing, but
// transactions need a replica set. A default local MongoDB is a standalone
// server, so we undo the deductions that already happened (compensation)
// when one flavor fails.
async function deductAllOrNothing(lines: ServingLine[], soldBy: string, now: Date): Promise<void> {
  const deducted: ServingLine[] = [];
  for (const line of lines) {
    if (!(await deductStock(line, now))) {
      await rollbackDeductions(deducted, soldBy);
      throw await notEnoughStockError(line);
    }
    deducted.push(line);
  }
}

export async function createSale(input: unknown): Promise<{ sale: WithId<SaleDoc>; queries: QueryInfo[] }> {
  const settings = await getSettings();
  const { scoopsByFlavor, soldBy } = parseServing(input, settings);
  const lines = await loadServingLines(scoopsByFlavor);
  const now = new Date();

  await deductAllOrNothing(lines, soldBy, now);

  const receiptNo = await nextReceiptNo();
  const sale: SaleDoc = {
    receiptNo,
    items: lines.map((line) => ({ flavorId: line.flavor._id, flavorName: line.flavor.name, scoops: line.scoops })),
    totalScoops: settings.scoopsPerSale,
    amount: roundMoney(settings.pricePerSale),
    soldBy,
    soldAt: now,
  };
  const { insertedId } = await collections.sales().insertOne(sale);

  const balances = await balancesAfterSale(lines);
  await writeStockLogs(
    lines.map((line) => ({
      flavorId: line.flavor._id,
      flavorName: line.flavor.name,
      type: "sale",
      change: -line.scoops,
      balanceAfter: balances.get(line.flavor._id.toHexString()) ?? 0,
      receiptNo,
      at: now,
      by: soldBy,
    })),
  );

  const queries: QueryInfo[] = [
    ...lines.map((line) => deductionQuery(line, now)),
    {
      collection: "counters",
      operation: "findOneAndUpdate",
      filter: { _id: "receipt" },
      update: { $inc: { seq: 1 } },
      note: "upsert: true, returnDocument: 'after'",
    },
    {
      collection: "sales",
      operation: "insertOne",
      document: { ...sale, items: sale.items.map((item) => ({ ...item, flavorId: oid(item.flavorId) })) },
    },
    {
      collection: "stock_logs",
      operation: "insertMany",
      note: `${lines.length} documents of type "sale", one per flavor`,
    },
  ];
  return { sale: { ...sale, _id: insertedId }, queries };
}

export async function getTodaySummary(): Promise<{
  servings: number;
  scoops: number;
  money: number;
  latest: WithId<SaleDoc>[];
}> {
  const [totals] = await collections
    .sales()
    .aggregate<{ servings: number; scoops: number; money: number }>([
      { $match: { soldAt: { $gte: startOfToday() } } },
      { $group: { _id: null, servings: { $sum: 1 }, scoops: { $sum: "$totalScoops" }, money: { $sum: "$amount" } } },
      { $project: { _id: 0, servings: 1, scoops: 1, money: 1 } },
    ])
    .toArray();
  const latest = await collections.sales().find().sort({ soldAt: -1 }).limit(LATEST_SALES_LIMIT).toArray();
  return {
    servings: totals?.servings ?? 0,
    scoops: totals?.scoops ?? 0,
    money: roundMoney(totals?.money ?? 0),
    latest,
  };
}
