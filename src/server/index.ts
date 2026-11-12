import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "node:path";
import { closeDatabase, connectToDatabase, ensureIndexes } from "./db.js";
import { apiNotFound, errorHandler } from "./errors.js";
import { demoRouter } from "./routes/demo.js";
import { flavorsRouter } from "./routes/flavors.js";
import { reportsRouter } from "./routes/reports.js";
import { requestsRouter } from "./routes/requests.js";
import { salesRouter } from "./routes/sales.js";
import { settingsRouter } from "./routes/settings.js";

const DEFAULT_PORT = 3000;
const port = Number(process.env.PORT ?? DEFAULT_PORT);

function createApp(): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.resolve("public")));

  app.use("/api/settings", settingsRouter);
  app.use("/api/flavors", flavorsRouter);
  app.use("/api/sales", salesRouter);
  app.use("/api/requests", requestsRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/demo", demoRouter);
  app.use("/api", apiNotFound);

  app.use(errorHandler);
  return app;
}

async function start(): Promise<void> {
  try {
    await connectToDatabase();
    await ensureIndexes();
  } catch (error) {
    console.error("Could not connect to MongoDB. Is the MongoDB service running?");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const server = createApp().listen(port, () => {
    console.log(`Scoop Tracker is running at http://localhost:${port}`);
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") console.error(`Port ${port} is already in use. Change PORT in .env.`);
    else console.error(error);
    process.exit(1);
  });

  process.on("SIGINT", async () => {
    server.close();
    await closeDatabase();
    process.exit(0);
  });
}

void start();
