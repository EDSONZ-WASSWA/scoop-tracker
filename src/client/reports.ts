import type {
  ComboTotal,
  DayTotal,
  FlavorTotal,
  HourTotal,
  QueryInfo,
  RefillTimesReport,
  SellerTotal,
  SummaryReport,
} from "../shared/types.js";
import { fetchReport } from "./api.js";
import { barChart, columnChart } from "./charts.js";
import { formatCompactMoney, formatMoney, getSettings, scoopValue, type View } from "./state.js";
import { byId, errorMessage, escapeHtml, plural, queryPanel, swatch } from "./ui.js";

const TOP_FLAVORS = 5;
const MONEY_TOLERANCE = 0.005;

let initialized = false;

function panel(title: string, body: string, query?: QueryInfo, extraClass = ""): string {
  return `
    <section class="panel report ${extraClass}">
      <h2>${escapeHtml(title)}</h2>
      ${body}
      ${query ? queryPanel([query]) : ""}
    </section>`;
}

function totalsBlock(label: string, money: number, servings: number, scoops: number): string {
  return `
    <div class="totals">
      <h3>${label}</h3>
      <p class="money-big money">${formatMoney(money)}</p>
      <p class="muted">${plural(servings, "serving")} · ${plural(scoops, "scoop")}</p>
    </div>`;
}

function summaryPanel(summary: SummaryReport, query: QueryInfo): string {
  const { today, allTime } = summary;
  const body = `<div class="totals-row">
      ${totalsBlock("Today", today.money, today.servings, today.scoops)}
      ${totalsBlock("All time", allTime.money, allTime.servings, allTime.scoops)}
    </div>`;
  return panel("Money sold", body, query);
}

function closingPanel(summary: SummaryReport): string {
  const { today, settings } = summary;
  const servingsFromScoops = today.scoops / settings.scoopsPerSale;
  const expectedMoney = today.servings * settings.pricePerSale;
  const balanced = servingsFromScoops === today.servings && Math.abs(expectedMoney - today.money) < MONEY_TOLERANCE;
  const body = `
    <dl class="facts">
      <div><dt>Servings</dt><dd>${today.servings}</dd></div>
      <div><dt>Scoops</dt><dd>${today.scoops}</dd></div>
      <div><dt>Money</dt><dd class="money">${formatMoney(today.money)}</dd></div>
    </dl>
    <p class="closing-check">${today.scoops} scoops ÷ ${settings.scoopsPerSale} = ${servingsFromScoops} servings
      = ${formatMoney(expectedMoney)}</p>
    <p class="closing-result ${balanced ? "is-balanced" : "is-off"}">
      ${balanced ? "Balanced. The cash in the till should be " + formatMoney(today.money) + "." : "Does not balance. Check sales made before the sale settings changed."}
    </p>`;
  return panel("Daily closing", body);
}

function fillHourGaps(hours: HourTotal[]): HourTotal[] {
  if (hours.length === 0) return [];
  const first = hours[0].hour;
  const last = hours[hours.length - 1].hour;
  return Array.from(
    { length: last - first + 1 },
    (_, index) => hours.find((total) => total.hour === first + index) ?? { hour: first + index, money: 0, servings: 0 },
  );
}

function hourPanel(hours: HourTotal[], query: QueryInfo): string {
  const data = fillHourGaps(hours).map((total) => ({
    label: String(total.hour).padStart(2, "0"),
    value: total.money,
    display: formatCompactMoney(total.money),
    detail: formatMoney(total.money),
  }));
  return panel(`Money per hour of the day, all sales (${getSettings().currency})`, columnChart(data, "Money per hour"), query, "span-2");
}

function dayLabel(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString([], { weekday: "short", day: "numeric" });
}

function dayPanel(days: DayTotal[], query: QueryInfo): string {
  const data = days.map((total) => ({
    label: dayLabel(total.day),
    value: total.money,
    display: formatCompactMoney(total.money),
    detail: formatMoney(total.money),
  }));
  return panel(`Money per day, last 7 days (${getSettings().currency})`, columnChart(data, "Money per day"), query);
}

function flavorPanel(flavors: FlavorTotal[], query: QueryInfo): string {
  const data = flavors.map((flavor) => ({
    label: flavor.name,
    value: flavor.scoops,
    display: plural(flavor.scoops, "scoop"),
    color: flavor.colorHex,
  }));
  return panel("Scoops sold per flavor", barChart(data, "Scoops sold per flavor"), query, "span-2");
}

