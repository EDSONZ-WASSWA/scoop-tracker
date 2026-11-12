import type { Allergen, Dietary, Flavor, FlavorFilters, QueryInfo, TodaySummary } from "../shared/types.js";
import { fetchFlavors, fetchToday, requestRefill, sellServing } from "./api.js";
import { updatePendingBadge } from "./badge.js";
import { bannerHtml, flavorCardHtml, moneyPanelHtml } from "./sellCards.js";
import {
  addScoop,
  clearServing,
  isServingFull,
  removeExtraScoops,
  removeScoopAt,
  renderServing,
  scoopsOf,
  servingFlavorIds,
  servingItems,
} from "./serving.js";
import { formatMoney, getSettings, getUserName, type View } from "./state.js";
import { byId, errorMessage, escapeHtml, formatQueries, formField, openFormDialog, plural, showToast, swatch } from "./ui.js";

const SEARCH_DEBOUNCE_MS = 250;
const HIGHLIGHT_MS = 1500;

let flavors: Flavor[] = [];
let lowFlavors: Flavor[] = [];
let today: TodaySummary | null = null;
let lastSaleQueries: QueryInfo[] | null = null;
let selling = false;
let initialized = false;
const rendered = { grid: "", banner: "", money: "", query: "" };

function currentFilters(): FlavorFilters {
  return {
    q: byId("filter-q", HTMLInputElement).value.trim(),
    excludeAllergen: byId("filter-allergen", HTMLSelectElement).value as Allergen | "",
    dietary: byId("filter-dietary", HTMLSelectElement).value as Dietary | "",
    lowOnly: byId("filter-low", HTMLInputElement).checked,
  };
}

// Shown before the first sale so the panel already explains the update.
function exampleQueries(): QueryInfo[] {
  const settings = getSettings();
  return [
    {
      collection: "flavors",
      operation: "updateOne",
      filter: { _id: "<flavorId>", stockScoops: { $gte: "<scoops>" } },
      update: { $inc: { stockScoops: "-<scoops>" }, $set: { updatedAt: "<now>" } },
      note: "Runs once per flavor. If matchedCount is 0, earlier flavors are rolled back with the opposite $inc.",
    },
    {
      collection: "sales",
      operation: "insertOne",
      document: {
        receiptNo: "R-0000",
        items: [{ flavorId: "<flavorId>", flavorName: "<name>", scoops: "<scoops>" }],
        totalScoops: settings.scoopsPerSale,
        amount: settings.pricePerSale,
        soldBy: "<seller>",
        soldAt: "<now>",
      },
      note: "Only runs after every flavor was deducted. Sell a serving to see the real values.",
    },
  ];
}

function updateIfChanged(key: keyof typeof rendered, elementId: string, html: string): void {
  if (rendered[key] === html) return;
  rendered[key] = html;
  byId(elementId, HTMLElement).innerHTML = html;
}

function renderGrid(): void {
  const html =
    flavors.length > 0
      ? flavors.map((flavor) => flavorCardHtml(flavor, scoopsOf(flavor._id), isServingFull())).join("")
      : `<p class="empty">No flavors match these filters.</p>`;
  updateIfChanged("grid", "flavor-grid", html);
}

function renderBanner(): void {
  const html = bannerHtml(lowFlavors);
  updateIfChanged("banner", "refill-banner", html);
  byId("refill-banner", HTMLElement).hidden = html === "";
}

function renderQuery(): void {
  const text = formatQueries(lastSaleQueries ?? exampleQueries());
  updateIfChanged("query", "serving-query", escapeHtml(text));
}

function render(): void {
  renderGrid();
  renderBanner();
  if (today) updateIfChanged("money", "money-panel", moneyPanelHtml(today));
  renderServing(selling);
  renderQuery();
}

// Another seller may have sold scoops that are still in this serving.
function trimServingToStock(): void {
  for (const flavorId of servingFlavorIds()) {
    const flavor = flavors.find((candidate) => candidate._id === flavorId);
    if (!flavor || scoopsOf(flavorId) <= flavor.stockScoops) continue;
    const removed = removeExtraScoops(flavorId, flavor.stockScoops);
    showToast(`${flavor.name} has only ${flavor.stockScoops} left, removed ${plural(removed, "scoop")}`, "error");
  }
}

