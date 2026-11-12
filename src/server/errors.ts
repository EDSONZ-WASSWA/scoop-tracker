import type { NextFunction, Request, Response } from "express";
import { MongoServerError } from "mongodb";
import type { ApiError } from "../shared/types.js";

const DUPLICATE_KEY_CODE = 11000;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === DUPLICATE_KEY_CODE;
}

export function apiNotFound(req: Request, _res: Response, next: NextFunction): void {
  next(new HttpError(404, `No API route for ${req.method} ${req.originalUrl}`));
}

function isBodyParseError(error: unknown): boolean {
  return error instanceof SyntaxError && "body" in error;
}

// Express 5 forwards errors thrown in async route handlers to this middleware,
// so the routes themselves do not need try/catch blocks.
export function errorHandler(error: unknown, _req: Request, res: Response<ApiError>, _next: NextFunction): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (isBodyParseError(error)) {
    res.status(400).json({ error: "The request body is not valid JSON" });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "Something went wrong on the server" });
}
