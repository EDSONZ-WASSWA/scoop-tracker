import type { Flavor, Sale, TodaySummary } from "../shared/types.js";
import { formatMoney } from "./state.js";
import { escapeHtml, formatTime, plural, statusBadge, swatch } from "./ui.js";

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function flavorTags(flavor: Flavor): string {
  const tags = [
    ...flavor.dietary.map((diet) => capitalize(diet)),
    ...(flavor.allergens.includes("nuts") ? ["Contains nuts"] : []),
    ...(flavor.seasonal ? ["Seasonal"] : []),
  ];
  return tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
}

function refillControl(flavor: Flavor): string {
  if (flavor.refillPending) return `<span class="refill-done">Refill requested</span>`;
  if (flavor.status !== "red" && flavor.status !== "sold-out") return "";
  const label = flavor.status === "sold-out" ? "Request urgent refill" : "Request refill";
  return `<button type="button" class="btn btn-small btn-outline" data-action="refill" data-id="${flavor._id}">${label}</button>`;
}

export function flavorCardHtml(flavor: Flavor, inServing: number, servingFull: boolean): string {
  const canAdd = flavor.status !== "sold-out" && !servingFull && inServing < flavor.stockScoops;
  const percent = Math.min(100, Math.round((flavor.stockScoops / flavor.capacityScoops) * 100));
  const allergens = flavor.allergens.length > 0 ? flavor.allergens.join(", ") : "no listed allergens";
  const name = escapeHtml(flavor.name);

  return `
    <article class="flavor-card status-${flavor.status}" id="flavor-${flavor._id}">
      <div class="card-head">
        ${swatch(flavor.colorHex)}
        <div class="card-title">
          <h3>${name}</h3>
          <p class="card-meta">${escapeHtml(capitalize(flavor.category))} · ${escapeHtml(allergens)}</p>
        </div>
        ${statusBadge(flavor.status)}
      </div>
      <div class="tags">${flavorTags(flavor)}</div>
      <div class="stock-bar" role="meter" aria-label="Stock of ${name}" aria-valuemin="0"
        aria-valuemax="${flavor.capacityScoops}" aria-valuenow="${flavor.stockScoops}">
        <span style="width: ${percent}%"></span>
      </div>
      <p class="stock-text"><strong>${flavor.stockScoops}</strong> of ${flavor.capacityScoops} scoops left</p>
      <div class="card-actions">
        <button type="button" class="btn btn-small btn-primary" data-action="add" data-id="${flavor._id}"
          ${canAdd ? "" : "disabled"} aria-label="Add one scoop of ${name}">Add scoop</button>
        ${inServing > 0 ? `<span class="in-serving">${inServing} in serving</span>` : ""}
        ${refillControl(flavor)}
      </div>
    </article>`;
}

export function bannerHtml(lowFlavors: Flavor[]): string {
  if (lowFlavors.length === 0) return "";
  const verb = lowFlavors.length === 1 ? "needs" : "need";
  const links = lowFlavors
    .map((flavor) => `<button type="button" class="banner-link" data-id="${flavor._id}">${escapeHtml(flavor.name)}</button>`)
    .join(", ");
  return `<strong>${plural(lowFlavors.length, "flavor")} ${verb} refilling:</strong> ${links}`;
}

export function saleMix(sale: Sale): string {
  return sale.items.map((item) => `${item.scoops} × ${item.flavorName}`).join(", ");
}

function saleRow(sale: Sale): string {
  return `
    <li>
      <span class="receipt">${escapeHtml(sale.receiptNo)}</span>
      <span class="sale-time">${formatTime(sale.soldAt)}</span>
      <span class="sale-mix">${escapeHtml(saleMix(sale))}</span>
      <span class="money">${formatMoney(sale.amount)}</span>
    </li>`;
}

export function moneyPanelHtml(today: TodaySummary): string {
  const sales =
    today.latest.length > 0
      ? `<ol class="sales-list">${today.latest.map(saleRow).join("")}</ol>`
      : `<p class="empty">No sales yet.</p>`;
  return `
    <h2>Money sold today</h2>
    <p class="money-big money">${formatMoney(today.money)}</p>
    <dl class="stats">
      <div><dt>Servings today</dt><dd>${today.servings}</dd></div>
      <div><dt>Scoops today</dt><dd>${today.scoops}</dd></div>
    </dl>
    <h3>Last 10 sales</h3>
    ${sales}`;
}
