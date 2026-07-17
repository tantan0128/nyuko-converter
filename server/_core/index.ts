import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import processRouter from "../processRouter";
import syncRouter from "../syncRouter";
import gmailSchedulerRouter from "../gmailScheduler";
import { getSyncStatus, fetchFromSpreadsheet, syncProductsToDB } from "../sheets";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // Custom process router for OCR/AI processing
  app.use("/api", processRouter);
  // Sync router for product master sync
  app.use("/api", syncRouter);
  // Gmail scheduler router
  app.use("/api", gmailSchedulerRouter);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // 起動時に商品マスターDBが空の場合は自動同期
  try {
    const status = await getSyncStatus();
    if (status.count === 0) {
      console.log("[startup] 商品マスターDBが空 → スプレッドシートから自動同期開始");
      const records = await fetchFromSpreadsheet();
      const count = await syncProductsToDB(records);
      console.log(`[startup] 商品マスター自動同期完了: ${count}件`);
    } else {
      console.log(`[startup] 商品マスターDB: ${status.count}件 (最終同期: ${status.syncedAt?.toISOString()})`);
    }
  } catch (e) {
    console.warn("[startup] 商品マスター自動同期失敗:", e instanceof Error ? e.message : String(e));
  }
}

startServer().catch(console.error);
