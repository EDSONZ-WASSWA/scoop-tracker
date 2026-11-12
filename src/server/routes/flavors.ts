import { Router } from "express";
import { createFlavor, deactivateFlavor, listFlavors, toFlavorResponse, updateFlavor } from "../services/flavorService.js";
import { adjustStock, fillToCapacity } from "../services/stockService.js";
import { asBody, personName, requireInteger, toObjectId } from "../validate.js";

const MAX_STOCK = 500;

export const flavorsRouter = Router();

flavorsRouter.get("/", async (req, res) => {
  res.json(await listFlavors(req.query));
});

flavorsRouter.post("/", async (req, res) => {
  res.status(201).json(await createFlavor(req.body));
});

flavorsRouter.put("/:id", async (req, res) => {
  res.json(await updateFlavor(toObjectId(req.params.id, "flavor id"), req.body));
});

flavorsRouter.patch("/:id/deactivate", async (req, res) => {
  res.json(await deactivateFlavor(toObjectId(req.params.id, "flavor id")));
});

flavorsRouter.post("/:id/fill", async (req, res) => {
  const by = personName(asBody(req.body ?? {}), "by", "Stock manager");
  const flavor = await fillToCapacity(toObjectId(req.params.id, "flavor id"), by);
  res.json(toFlavorResponse(flavor));
});

flavorsRouter.post("/:id/adjust", async (req, res) => {
  const body = asBody(req.body);
  const newStock = requireInteger(body, "stockScoops", 0, MAX_STOCK);
  const flavor = await adjustStock(toObjectId(req.params.id, "flavor id"), newStock, personName(body, "by", "Stock manager"));
  res.json(toFlavorResponse(flavor));
});
