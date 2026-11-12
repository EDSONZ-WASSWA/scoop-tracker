import { Router } from "express";
import { createRequest, fulfilRequest, listRequests, rejectRequest } from "../services/requestService.js";
import { toObjectId } from "../validate.js";

export const requestsRouter = Router();

requestsRouter.post("/", async (req, res) => {
  res.status(201).json(await createRequest(req.body));
});

requestsRouter.get("/", async (req, res) => {
  res.json(await listRequests(req.query.status));
});

requestsRouter.patch("/:id/fulfil", async (req, res) => {
  res.json(await fulfilRequest(toObjectId(req.params.id, "request id"), req.body));
});

requestsRouter.patch("/:id/reject", async (req, res) => {
  res.json(await rejectRequest(toObjectId(req.params.id, "request id"), req.body));
});
