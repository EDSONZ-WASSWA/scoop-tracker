import type { Document, ObjectId, WithId } from "mongodb";
import type { Flavor } from "../../shared/types.js";
import { collections } from "../db.js";
import { HttpError, isDuplicateKeyError } from "../errors.js";
import { parseFlavorInput, parseStartingStock, type OptionalFlavorField } from "../flavorValidation.js";
import type { FlavorDoc } from "../models.js";
import { calculateStatus } from "../status.js";
import { findFlavorOrThrow } from "./stockService.js";

type FlavorWithPending = WithId<FlavorDoc> & { refillPending: boolean };

// Status is computed on every read and never stored, so it cannot get out of
// sync with the stock number.
export type FlavorResponse = WithId<FlavorDoc> & Pick<Flavor, "status" | "refillPending">;

export function toFlavorResponse(flavor: WithId<FlavorDoc>, refillPending = false): FlavorResponse {
  return { ...flavor, status: calculateStatus(flavor.stockScoops, flavor.lowThreshold), refillPending };
}

function queryText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildFlavorFilter(query: Record<string, unknown>): Document {
  const filter: Document = {};
  if (queryText(query.includeInactive) !== "true") filter.isActive = true;

  const search = queryText(query.q);
  if (search) filter.name = { $regex: escapeRegex(search), $options: "i" };

  const allergen = queryText(query.excludeAllergen);
  if (allergen) filter.allergens = { $ne: allergen };

  const dietary = queryText(query.dietary);
  if (dietary) filter.dietary = dietary;

  // $expr compares two fields of the same document, because every flavor has
  // its own low threshold.
  if (queryText(query.lowOnly) === "true") filter.$expr = { $lte: ["$stockScoops", "$lowThreshold"] };
  return filter;
}

export async function listFlavors(query: Record<string, unknown>): Promise<FlavorResponse[]> {
  const pipeline: Document[] = [
    { $match: buildFlavorFilter(query) },
    {
      $lookup: {
        from: "restock_requests",
        localField: "_id",
        foreignField: "flavorId",
        pipeline: [{ $match: { status: "pending" } }, { $project: { _id: 1 } }],
        as: "pendingRequests",
      },
    },
    { $addFields: { refillPending: { $gt: [{ $size: "$pendingRequests" }, 0] } } },
    { $project: { pendingRequests: 0 } },
    { $sort: { name: 1 } },
  ];
  const flavors = await collections.flavors().aggregate<FlavorWithPending>(pipeline).toArray();
  return flavors.map((flavor) => toFlavorResponse(flavor, flavor.refillPending));
}

async function saveWithUniqueName<T>(name: string, save: () => Promise<T>): Promise<T> {
  try {
    return await save();
  } catch (error) {
    if (isDuplicateKeyError(error)) throw new HttpError(409, `A flavor called ${name} already exists`);
    throw error;
  }
}

export async function createFlavor(input: unknown): Promise<FlavorResponse> {
  const { changes } = parseFlavorInput(input);
  const now = new Date();
  const flavor: FlavorDoc = {
    ...changes,
    stockScoops: parseStartingStock(input, changes.capacityScoops),
    createdAt: now,
    updatedAt: now,
  };
  const result = await saveWithUniqueName(flavor.name, () => collections.flavors().insertOne(flavor));
  return toFlavorResponse({ ...flavor, _id: result.insertedId });
}

function unsetDocument(fields: OptionalFlavorField[]): Partial<Record<OptionalFlavorField, "">> {
  return Object.fromEntries(fields.map((field) => [field, ""]));
}

export async function updateFlavor(flavorId: ObjectId, input: unknown): Promise<FlavorResponse> {
  const { changes, emptyFields } = parseFlavorInput(input);
  const current = await findFlavorOrThrow(flavorId);
  if (changes.capacityScoops < current.stockScoops) {
    throw new HttpError(400, `Capacity cannot be below the current stock of ${current.stockScoops} scoops`);
  }

  const updated = await saveWithUniqueName(changes.name, () =>
    collections
      .flavors()
      .findOneAndUpdate(
        { _id: flavorId },
        { $set: { ...changes, updatedAt: new Date() }, $unset: unsetDocument(emptyFields) },
        { returnDocument: "after" },
      ),
  );
  if (!updated) throw new HttpError(404, "Flavor not found");
  return toFlavorResponse(updated);
}

export async function deactivateFlavor(flavorId: ObjectId): Promise<FlavorResponse> {
  const updated = await collections
    .flavors()
    .findOneAndUpdate({ _id: flavorId }, { $set: { isActive: false, updatedAt: new Date() } }, { returnDocument: "after" });
  if (!updated) throw new HttpError(404, "Flavor not found");
  return toFlavorResponse(updated);
}
