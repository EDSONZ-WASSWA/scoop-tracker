import type { Flavor, RestockRequest } from "../shared/types.js";
import {
  adjustFlavor,
  deactivateFlavor,
  fetchFlavors,
  fetchRequests,
  fillFlavor,
  fulfilRequest,
  rejectRequest,
  saveSettings,
} from "./api.js";
import { updatePendingBadge } from "./badge.js";
import { openFlavorForm } from "./flavorForm.js";
import { getSettings, getUserName, setSettings, type View } from "./state.js";
import {
  byId,
  confirmAction,
  errorMessage,
  escapeHtml,
  formatDateTime,
  formField,
  openFormDialog,
  plural,
  showToast,
  statusBadge,
  swatch,
  timeAgo,
} from "./ui.js";

const EXTRA_FIELDS = ["seasonal", "availableUntil", "plantBase", "containsNuts", "notes", "origin"] as const;
const MINUTE_MS = 60 * 1000;

let flavors: Flavor[] = [];
let pending: RestockRequest[] = [];
let history: RestockRequest[] = [];
let initialized = false;
const rendered = { inbox: "", flavors: "", history: "" };

function updateIfChanged(key: keyof typeof rendered, elementId: string, html: string): void {
  if (rendered[key] === html) return;
  rendered[key] = html;
  byId(elementId, HTMLElement).innerHTML = html;
}

function flavorColor(flavorId: string): string {
  return flavors.find((flavor) => flavor._id === flavorId)?.colorHex ?? "#CCCCCC";
}

function requestHtml(request: RestockRequest): string {
  const urgent = request.priority === "urgent";
  const note = request.note ? `<p class="request-note">${escapeHtml(request.note)}</p>` : "";
  return `
    <li class="request-row ${urgent ? "is-urgent" : ""}">
      <div class="request-main">
        ${swatch(flavorColor(request.flavorId))}
        <div>
          <p class="request-title"><strong>${escapeHtml(request.flavorName)}</strong>
            ${urgent ? `<span class="priority-badge">Urgent</span>` : ""}</p>
          <p class="muted">Stock when requested: ${plural(request.stockAtRequest, "scoop")}
            · asks for ${request.quantityRequested}</p>
          <p class="muted">Requested by ${escapeHtml(request.requestedBy)}, ${timeAgo(request.requestedAt)}</p>
          ${note}
        </div>
      </div>
      <div class="request-actions">
        <button type="button" class="btn btn-small btn-primary" data-action="fulfil" data-id="${request._id}">Fill up</button>
        <button type="button" class="btn btn-small btn-ghost" data-action="reject" data-id="${request._id}">Reject</button>
      </div>
    </li>`;
}

function extraFields(flavor: Flavor): string {
  const present = EXTRA_FIELDS.filter((field) => flavor[field] !== undefined);
  return present.length > 0 ? present.map((field) => `<code>${field}</code>`).join(" ") : `<span class="muted">none</span>`;
}

function flavorRowHtml(flavor: Flavor): string {
  const actions = flavor.isActive
    ? `<button type="button" class="btn btn-small btn-primary" data-action="fill" data-id="${flavor._id}">Fill up</button>
       <button type="button" class="btn btn-small btn-outline" data-action="adjust" data-id="${flavor._id}">Adjust stock</button>
       <button type="button" class="btn btn-small btn-ghost" data-action="edit" data-id="${flavor._id}">Edit</button>
       <button type="button" class="btn btn-small btn-ghost" data-action="deactivate" data-id="${flavor._id}">Deactivate</button>`
    : `<button type="button" class="btn btn-small btn-ghost" data-action="edit" data-id="${flavor._id}">Edit</button>`;
  return `
    <tr class="${flavor.isActive ? "" : "is-inactive"}">
      <td><span class="name-cell">${swatch(flavor.colorHex)} ${escapeHtml(flavor.name)}</span></td>
      <td>${flavor.isActive ? statusBadge(flavor.status) : `<span class="status-badge">Inactive</span>`}</td>
      <td class="num">${flavor.stockScoops} / ${flavor.capacityScoops}</td>
      <td class="num">${flavor.lowThreshold}</td>
      <td>${extraFields(flavor)}</td>
      <td class="row-actions">${actions}</td>
    </tr>`;
}

function waitedText(request: RestockRequest): string {
  if (!request.handledAt) return "";
  const minutes = Math.round((new Date(request.handledAt).getTime() - new Date(request.requestedAt).getTime()) / MINUTE_MS);
  return `${minutes} min`;
}

function historyRowHtml(request: RestockRequest): string {
  return `
    <tr>
      <td>${escapeHtml(request.flavorName)}</td>
      <td><span class="result result-${request.status}">${request.status}</span></td>
      <td>${escapeHtml(request.requestedBy)}</td>
      <td>${formatDateTime(request.requestedAt)}</td>
      <td>${escapeHtml(request.handledBy ?? "")}</td>
      <td class="num">${waitedText(request)}</td>
    </tr>`;
}

