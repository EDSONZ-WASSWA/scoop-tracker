import { fetchRequests } from "./api.js";
import { byId } from "./ui.js";

export async function updatePendingBadge(): Promise<void> {
  const pending = await fetchRequests(["pending"]);
  const badge = byId("pending-badge", HTMLElement);
  badge.textContent = String(pending.length);
  badge.hidden = pending.length === 0;
}
