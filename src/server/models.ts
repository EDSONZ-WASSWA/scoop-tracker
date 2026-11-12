import type { ObjectId } from "mongodb";
import type { FlavorFields, RestockRequest, Sale, SaleItem, StockLog } from "../shared/types.js";

// Database documents use ObjectId and Date, while the shared types describe the
// JSON the browser receives. The driver adds _id to documents it reads.

export interface FlavorDoc extends Omit<FlavorFields, "availableUntil"> {
  availableUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaleItemDoc extends Omit<SaleItem, "flavorId"> {
  flavorId: ObjectId;
}

export interface SaleDoc extends Omit<Sale, "_id" | "items" | "soldAt"> {
  items: SaleItemDoc[];
  soldAt: Date;
}

export interface RestockRequestDoc
  extends Omit<RestockRequest, "_id" | "flavorId" | "requestedAt" | "handledAt"> {
  flavorId: ObjectId;
  requestedAt: Date;
  handledAt?: Date;
}

export interface StockLogDoc extends Omit<StockLog, "_id" | "flavorId" | "at"> {
  flavorId: ObjectId;
  at: Date;
}

export interface CounterDoc {
  _id: string;
  seq: number;
}
