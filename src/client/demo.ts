import type { ExplainResult, ExplainRun, InvalidSaleAttempt } from "../shared/types.js";
import { explainQuery, fetchSettings, resetDemo, startRush, tryInvalidSales, type ExplainQueryName } from "./api.js";
import { setSettings, type View } from "./state.js";
import { byId, confirmAction, errorMessage, escapeHtml, showToast } from "./ui.js";

let initialized = false;

function runCells(run: ExplainRun): string[] {
  return [run.stage, String(run.keysExamined), String(run.docsExamined), String(run.returned), `${run.timeMs} ms`];
}

function explainHtml(result: ExplainResult): string {
  const labels = ["Plan", "Index keys examined", "Documents examined", "Documents returned", "Execution time"];
  const withIndex = runCells(result.withIndex);
  const withoutIndex = runCells(result.withoutIndex);
  const rows = labels
    .map((label, index) => `<tr><th scope="row">${label}</th><td>${escapeHtml(withIndex[index])}</td><td>${escapeHtml(withoutIndex[index])}</td></tr>`)
    .join("");
  return `
    <p><strong>${escapeHtml(result.description)}</strong>, out of ${result.totalDocuments} sales.</p>
    <pre class="inline-query">db.sales.find(${escapeHtml(JSON.stringify(result.filter))}).explain("executionStats")</pre>
    <div class="table-wrap"><table class="table compare">
      <thead><tr><th></th><th>With index <code>${escapeHtml(result.indexName)}</code></th><th>Without index (forced scan)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="muted">Without the index MongoDB reads every sale (COLLSCAN) and throws most of them away.
      With the index it jumps to the matching keys (IXSCAN) and only fetches the documents it returns.
      Time is tiny on a small collection, but documents examined grows with every sale, so the gap
      gets bigger as the shop keeps selling.</p>`;
}

async function runExplain(): Promise<void> {
  const output = byId("explain-output", HTMLElement);
  output.innerHTML = `<p class="muted">Running...</p>`;
  try {
    const query = byId("explain-query", HTMLSelectElement).value as ExplainQueryName;
    output.innerHTML = explainHtml(await explainQuery(query));
  } catch (error) {
    output.innerHTML = `<p class="empty">${escapeHtml(errorMessage(error))}</p>`;
  }
}

async function runRush(): Promise<void> {
  try {
    const { seconds } = await startRush();
    showToast(`Rush started: one random serving every second for ${seconds} seconds`);
    location.hash = "#sell";
  } catch (error) {
    showToast(errorMessage(error), "error");
  }
}

function invalidAttemptHtml(attempt: InvalidSaleAttempt): string {
  const rejected = attempt.status >= 400;
  return `
    <li class="attempt">
      <p><strong>${escapeHtml(attempt.label)}</strong>
        <span class="result ${rejected ? "result-rejected" : "result-fulfilled"}">HTTP ${attempt.status}</span></p>
      <p>${escapeHtml(attempt.error)}</p>
      <pre class="inline-query">POST /api/sales ${escapeHtml(JSON.stringify(attempt.payload))}</pre>
    </li>`;
}

async function runInvalidSale(): Promise<void> {
  const output = byId("invalid-output", HTMLElement);
  output.innerHTML = `<p class="muted">Sending...</p>`;
  try {
    const attempts = await tryInvalidSales();
    output.innerHTML = `<ul class="attempt-list">${attempts.map(invalidAttemptHtml).join("")}</ul>`;
  } catch (error) {
    output.innerHTML = `<p class="empty">${escapeHtml(errorMessage(error))}</p>`;
  }
}

async function runReset(): Promise<void> {
  const confirmed = await confirmAction(
    "Reset demo data",
    "This restores the starting stock and deletes all sales, refill requests, stock logs and receipt numbers.",
    "Reset data",
  );
  if (!confirmed) return;
  try {
    await resetDemo();
    setSettings(await fetchSettings());
    showToast("Demo data reset");
  } catch (error) {
    showToast(errorMessage(error), "error");
  }
}

function bindEvents(): void {
  byId("explain-run", HTMLButtonElement).addEventListener("click", () => void runExplain());
  byId("rush-run", HTMLButtonElement).addEventListener("click", () => void runRush());
  byId("invalid-run", HTMLButtonElement).addEventListener("click", () => void runInvalidSale());
  byId("reset-run", HTMLButtonElement).addEventListener("click", () => void runReset());
}

export const demoView: View = {
  async show() {
    if (!initialized) {
      bindEvents();
      initialized = true;
    }
  },
};
