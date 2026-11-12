import type { ObjectId } from "mongodb";

// Shows ObjectIds the way MongoDB's Extended JSON does, so the query panel
// looks like what you would type in mongosh.
export function oid(id: ObjectId): { $oid: string } {
  return { $oid: id.toHexString() };
}
