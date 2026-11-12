import type { Filter, ObjectId, WithId } from "mongodb";
import type { RequestStatus } from "../../shared/types.js";
import { collections } from "../db.js";
import { HttpError, isDuplicateKeyError } from "../errors.js";
import type { RestockRequestDoc } from "../models.js";
import { asBody, optionalString, personName, toObjectId } from "../validate.js";
import { fillToCapacity, findFlavorOrThrow } from "./stockService.js";

const REQUEST_STATUSES: readonly RequestStatus[] = ["pending", "fulfilled", "rejected"];
const MAX_NOTE_LENGTH = 200;
const HISTORY_LIMIT = 50;

export async function createRequest(input: unknown): Promise<WithId<RestockRequestDoc>> {
  const body = asBody(input);
  const flavor = await findFlavorOrThrow(toObjectId(body.flavorId, "flavorId"));
  const request: RestockRequestDoc = {
    flavorId: flavor._id,
    flavorName: flavor.name,
    requestedBy: personName(body, "requestedBy", "Seller"),
    requestedAt: new Date(),
    stockAtRequest: flavor.stockScoops,
    quantityRequested: flavor.capacityScoops - flavor.stockScoops,
    note: optionalString(body, "note", MAX_NOTE_LENGTH) ?? "",
    priority: flavor.stockScoops === 0 ? "urgent" : "normal",
    status: "pending",
  };

  try {
    const { insertedId } = await collections.requests().insertOne(request);
    return { ...request, _id: insertedId };
  } catch (error) {
    // The partial unique index on pending requests rejects a second one.
    if (isDuplicateKeyError(error)) throw new HttpError(409, `A refill for ${flavor.name} is already requested`);
    throw error;
  }
}

function parseStatuses(value: unknown): RequestStatus[] {
  if (typeof value !== "string" || value === "") return ["pending"];
  return value.split(",").map((part) => {
    const status = REQUEST_STATUSES.find((option) => option === part.trim());
    if (!status) throw new HttpError(400, `status must be one of: ${REQUEST_STATUSES.join(", ")}`);
    return status;
  });
}

export async function listRequests(statusQuery: unknown): Promise<WithId<RestockRequestDoc>[]> {
  const statuses = parseStatuses(statusQuery);
  const filter: Filter<RestockRequestDoc> = { status: { $in: statuses } };

  if (statuses.length === 1 && statuses[0] === "pending") {
    // "urgent" sorts after "normal" alphabetically, so descending puts urgent first.
    return collections.requests().find(filter).sort({ priority: -1, requestedAt: 1 }).toArray();
  }
  return collections.requests().find(filter).sort({ requestedAt: -1 }).limit(HISTORY_LIMIT).toArray();
}

// Marking the request as handled first, with status "pending" in the filter,
// means two managers clicking at once cannot both fill the same request.
async function closePendingRequest(
  requestId: ObjectId,
  status: Exclude<RequestStatus, "pending">,
  handledBy: string,
): Promise<WithId<RestockRequestDoc>> {
  const closed = await collections
    .requests()
    .findOneAndUpdate(
      { _id: requestId, status: "pending" },
      { $set: { status, handledBy, handledAt: new Date() } },
      { returnDocument: "after" },
    );
  if (closed) return closed;

  const existing = await collections.requests().findOne({ _id: requestId });
  if (!existing) throw new HttpError(404, "Refill request not found");
  throw new HttpError(409, `This request was already ${existing.status}`);
}

export async function fulfilRequest(requestId: ObjectId, input: unknown): Promise<WithId<RestockRequestDoc>> {
  const handledBy = personName(asBody(input ?? {}), "handledBy", "Stock manager");
  const request = await closePendingRequest(requestId, "fulfilled", handledBy);
  await fillToCapacity(request.flavorId, handledBy);
  return request;
}

export async function rejectRequest(requestId: ObjectId, input: unknown): Promise<WithId<RestockRequestDoc>> {
  const handledBy = personName(asBody(input ?? {}), "handledBy", "Stock manager");
  return closePendingRequest(requestId, "rejected", handledBy);
}
