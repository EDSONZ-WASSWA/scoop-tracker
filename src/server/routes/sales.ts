import { Router } from "express";
import { createSale, getTodaySummary } from "../services/salesService.js";

export const salesRouter = Router();

salesRouter.post("/", async (req, res) => {
  res.status(201).json(await createSale(req.body));
});

salesRouter.get("/today", async (_req, res) => {
  res.json(await getTodaySummary());
});
