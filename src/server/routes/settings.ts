import { Router } from "express";
import { getSettings, updateSettings } from "../services/settingsService.js";

export const settingsRouter = Router();

settingsRouter.get("/", async (_req, res) => {
  res.json(await getSettings());
});

settingsRouter.put("/", async (req, res) => {
  res.json(await updateSettings(req.body));
});
