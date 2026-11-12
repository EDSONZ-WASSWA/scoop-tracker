import { escapeHtml } from "./ui.js";

// Above this many columns the value labels no longer fit above the bars.
const DENSE_COLUMN_COUNT = 12;

export interface BarDatum {
  label: string;
  value: number;
  display: string;
  detail?: string;
  color?: string;
}

function percentOf(value: number, max: number): number {
  return max > 0 ? Math.round((value / max) * 100) : 0;
}

function maxValue(data: BarDatum[]): number {
  return Math.max(0, ...data.map((datum) => datum.value));
}

function barStyle(datum: BarDatum, size: string): string {
  const color = datum.color ? `--bar: ${escapeHtml(datum.color)};` : "";
  return `style="${size} ${color}"`;
}

export function columnChart(data: BarDatum[], label: string): string {
  if (data.length === 0) return `<p class="empty">No sales yet.</p>`;
  const max = maxValue(data);
  const columns = data
    .map(
      (datum) => `
        <div class="col" title="${escapeHtml(`${datum.label}: ${datum.detail ?? datum.display}`)}">
          <span class="col-value">${escapeHtml(datum.display)}</span>
          <div class="col-track"><span class="col-bar" ${barStyle(datum, `height: ${percentOf(datum.value, max)}%;`)}></span></div>
          <span class="col-label">${escapeHtml(datum.label)}</span>
        </div>`,
    )
    .join("");
  const dense = data.length > DENSE_COLUMN_COUNT ? "is-dense" : "";
  return `<div class="column-chart ${dense}" role="img" aria-label="${escapeHtml(label)}">${columns}</div>`;
}

export function barChart(data: BarDatum[], label: string): string {
  if (data.length === 0) return `<p class="empty">No sales yet.</p>`;
  const max = maxValue(data);
  const rows = data
    .map(
      (datum) => `
        <div class="bar-row">
          <span class="bar-label">${escapeHtml(datum.label)}</span>
          <div class="bar-track"><span class="bar" ${barStyle(datum, `width: ${percentOf(datum.value, max)}%;`)}></span></div>
          <span class="bar-value">${escapeHtml(datum.display)}</span>
        </div>`,
    )
    .join("");
  return `<div class="bar-chart" role="img" aria-label="${escapeHtml(label)}">${rows}</div>`;
}
