import express from "express";
import { fetchFromSpreadsheet, syncProductsToDB, getSyncStatus, clearCache } from "./sheets";

const router = express.Router();

/** 同期状況確認 */
router.get("/sync-status", async (_req, res) => {
  try {
    const status = await getSyncStatus();
    res.json({
      count: status.count,
      syncedAt: status.syncedAt ? status.syncedAt.toISOString() : null,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

/** スプレッドシートからDBへ同期 */
router.post("/sync-products", async (_req, res) => {
  try {
    const records = await fetchFromSpreadsheet();
    const count = await syncProductsToDB(records);
    clearCache();
    res.json({ ok: true, count, message: `${count}件の商品マスターを同期しました` });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

export default router;
