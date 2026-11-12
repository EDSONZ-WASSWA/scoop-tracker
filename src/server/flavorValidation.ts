import type { Allergen, Dietary, FlavorCategory } from "../shared/types.js";
import { HttpError } from "./errors.js";
import type { FlavorDoc } from "./models.js";
import {
  asBody,
  optionalBoolean,
  optionalString,
  requireInteger,
  requireOneOf,
  requireString,
  requireSubset,
  type Body,
} from "./validate.js";

const CATEGORIES: readonly FlavorCategory[] = ["fruity", "chocolatey", "creamy", "nutty", "vegan"];
const ALLERGENS: readonly Allergen[] = ["milk", "nuts", "gluten", "eggs"];
const DIETARY: readonly Dietary[] = ["vegan", "dairy-free"];

const MAX_NAME_LENGTH = 40;
const MAX_CAPACITY = 500;
const MAX_NOTES_LENGTH = 200;
const MAX_SHORT_TEXT = 40;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// These fields are optional. When the form leaves them empty they are removed
// from the document instead of being stored as empty values.
export const OPTIONAL_FLAVOR_FIELDS = ["seasonal", "availableUntil", "plantBase", "notes", "origin"] as const;
export type OptionalFlavorField = (typeof OPTIONAL_FLAVOR_FIELDS)[number];

export type FlavorChanges = Pick<
  FlavorDoc,
  "name" | "colorHex" | "category" | "allergens" | "dietary" | "capacityScoops" | "lowThreshold" | "isActive"
> &
  Partial<Pick<FlavorDoc, OptionalFlavorField>>;

export interface ParsedFlavor {
  changes: FlavorChanges;
  emptyFields: OptionalFlavorField[];
}

function parseColor(body: Body): string {
  const color = requireString(body, "colorHex", 7);
  if (!COLOR_PATTERN.test(color)) throw new HttpError(400, "colorHex must look like #A1B2C3");
  return color.toUpperCase();
}

function parseDate(body: Body, field: string): Date | undefined {
  const text = optionalString(body, field, 10);
  if (text === undefined) return undefined;
  const date = new Date(`${text}T00:00:00Z`);
  if (!DATE_PATTERN.test(text) || Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${field} must be a date like 2026-12-31`);
  }
  return date;
}

export function parseFlavorInput(input: unknown): ParsedFlavor {
  const body = asBody(input);
  const capacityScoops = requireInteger(body, "capacityScoops", 1, MAX_CAPACITY);
  const changes: FlavorChanges = {
    name: requireString(body, "name", MAX_NAME_LENGTH),
    colorHex: parseColor(body),
    category: requireOneOf(body, "category", CATEGORIES),
    allergens: requireSubset(body, "allergens", ALLERGENS),
    dietary: requireSubset(body, "dietary", DIETARY),
    capacityScoops,
    lowThreshold: requireInteger(body, "lowThreshold", 0, capacityScoops - 1),
    isActive: optionalBoolean(body, "isActive") ?? true,
    seasonal: optionalBoolean(body, "seasonal") || undefined,
    availableUntil: parseDate(body, "availableUntil"),
    plantBase: optionalString(body, "plantBase", MAX_SHORT_TEXT),
    notes: optionalString(body, "notes", MAX_NOTES_LENGTH),
    origin: optionalString(body, "origin", MAX_SHORT_TEXT),
  };
  const emptyFields = OPTIONAL_FLAVOR_FIELDS.filter((field) => changes[field] === undefined);
  return { changes, emptyFields };
}

export function parseStartingStock(input: unknown, capacityScoops: number): number {
  const body = asBody(input);
  if (body.stockScoops === undefined) return capacityScoops;
  return requireInteger(body, "stockScoops", 0, capacityScoops);
}
