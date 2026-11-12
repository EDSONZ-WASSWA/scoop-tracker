import type { Document } from "mongodb";
import type {
  ComboTotal,
  DayTotal,
  FlavorTotal,
  HourTotal,
  ReportResponse,
  RefillFlavorCount,
  RefillTimesReport,
  SalesTotals,
  SellerTotal,
  SummaryReport,
} from "../../shared/types.js";
import { collections } from "../db.js";
import { msToMinutes, startOfDaysAgo, startOfToday, TIME_ZONE } from "../dates.js";
import { getSettings, scoopValue } from "./settingsService.js";

const DAYS_IN_WEEK_REPORT = 7;
const COMBO_LIMIT = 10;
const UNKNOWN_FLAVOR_COLOR = "#CCCCCC";

const EMPTY_TOTALS: SalesTotals = { money: 0, servings: 0, scoops: 0 };

const totalsGroup: Document = {
  $group: { _id: null, money: { $sum: "$amount" }, servings: { $sum: 1 }, scoops: { $sum: "$totalScoops" } },
};
const totalsProject: Document = { $project: { _id: 0, money: { $round: ["$money", 2] }, servings: 1, scoops: 1 } };

function salesReport<T>(pipeline: Document[], data: T): ReportResponse<T> {
  return { data, query: { collection: "sales", operation: "aggregate", pipeline } };
}

async function runSalesPipeline<T extends Document>(pipeline: Document[]): Promise<T[]> {
  return collections.sales().aggregate<T>(pipeline).toArray();
}

export async function summaryReport(): Promise<ReportResponse<SummaryReport>> {
  const pipeline: Document[] = [
    {
      $facet: {
        today: [{ $match: { soldAt: { $gte: startOfToday() } } }, totalsGroup, totalsProject],
        allTime: [totalsGroup, totalsProject],
      },
    },
  ];
  const [result] = await runSalesPipeline<{ today: SalesTotals[]; allTime: SalesTotals[] }>(pipeline);
  const settings = await getSettings();
  return salesReport(pipeline, {
    today: result?.today[0] ?? EMPTY_TOTALS,
    allTime: result?.allTime[0] ?? EMPTY_TOTALS,
    settings,
  });
}

export async function moneyByHourReport(): Promise<ReportResponse<HourTotal[]>> {
  const pipeline: Document[] = [
    {
      $group: {
        _id: { $hour: { date: "$soldAt", timezone: TIME_ZONE } },
        money: { $sum: "$amount" },
        servings: { $sum: 1 },
      },
    },
    { $project: { _id: 0, hour: "$_id", money: { $round: ["$money", 2] }, servings: 1 } },
    { $sort: { hour: 1 } },
  ];
  return salesReport(pipeline, await runSalesPipeline<HourTotal>(pipeline));
}

function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// Days without sales are missing from the aggregation result, so they are
// added here with zero to keep the chart at seven bars.
function fillMissingDays(totals: DayTotal[]): DayTotal[] {
  return Array.from({ length: DAYS_IN_WEEK_REPORT }, (_, index) => {
    const day = localDayKey(startOfDaysAgo(DAYS_IN_WEEK_REPORT - 1 - index));
    return totals.find((total) => total.day === day) ?? { day, money: 0, servings: 0 };
  });
}

export async function moneyByDayReport(): Promise<ReportResponse<DayTotal[]>> {
  const pipeline: Document[] = [
    { $match: { soldAt: { $gte: startOfDaysAgo(DAYS_IN_WEEK_REPORT - 1) } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$soldAt", timezone: TIME_ZONE } },
        money: { $sum: "$amount" },
        servings: { $sum: 1 },
      },
    },
    { $project: { _id: 0, day: "$_id", money: { $round: ["$money", 2] }, servings: 1 } },
    { $sort: { day: 1 } },
  ];
  return salesReport(pipeline, fillMissingDays(await runSalesPipeline<DayTotal>(pipeline)));
}

export async function byFlavorReport(): Promise<ReportResponse<FlavorTotal[]>> {
  const valuePerScoop = scoopValue(await getSettings());
  const pipeline: Document[] = [
    // $unwind turns one serving with three flavors into three rows, one per flavor.
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.flavorId",
        name: { $first: "$items.flavorName" },
        scoops: { $sum: "$items.scoops" },
        servings: { $sum: 1 },
      },
    },
    { $lookup: { from: "flavors", localField: "_id", foreignField: "_id", as: "flavor" } },
    {
      $project: {
        _id: 0,
        flavorId: "$_id",
        name: 1,
        scoops: 1,
        servings: 1,
        colorHex: { $ifNull: [{ $first: "$flavor.colorHex" }, UNKNOWN_FLAVOR_COLOR] },
        value: { $round: [{ $multiply: ["$scoops", valuePerScoop] }, 2] },
      },
    },
    { $sort: { scoops: -1, name: 1 } },
  ];
  return salesReport(pipeline, await runSalesPipeline<FlavorTotal>(pipeline));
}

export async function bySellerReport(): Promise<ReportResponse<SellerTotal[]>> {
  const pipeline: Document[] = [
    { $group: { _id: "$soldBy", money: { $sum: "$amount" }, servings: { $sum: 1 } } },
    { $project: { _id: 0, seller: "$_id", money: { $round: ["$money", 2] }, servings: 1 } },
    { $sort: { money: -1, seller: 1 } },
  ];
  return salesReport(pipeline, await runSalesPipeline<SellerTotal>(pipeline));
}

export async function combosReport(): Promise<ReportResponse<ComboTotal[]>> {
  const pipeline: Document[] = [
    // Sorting the names makes "Mango + Vanilla" and "Vanilla + Mango" the same group.
    { $project: { flavors: { $sortArray: { input: "$items.flavorName", sortBy: 1 } } } },
    { $group: { _id: "$flavors", servings: { $sum: 1 } } },
    { $sort: { servings: -1, _id: 1 } },
    { $limit: COMBO_LIMIT },
    { $project: { _id: 0, flavors: "$_id", servings: 1 } },
  ];
  return salesReport(pipeline, await runSalesPipeline<ComboTotal>(pipeline));
}

function countStatus(status: string): Document {
  return { $sum: { $cond: [{ $eq: ["$status", status] }, 1, 0] } };
}

export async function refillTimesReport(): Promise<ReportResponse<RefillTimesReport>> {
  const pipeline: Document[] = [
    {
      $facet: {
        waits: [
          { $match: { status: "fulfilled" } },
          {
            $group: {
              _id: null,
              averageMs: { $avg: { $subtract: ["$handledAt", "$requestedAt"] } },
              count: { $sum: 1 },
            },
          },
        ],
        perFlavor: [
          {
            $group: {
              _id: "$flavorName",
              total: { $sum: 1 },
              pending: countStatus("pending"),
              fulfilled: countStatus("fulfilled"),
              rejected: countStatus("rejected"),
            },
          },
          { $project: { _id: 0, flavorName: "$_id", total: 1, pending: 1, fulfilled: 1, rejected: 1 } },
          { $sort: { total: -1, flavorName: 1 } },
        ],
      },
    },
  ];
  const [result] = await collections
    .requests()
    .aggregate<{ waits: { averageMs: number; count: number }[]; perFlavor: RefillFlavorCount[] }>(pipeline)
    .toArray();
  const wait = result?.waits[0];
  return {
    data: {
      averageMinutes: wait ? msToMinutes(wait.averageMs) : null,
      fulfilledCount: wait?.count ?? 0,
      perFlavor: result?.perFlavor ?? [],
    },
    query: { collection: "restock_requests", operation: "aggregate", pipeline },
  };
}
