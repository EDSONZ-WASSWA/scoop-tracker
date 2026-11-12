import type {
  ApiError,
  ComboTotal,
  DayTotal,
  ExplainResult,
  Flavor,
  FlavorFilters,
  FlavorInput,
  FlavorTotal,
  HourTotal,
  InvalidSaleAttempt,
  RefillTimesReport,
  ReportResponse,
  RequestStatus,
  RestockRequest,
  RushResponse,
  SaleRequest,
  SaleResponse,
  SellerTotal,
  Settings,
  SummaryReport,
  TodaySummary,
} from "../shared/types.js";

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function isApiError(value: unknown): value is ApiError {
  return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiRequestError(response.status, isApiError(data) ? data.error : `Request failed (${response.status})`);
  }
  return data as T;
}

export const fetchSettings = () => request<Settings>("GET", "/settings");
export const saveSettings = (settings: Settings) => request<Settings>("PUT", "/settings", settings);

export function fetchFlavors(filters: FlavorFilters = {}): Promise<Flavor[]> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.excludeAllergen) params.set("excludeAllergen", filters.excludeAllergen);
  if (filters.dietary) params.set("dietary", filters.dietary);
  if (filters.lowOnly) params.set("lowOnly", "true");
  if (filters.includeInactive) params.set("includeInactive", "true");
  const query = params.toString();
  return request<Flavor[]>("GET", `/flavors${query ? `?${query}` : ""}`);
}

export const createFlavor = (input: FlavorInput) => request<Flavor>("POST", "/flavors", input);
export const updateFlavor = (id: string, input: FlavorInput) => request<Flavor>("PUT", `/flavors/${id}`, input);
export const deactivateFlavor = (id: string) => request<Flavor>("PATCH", `/flavors/${id}/deactivate`);
export const fillFlavor = (id: string, by: string) => request<Flavor>("POST", `/flavors/${id}/fill`, { by });
export const adjustFlavor = (id: string, stockScoops: number, by: string) =>
  request<Flavor>("POST", `/flavors/${id}/adjust`, { stockScoops, by });

export const sellServing = (sale: SaleRequest) => request<SaleResponse>("POST", "/sales", sale);
export const fetchToday = () => request<TodaySummary>("GET", "/sales/today");

export const requestRefill = (flavorId: string, requestedBy: string, note: string) =>
  request<RestockRequest>("POST", "/requests", { flavorId, requestedBy, note });
export const fetchRequests = (statuses: RequestStatus[]) =>
  request<RestockRequest[]>("GET", `/requests?status=${statuses.join(",")}`);
export const fulfilRequest = (id: string, handledBy: string) =>
  request<RestockRequest>("PATCH", `/requests/${id}/fulfil`, { handledBy });
export const rejectRequest = (id: string, handledBy: string) =>
  request<RestockRequest>("PATCH", `/requests/${id}/reject`, { handledBy });

interface ReportTypes {
  summary: SummaryReport;
  "money-by-hour": HourTotal[];
  "money-by-day": DayTotal[];
  "by-flavor": FlavorTotal[];
  "by-seller": SellerTotal[];
  combos: ComboTotal[];
  "refill-times": RefillTimesReport;
}

export function fetchReport<K extends keyof ReportTypes>(name: K): Promise<ReportResponse<ReportTypes[K]>> {
  return request<ReportResponse<ReportTypes[K]>>("GET", `/reports/${name}`);
}

export type ExplainQueryName = "recent" | "flavor";

export const explainQuery = (query: ExplainQueryName) => request<ExplainResult>("GET", `/demo/explain?query=${query}`);
export const startRush = () => request<RushResponse>("POST", "/demo/rush");
export const tryInvalidSales = () => request<InvalidSaleAttempt[]>("POST", "/demo/invalid-sale");
export const resetDemo = () => request<{ ok: boolean }>("POST", "/demo/reset");