function flavorValuePanel(flavors: FlavorTotal[]): string {
  const rows = flavors
    .map(
      (flavor) => `
        <tr>
          <td><span class="name-cell">${swatch(flavor.colorHex)} ${escapeHtml(flavor.name)}</span></td>
          <td class="num">${flavor.scoops}</td>
          <td class="num money">${formatMoney(flavor.value)}</td>
        </tr>`,
    )
    .join("");
  const body = `
    <p class="muted">One scoop is worth ${formatMoney(scoopValue())}.</p>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Flavor</th><th class="num">Scoops</th><th class="num">Value</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" class="empty">No sales yet.</td></tr>`}</tbody>
    </table></div>`;
  return panel("Money value per flavor", body);
}

function topFlavorsPanel(flavors: FlavorTotal[]): string {
  const items = flavors
    .slice(0, TOP_FLAVORS)
    .map(
      (flavor) => `
        <li><span class="name-cell">${swatch(flavor.colorHex)} ${escapeHtml(flavor.name)}</span>
          <span class="muted">${plural(flavor.scoops, "scoop")} in ${plural(flavor.servings, "serving")}</span></li>`,
    )
    .join("");
  return panel("Top 5 flavors", items ? `<ol class="rank-list">${items}</ol>` : `<p class="empty">No sales yet.</p>`);
}

function sellerPanel(sellers: SellerTotal[], query: QueryInfo): string {
  const data = sellers.map((seller) => ({
    label: seller.seller,
    value: seller.money,
    display: `${formatMoney(seller.money)} (${seller.servings})`,
  }));
  return panel("Money per seller", barChart(data, "Money per seller"), query);
}

function comboPanel(combos: ComboTotal[], query: QueryInfo): string {
  const items = combos
    .map(
      (combo) => `
        <li><span>${combo.flavors.map(escapeHtml).join(" + ")}</span>
          <span class="muted">${plural(combo.servings, "serving")}</span></li>`,
    )
    .join("");
  const body = items ? `<ol class="rank-list">${items}</ol>` : `<p class="empty">No sales yet.</p>`;
  return panel("Most popular flavor combinations", body, query);
}

function refillPanel(report: RefillTimesReport, query: QueryInfo): string {
  const average =
    report.averageMinutes === null
      ? "No refills done yet."
      : `${report.averageMinutes} minutes on average, over ${plural(report.fulfilledCount, "refill")}.`;
  const rows = report.perFlavor
    .map(
      (row) => `
        <tr><td>${escapeHtml(row.flavorName)}</td><td class="num">${row.total}</td>
          <td class="num">${row.pending}</td><td class="num">${row.fulfilled}</td><td class="num">${row.rejected}</td></tr>`,
    )
    .join("");
  const body = `
    <p><strong>Time from request to refill:</strong> ${average}</p>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Flavor</th><th class="num">Requests</th><th class="num">Pending</th>
        <th class="num">Filled</th><th class="num">Rejected</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="empty">No refill requests yet.</td></tr>`}</tbody>
    </table></div>`;
  return panel("Refill requests", body, query, "span-2");
}

async function load(): Promise<void> {
  const container = byId("reports-content", HTMLElement);
  try {
    const [summary, hours, days, flavors, sellers, combos, refills] = await Promise.all([
      fetchReport("summary"),
      fetchReport("money-by-hour"),
      fetchReport("money-by-day"),
      fetchReport("by-flavor"),
      fetchReport("by-seller"),
      fetchReport("combos"),
      fetchReport("refill-times"),
    ]);
    container.innerHTML = [
      summaryPanel(summary.data, summary.query),
      closingPanel(summary.data),
      topFlavorsPanel(flavors.data),
      dayPanel(days.data, days.query),
      hourPanel(hours.data, hours.query),
      flavorPanel(flavors.data, flavors.query),
      flavorValuePanel(flavors.data),
      comboPanel(combos.data, combos.query),
      sellerPanel(sellers.data, sellers.query),
      refillPanel(refills.data, refills.query),
    ].join("");
  } catch (error) {
    container.innerHTML = `<p class="empty">Could not load reports: ${escapeHtml(errorMessage(error))}</p>`;
  }
}

export const reportsView: View = {
  async show() {
    if (!initialized) {
      byId("reports-refresh", HTMLButtonElement).addEventListener("click", () => void load());
      initialized = true;
    }
    await load();
  },
};
