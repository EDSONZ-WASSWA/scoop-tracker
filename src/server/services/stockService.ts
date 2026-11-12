import type { ObjectId, WithId } from "mongodb";
import { collections } from "../db.js";
import { HttpError } from "../errors.js";
import type { FlavorDoc, StockLogDoc } from "../models.js";

export async function writeStockLogs(logs: StockLogDoc[]): Promise<void> {
  if (logs.length > 0) await collections.stockLogs().insertMany(logs);
}

export async function findFlavorOrThrow(flavorId: ObjectId): Promise<WithId<FlavorDoc>> {
  const flavor = await collections.flavors().findOne({ _id: flavorId });
  if (!flavor) throw new HttpError(404, "Flavor not found");
  return flavor;
}

export async function fillToCapacity(flavorId: ObjectId, by: string): Promise<WithId<FlavorDoc>> {
  // An update pipeline copies capacityScoops into stockScoops inside one atomic
  // write, so a sale arriving at the same moment cannot be overwritten.
  const before = await collections
    .flavors()
    .findOneAndUpdate(
      { _id: flavorId },
      [{ $set: { stockScoops: "$capacityScoops", updatedAt: new Date() } }],
      { returnDocument: "before" },
    );
  if (!before) throw new HttpError(404, "Flavor not found");

  await writeStockLogs([
    {
      flavorId,
      flavorName: before.name,
      type: "restock",
      change: before.capacityScoops - before.stockScoops,
      balanceAfter: before.capacityScoops,
      at: new Date(),
      by,
    },
  ]);
  return { ...before, stockScoops: before.capacityScoops };
}

export async function adjustStock(flavorId: ObjectId, newStock: number, by: string): Promise<WithId<FlavorDoc>> {
  const flavor = await findFlavorOrThrow(flavorId);
  if (newStock > flavor.capacityScoops) {
    throw new HttpError(400, `Stock cannot be above the capacity of ${flavor.capacityScoops} scoops`);
  }

  const before = await collections
    .flavors()
    .findOneAndUpdate(
      { _id: flavorId },
      { $set: { stockScoops: newStock, updatedAt: new Date() } },
      { returnDocument: "before" },
    );
  if (!before) throw new HttpError(404, "Flavor not found");

  await writeStockLogs([
    {
      flavorId,
      flavorName: before.name,
      type: "adjustment",
      change: newStock - before.stockScoops,
      balanceAfter: newStock,
      at: new Date(),
      by,
    },
  ]);
  return { ...before, stockScoops: newStock };
}
