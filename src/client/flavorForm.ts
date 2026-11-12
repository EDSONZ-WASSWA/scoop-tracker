import type { Allergen, Dietary, Flavor, FlavorCategory, FlavorInput } from "../shared/types.js";
import { createFlavor, updateFlavor } from "./api.js";
import { checkedValues, escapeHtml, formField, openFormDialog, showToast } from "./ui.js";

const CATEGORIES: FlavorCategory[] = ["fruity", "chocolatey", "creamy", "nutty", "vegan"];
const ALLERGENS: Allergen[] = ["milk", "nuts", "gluten", "eggs"];
const DIETARY: Dietary[] = ["vegan", "dairy-free"];
const DEFAULT_COLOR = "#D9708A";
const DEFAULT_CAPACITY = 60;
const DEFAULT_LOW_THRESHOLD = 10;
const MAX_CAPACITY = 500;

function checkboxes(name: string, options: string[], selected: string[]): string {
  return options
    .map(
      (option) => `
        <label class="check">
          <input type="checkbox" name="${name}" value="${option}" ${selected.includes(option) ? "checked" : ""}>
          ${option}
        </label>`,
    )
    .join("");
}

function textValue(value: string | undefined): string {
  return escapeHtml(value ?? "");
}

function flavorFormHtml(flavor: Flavor | undefined): string {
  const categoryOptions = CATEGORIES.map(
    (category) => `<option value="${category}" ${flavor?.category === category ? "selected" : ""}>${category}</option>`,
  ).join("");
  const stockField = flavor
    ? `<label class="check"><input type="checkbox" name="isActive" ${flavor.isActive ? "checked" : ""}> On sale (active)</label>`
    : `<label class="field">Starting stock (scoops)
         <input type="number" name="stockScoops" min="0" max="${MAX_CAPACITY}" value="${DEFAULT_CAPACITY}" required>
       </label>`;

  return `
    <form class="dialog-form flavor-form">
      <h2>${flavor ? `Edit ${escapeHtml(flavor.name)}` : "Add flavor"}</h2>
      <div class="form-grid">
        <label class="field">Name
          <input name="name" maxlength="40" required value="${textValue(flavor?.name)}">
        </label>
        <label class="field">Colour
          <input type="color" name="colorHex" value="${textValue(flavor?.colorHex ?? DEFAULT_COLOR)}">
        </label>
        <label class="field">Category
          <select name="category">${categoryOptions}</select>
        </label>
        <label class="field">Capacity (full tub, scoops)
          <input type="number" name="capacityScoops" min="1" max="${MAX_CAPACITY}" required
            value="${flavor?.capacityScoops ?? DEFAULT_CAPACITY}">
        </label>
        <label class="field">Low stock limit (scoops)
          <input type="number" name="lowThreshold" min="0" max="${MAX_CAPACITY}" required
            value="${flavor?.lowThreshold ?? DEFAULT_LOW_THRESHOLD}">
        </label>
        ${stockField}
      </div>
      <fieldset><legend>Allergens</legend>${checkboxes("allergens", ALLERGENS, flavor?.allergens ?? [])}</fieldset>
      <fieldset><legend>Dietary</legend>${checkboxes("dietary", DIETARY, flavor?.dietary ?? [])}</fieldset>
      <fieldset>
        <legend>Optional fields (only saved when filled in)</legend>
        <div class="form-grid">
          <label class="check"><input type="checkbox" name="seasonal" ${flavor?.seasonal ? "checked" : ""}> Seasonal</label>
          <label class="field">Available until
            <input type="date" name="availableUntil" value="${textValue(flavor?.availableUntil?.slice(0, 10))}">
          </label>
          <label class="field">Plant base
            <input name="plantBase" maxlength="40" value="${textValue(flavor?.plantBase)}" placeholder="e.g. Coconut milk">
          </label>
          <label class="field">Origin
            <input name="origin" maxlength="40" value="${textValue(flavor?.origin)}">
          </label>
        </div>
        <label class="field">Notes
          <textarea name="notes" rows="2" maxlength="200">${textValue(flavor?.notes)}</textarea>
        </label>
      </fieldset>
      <p class="dialog-error" role="alert"></p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">${flavor ? "Save changes" : "Add flavor"}</button>
      </div>
    </form>`;
}

function readText(form: HTMLFormElement, name: string): string {
  const element = form.elements.namedItem(name);
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return element.value.trim();
  }
  throw new Error(`Form field "${name}" is missing`);
}

function readFlavorInput(form: HTMLFormElement, isNew: boolean): FlavorInput {
  const input: FlavorInput = {
    name: readText(form, "name"),
    colorHex: readText(form, "colorHex"),
    category: readText(form, "category") as FlavorCategory,
    allergens: checkedValues(form, "allergens") as Allergen[],
    dietary: checkedValues(form, "dietary") as Dietary[],
    capacityScoops: Number(readText(form, "capacityScoops")),
    lowThreshold: Number(readText(form, "lowThreshold")),
    seasonal: formField(form, "seasonal", HTMLInputElement).checked,
    availableUntil: readText(form, "availableUntil"),
    plantBase: readText(form, "plantBase"),
    origin: readText(form, "origin"),
    notes: readText(form, "notes"),
  };
  if (isNew) input.stockScoops = Number(readText(form, "stockScoops"));
  else input.isActive = formField(form, "isActive", HTMLInputElement).checked;

  if (input.lowThreshold >= input.capacityScoops) throw new Error("The low stock limit must be below the capacity");
  if (input.stockScoops !== undefined && input.stockScoops > input.capacityScoops) {
    throw new Error("Starting stock cannot be above the capacity");
  }
  return input;
}

export function openFlavorForm(flavor: Flavor | undefined, onSaved: () => void): void {
  openFormDialog(flavorFormHtml(flavor), async (form) => {
    const input = readFlavorInput(form, !flavor);
    const saved = flavor ? await updateFlavor(flavor._id, input) : await createFlavor(input);
    showToast(flavor ? `${saved.name} saved` : `${saved.name} added`);
    onSaved();
  });
}