function render(): void {
  updateIfChanged(
    "inbox",
    "request-inbox",
    pending.length > 0 ? pending.map(requestHtml).join("") : `<li class="empty">No open refill requests.</li>`,
  );
  byId("inbox-count", HTMLElement).textContent = `${pending.length} open`;
  updateIfChanged("flavors", "flavor-rows", flavors.map(flavorRowHtml).join(""));
  updateIfChanged(
    "history",
    "history-rows",
    history.length > 0 ? history.map(historyRowHtml).join("") : `<tr><td colspan="6" class="empty">No handled requests yet.</td></tr>`,
  );
}

async function refresh(): Promise<void> {
  [flavors, pending, history] = await Promise.all([
    fetchFlavors({ includeInactive: true }),
    fetchRequests(["pending"]),
    fetchRequests(["fulfilled", "rejected"]),
  ]);
  render();
}

async function runAction(action: () => Promise<string>): Promise<void> {
  try {
    showToast(await action());
    await Promise.all([refresh(), updatePendingBadge()]);
  } catch (error) {
    showToast(errorMessage(error), "error");
  }
}

async function handleRequestClick(event: Event): Promise<void> {
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-action]");
  const request = pending.find((candidate) => candidate._id === button?.dataset.id);
  if (!button || !request) return;

  if (button.dataset.action === "fulfil") {
    await runAction(async () => {
      await fulfilRequest(request._id, getUserName());
      return `${request.flavorName} filled up`;
    });
    return;
  }
  const confirmed = await confirmAction(
    "Reject refill request",
    `Reject the refill request for ${request.flavorName}? The seller will be able to request it again.`,
    "Reject request",
  );
  if (confirmed) {
    await runAction(async () => {
      await rejectRequest(request._id, getUserName());
      return `Request for ${request.flavorName} rejected`;
    });
  }
}

function openAdjustDialog(flavor: Flavor): void {
  const html = `
    <form class="dialog-form">
      <h2>Adjust stock</h2>
      <p class="dialog-flavor">${swatch(flavor.colorHex)} <strong>${escapeHtml(flavor.name)}</strong></p>
      <p class="muted">Use this after counting the tub. Capacity is ${flavor.capacityScoops} scoops.</p>
      <label class="field">Scoops in the tub
        <input type="number" name="stockScoops" min="0" max="${flavor.capacityScoops}" value="${flavor.stockScoops}" required>
      </label>
      <p class="dialog-error" role="alert"></p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">Save stock</button>
      </div>
    </form>`;
  openFormDialog(html, async (form) => {
    const stockScoops = formField(form, "stockScoops", HTMLInputElement).valueAsNumber;
    const updated = await adjustFlavor(flavor._id, stockScoops, getUserName());
    showToast(`${updated.name} set to ${plural(updated.stockScoops, "scoop")}`);
    await refresh();
  });
}

async function handleFlavorClick(event: Event): Promise<void> {
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-action]");
  const flavor = flavors.find((candidate) => candidate._id === button?.dataset.id);
  if (!button || !flavor) return;

  switch (button.dataset.action) {
    case "fill":
      await runAction(async () => {
        const updated = await fillFlavor(flavor._id, getUserName());
        return `${updated.name} filled up to ${updated.stockScoops} scoops`;
      });
      break;
    case "adjust":
      openAdjustDialog(flavor);
      break;
    case "edit":
      openFlavorForm(flavor, () => void refresh());
      break;
    case "deactivate":
      await runAction(async () => {
        await deactivateFlavor(flavor._id);
        return `${flavor.name} is no longer on sale`;
      });
      break;
  }
}

function fillSettingsForm(): void {
  const form = byId("settings-form", HTMLFormElement);
  const settings = getSettings();
  formField(form, "scoopsPerSale", HTMLInputElement).value = String(settings.scoopsPerSale);
  formField(form, "pricePerSale", HTMLInputElement).value = String(settings.pricePerSale);
  formField(form, "currency", HTMLInputElement).value = settings.currency;
}

async function saveSettingsForm(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = byId("settings-form", HTMLFormElement);
  await runAction(async () => {
    const saved = await saveSettings({
      scoopsPerSale: formField(form, "scoopsPerSale", HTMLInputElement).valueAsNumber,
      pricePerSale: formField(form, "pricePerSale", HTMLInputElement).valueAsNumber,
      currency: formField(form, "currency", HTMLInputElement).value.trim(),
    });
    setSettings(saved);
    return "Sale settings saved";
  });
}

function bindEvents(): void {
  byId("request-inbox", HTMLElement).addEventListener("click", (event) => void handleRequestClick(event));
  byId("flavor-rows", HTMLElement).addEventListener("click", (event) => void handleFlavorClick(event));
  byId("add-flavor", HTMLButtonElement).addEventListener("click", () => openFlavorForm(undefined, () => void refresh()));
  byId("settings-form", HTMLFormElement).addEventListener("submit", (event) => void saveSettingsForm(event));
}

export const managerView: View = {
  async show() {
    if (!initialized) {
      bindEvents();
      initialized = true;
    }
    fillSettingsForm();
    await refresh();
  },
  refresh,
};
