import { Router } from "express";
import { explainQuery, resetDemoData, runInvalidSales, startRush } from "../services/demoService.js";

export const demoRouter = Router();

demoRouter.get("/explain", async (req, res) => {
  res.json(await explainQuery(req.query.query));
});

demoRouter.post("/rush", (_req, res) => {
  res.status(202).json({ seconds: startRush() });
});

demoRouter.post("/invalid-sale", async (req, res) => {
  res.json(await runInvalidSales(`${req.protocol}://${req.get("host")}`));
});

demoRouter.post("/reset", async (_req, res) => {
  await resetDemoData();
  res.json({ ok: true });
});
