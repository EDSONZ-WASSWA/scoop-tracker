import { Router } from "express";
import {
  byFlavorReport,
  bySellerReport,
  combosReport,
  moneyByDayReport,
  moneyByHourReport,
  refillTimesReport,
  summaryReport,
} from "../services/reportService.js";

export const reportsRouter = Router();

reportsRouter.get("/summary", async (_req, res) => {
  res.json(await summaryReport());
});

reportsRouter.get("/money-by-hour", async (_req, res) => {
  res.json(await moneyByHourReport());
});

reportsRouter.get("/money-by-day", async (_req, res) => {
  res.json(await moneyByDayReport());
});

reportsRouter.get("/by-flavor", async (_req, res) => {
  res.json(await byFlavorReport());
});

reportsRouter.get("/by-seller", async (_req, res) => {
  res.json(await bySellerReport());
});

reportsRouter.get("/combos", async (_req, res) => {
  res.json(await combosReport());
});

reportsRouter.get("/refill-times", async (_req, res) => {
  res.json(await refillTimesReport());
});
