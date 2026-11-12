import type { Settings } from "../shared/types.js";

export interface View {
  show(): Promise<void>;
  refresh?(): Promise<void>;
}

let settings: Settings | null = null;
let userName = "";

export function setSettings(next: Settings): void {
  settings = next;
}

export function getSettings(): Settings {
  if (!settings) throw new Error("Settings have not been loaded yet");
  return settings;
}

export function scoopValue(): number {
  const { pricePerSale, scoopsPerSale } = getSettings();
  return pricePerSale / scoopsPerSale;
}

// Shillings have no cents, so decimals are only shown when an amount has them.
export function formatMoney(amount: number): string {
  return `${getSettings().currency} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

// Short form such as "10K" for chart labels, where the full amount does not fit.
export function formatCompactMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(amount);
}

export function setUserName(name: string): void {
  userName = name.trim();
}

export function getUserName(): string {
  return userName || "Seller";
}
