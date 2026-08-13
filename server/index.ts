import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import fs from "fs";
import path from "path";
import { createServer as createViteServer } from "vite";
import cron from "node-cron";
import processRouter from "./processRouter";
import syncRouter from "./syncRouter";
import gmailSchedulerRouter, { processGmailPdfs } from "./gmailScheduler";
import { noteGmailRateLimit } from "./gmail";
import { getSyncStatus, fetchFromSpreadsheet, syncProductsToDB } from "./sheets";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
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

/** 開発モード: Viteミドルウェアを組み込む */
async function setupVite(app: express.Express, server: ReturnType<typeof createServer>) {
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server }, allowedHosts: true },
    appType: "custom",
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path.resolve(import.meta.dirname, "..", "client", "index.html");
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${Date.now()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

/** 本番モード: 静的ファイル配信 */
function serveStatic(app: express.Express) {
  const distPath = path.resolve(import.meta.dirname, "..", "dist", "public");
  if (!fs.existsSync(distPath)) {
    console.error(`Could not find the build directory: ${distPath}, make sure to build the client first`);
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

/** Gmail自動取り込みを5分ごとに実行する（Manus Heartbeat廃止 → node-cron） */
function startGmailScheduler() {
  if (!process.env.GMAIL_CLIENT_ID) {
    console.log("[cron] GMAIL_CLIENT_ID未設定のためGmail定期実行はスキップします");
    return;
  }
  cron.schedule("*/5 * * * *", async () => {
    try {
      const result = await processGmailPdfs();
      if (result.processed > 0 || result.errors.length > 0) {
        console.log(`[cron] Gmail処理: ${result.processed}件処理 / ${result.skipped}件スキップ / エラー${result.errors.length}件`);
      }
    } catch (e) {
      // 429（レート制限）はRetry afterを記録して以後スキップする（自己増幅防止）
      noteGmailRateLimit(e);
      console.error("[cron] Gmail定期処理エラー:", e instanceof Error ? e.message : String(e));
    }
  });
  console.log("[cron] Gmail自動取り込みを5分間隔でスケジュールしました");
}

/**
 * 商品マスターを毎日自動再同期する。
 * スプレッドシートのD列（納品書キーワード）・E列（仕入れ先）は
 * 日々少しずつ更新されるため、毎日自動でDBへ反映する。
 * スケジュールは SYNC_SCHEDULE 環境変数で変更可（cron式、デフォルト: 毎朝9時）。
 */
function startDailyProductSync() {
  const schedule = process.env.SYNC_SCHEDULE || "0 9 * * *";
  cron.schedule(schedule, async () => {
    try {
      console.log("[cron] 商品マスター自動再同期開始...");
      const records = await fetchFromSpreadsheet();
      const count = await syncProductsToDB(records);
      console.log(`[cron] 商品マスター自動再同期完了: ${count}件（${new Date().toISOString()}）`);
    } catch (e) {
      console.error("[cron] 商品マスター自動再同期失敗:", e instanceof Error ? e.message : String(e));
    }
  });
  console.log(`[cron] 商品マスター自動再同期をスケジュールしました（${schedule}）`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // 業務ルーター
  app.use("/api", processRouter);
  app.use("/api", syncRouter);
  app.use("/api", gmailSchedulerRouter);

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

  // Gmail定期実行スケジューラ
  startGmailScheduler();

  // 商品マスター毎日自動再同期（D列・E列の変更を自動反映）
  startDailyProductSync();
}

startServer().catch(console.error);
