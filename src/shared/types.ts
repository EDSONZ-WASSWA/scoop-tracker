export type FlavorCategory = "fruity" | "chocolatey" | "creamy" | "nutty" | "vegan";
export type Allergen = "milk" | "nuts" | "gluten" | "eggs";
export type Dietary = "vegan" | "dairy-free";
export type StockStatus = "green" | "orange" | "red" | "sold-out";
export type RequestStatus = "pending" | "fulfilled" | "rejected";
export type RequestPriority = "urgent" | "normal";
export type StockLogType = "sale" | "restock" | "adjustment" | "reset" | "rollback";

export interface Settings {
  scoopsPerSale: number;
  pricePerSale: number;
  currency: string;
}

// Fields every flavor document can have. The optional ones only exist on some
// documents, which is the flexible schema MongoDB allows.
export interface FlavorFields {
  name: string;
  colorHex: string;
  category: FlavorCategory;
  allergens: Allergen[];
  dietary: Dietary[];
  stockScoops: number;
  capacityScoops: number;
  lowThreshold: number;
  isActive: boolean;
  seasonal?: boolean;
  availableUntil?: string;
  plantBase?: string;
  containsNuts?: boolean;
  notes?: string;
  origin?: string;
}

export interface Flavor extends FlavorFields {
  _id: string;
  status: StockStatus;
  refillPending: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FlavorInput {
  name: string;
  colorHex: string;
  category: FlavorCategory;
  allergens: Allergen[];
  dietary: Dietary[];
  capacityScoops: number;
  lowThreshold: number;
  stockScoops?: number;
  isActive?: boolean;
  seasonal?: boolean;
  availableUntil?: string;
  plantBase?: string;
  notes?: string;
  origin?: string;
}

export interface FlavorFilters {
  q?: string;
  excludeAllergen?: Allergen | "";
  dietary?: Dietary | "";
  lowOnly?: boolean;
  includeInactive?: boolean;
}

export interface SaleItem {
  flavorId: string;
  flavorName: string;
  scoops: number;
}

export interface Sale {
  _id: string;
  receiptNo: string;
  items: SaleItem[];
  totalScoops: number;
  amount: number;
  soldBy: string;
  soldAt: string;
}

export interface SaleRequestItem {
  flavorId: string;
  scoops: number;
}

export interface SaleRequest {
  items: SaleRequestItem[];
  soldBy: string;
}

// A description of one database operation, sent to the browser for the
// "Show the query" panels.
export interface QueryInfo {
  collection: string;
  operation: string;
  filter?: unknown;
  update?: unknown;
  document?: unknown;
  pipeline?: unknown;
  note?: string;
}

export interface SaleResponse {
  sale: Sale;
  queries: QueryInfo[];
}

export interface TodaySummary {
  servings: number;
  scoops: number;
  money: number;
  latest: Sale[];
}

export interface RestockRequest {
  _id: string;
  flavorId: string;
  flavorName: string;
  requestedBy: string;
  requestedAt: string;
  stockAtRequest: number;
  quantityRequested: number;
  note: string;
  priority: RequestPriority;
  status: RequestStatus;
  handledBy?: string;
  handledAt?: string;
}

export interface StockLog {
  _id: string;
  flavorId: string;
  flavorName: string;
  type: StockLogType;
  change: number;
  balanceAfter: number;
  receiptNo?: string;
  at: string;
  by: string;
}

export interface ReportResponse<T> {
  data: T;
  query: QueryInfo;
}

export interface SalesTotals {
  money: number;
  servings: number;
  scoops: number;
}

export interface SummaryReport {
  today: SalesTotals;
  allTime: SalesTotals;
  settings: Settings;
}

export interface HourTotal {
  hour: number;
  money: number;
  servings: number;
}

export interface DayTotal {
  day: string;
  money: number;
  servings: number;
}

export interface FlavorTotal {
  flavorId: string;
  name: string;
  colorHex: string;
  scoops: number;
  servings: number;
  value: number;
}

export interface SellerTotal {
  seller: string;
  money: number;
  servings: number;
}

export interface ComboTotal {
  flavors: string[];
  servings: number;
}

export interface RefillFlavorCount {
  flavorName: string;
  total: number;
  pending: number;
  fulfilled: number;
  rejected: number;
}

export interface RefillTimesReport {
  averageMinutes: number | null;
  fulfilledCount: number;
  perFlavor: RefillFlavorCount[];
}

export interface ExplainRun {
  stage: string;
  keysExamined: number;
  docsExamined: number;
  returned: number;
  timeMs: number;
}

export interface ExplainResult {
  description: string;
  filter: unknown;
  indexName: string;
  totalDocuments: number;
  withIndex: ExplainRun;
  withoutIndex: ExplainRun;
}

export interface RushResponse {
  seconds: number;
}

export interface InvalidSaleAttempt {
  label: string;
  payload: SaleRequest;
  status: number;
  error: string;
}

export interface ApiError {
  error: string;
}