async function refresh(): Promise<void> {
  [flavors, lowFlavors, today] = await Promise.all([
    fetchFlavors(currentFilters()),
    fetchFlavors({ lowOnly: true }),
    fetchToday(),
  ]);
  trimServingToStock();
  render();
}

function refreshQuietly(): void {
  refresh().catch((error: unknown) => showToast(errorMessage(error), "error"));
}

async function sell(): Promise<void> {
  if (!isServingFull() || selling) return;
  selling = true;
  renderServing(selling);
  try {
    const { sale, queries } = await sellServing({ items: servingItems(), soldBy: getUserName() });
    clearServing();
    lastSaleQueries = queries;
    showToast(`Sold ${sale.receiptNo} for ${formatMoney(sale.amount)}`);
  } catch (error) {
    showToast(errorMessage(error), "error");
  } finally {
    selling = false;
    refreshQuietly();
  }
}

function openRefillDialog(flavor: Flavor): void {
  const urgent = flavor.stockScoops === 0;
  const html = `
    <form class="dialog-form">
      <h2>Request refill</h2>
      <p class="dialog-flavor">${swatch(flavor.colorHex)} <strong>${escapeHtml(flavor.name)}</strong></p>
      <dl class="facts">
        <div><dt>Current stock</dt><dd>${flavor.stockScoops} of ${flavor.capacityScoops} scoops</dd></div>
        <div><dt>Quantity requested</dt><dd>${flavor.capacityScoops - flavor.stockScoops} scoops</dd></div>
        <div><dt>Priority</dt><dd>${urgent ? "Urgent" : "Normal"}</dd></div>
      </dl>
      <label class="field">Note (optional)
        <textarea name="note" rows="3" maxlength="200" placeholder="For example: customers keep asking"></textarea>
      </label>
      <p class="dialog-error" role="alert"></p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">Send request</button>
      </div>
    </form>`;
  openFormDialog(html, async (form) => {
    await requestRefill(flavor._id, getUserName(), formField(form, "note", HTMLTextAreaElement).value);
    showToast(`Refill requested for ${flavor.name}`);
    refreshQuietly();
    updatePendingBadge().catch(() => undefined);
  });
}

function handleGridClick(event: Event): void {
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-action]");
  const flavor = flavors.find((candidate) => candidate._id === button?.dataset.id);
  if (!button || !flavor) return;
  if (button.dataset.action === "add") {
    addScoop(flavor);
    render();
  } else if (button.dataset.action === "refill") {
    openRefillDialog(flavor);
  }
}

function handleSlotClick(event: Event): void {
  const slot = (event.target as Element).closest<HTMLButtonElement>("button.slot");
  if (!slot) return;
  removeScoopAt(Number(slot.dataset.index));
  render();
}

async function scrollToFlavor(flavorId: string): Promise<void> {
  if (!document.getElementById(`flavor-${flavorId}`)) {
    byId("filters", HTMLFormElement).reset();
    await refresh();
  }
  const card = document.getElementById(`flavor-${flavorId}`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("highlight");
  setTimeout(() => card.classList.remove("highlight"), HIGHLIGHT_MS);
}

function bindEvents(): void {
  let searchTimer: number | undefined;
  const filters = byId("filters", HTMLFormElement);
  filters.addEventListener("submit", (event) => event.preventDefault());
  filters.addEventListener("change", refreshQuietly);
  byId("filter-q", HTMLInputElement).addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refreshQuietly, SEARCH_DEBOUNCE_MS);
  });

  byId("flavor-grid", HTMLElement).addEventListener("click", handleGridClick);
  byId("serving-slots", HTMLElement).addEventListener("click", handleSlotClick);
  byId("serving-sell", HTMLButtonElement).addEventListener("click", () => void sell());
  byId("serving-clear", HTMLButtonElement).addEventListener("click", () => {
    clearServing();
    render();
  });
  byId("refill-banner", HTMLElement).addEventListener("click", (event) => {
    const link = (event.target as Element).closest<HTMLButtonElement>(".banner-link");
    if (link?.dataset.id) scrollToFlavor(link.dataset.id).catch(() => undefined);
  });
}

export const sellView: View = {
  async show() {
    if (!initialized) {
      bindEvents();
      initialized = true;
    }
    renderServing(selling);
    await refresh();
  },
  refresh,
};
