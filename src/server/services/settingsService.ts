import type { Settings } from "../../shared/types.js";
import { collections } from "../db.js";
import { asBody, requireInteger, requireNumber, requireString } from "../validate.js";

export const DEFAULT_SETTINGS: Settings = { scoopsPerSale: 4, pricePerSale: 1000, currency: "UGX" };

const MAX_SCOOPS_PER_SALE = 12;
const MIN_PRICE_PER_SALE = 1;
const MAX_PRICE_PER_SALE = 1_000_000;
const MAX_CURRENCY_LENGTH = 3;

export async function getSettings(): Promise<Settings> {
  const stored = await collections.settings().findOne({}, { projection: { _id: 0 } });
  return stored ?? DEFAULT_SETTINGS;
}

export function scoopValue(settings: Settings): number {
  return settings.pricePerSale / settings.scoopsPerSale;
}

export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export async function updateSettings(input: unknown): Promise<Settings> {
  const body = asBody(input);
  const settings: Settings = {
    scoopsPerSale: requireInteger(body, "scoopsPerSale", 1, MAX_SCOOPS_PER_SALE),
    pricePerSale: roundMoney(requireNumber(body, "pricePerSale", MIN_PRICE_PER_SALE, MAX_PRICE_PER_SALE)),
    currency: requireString(body, "currency", MAX_CURRENCY_LENGTH),
  };
  await collections.settings().updateOne({}, { $set: settings }, { upsert: true });
  return settings;
}

export async function resetSettings(): Promise<void> {
  await collections.settings().deleteMany({});
  await collections.settings().insertOne({ ...DEFAULT_SETTINGS });
}
