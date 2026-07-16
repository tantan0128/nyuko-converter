import express from "express";
import { fetchFromSpreadsheet, syncProductsToDB, getSyncStatus, clearCache, appendDeliveryKeyword } from "./sheets";

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

/** 商品コード一覧（モーダル用） */
router.get("/product-codes", async (_req, res) => {
  try {
    const { loadProductMaster } = await import("./sheets");
    const products = await loadProductMaster();
    const codes = products
      .filter((p) => p.code && p.code !== "カスタム商品コード" && !/^商品/.test(p.code))
      .map((p) => ({
        code: p.code,
        name: p.nameKeywords.replace(/^◎/, "").replace(/^[　\s]+/, "").split(/[\r\n]/)[0].trim() || p.code,
      }));
    res.json(codes);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

/** 納品書キーワードをD列に追記しDB再同期 */
router.post("/register-keyword", express.json(), async (req, res) => {
  const { code, keyword } = req.body as { code: string; keyword: string };
  if (!code || !keyword) {
    return res.status(400).json({ error: "codeとkeywordは必須です" });
  }
  try {
    // スプレッドシートD列に追記
    const result = await appendDeliveryKeyword(code, keyword);
    if (!result.ok) {
      return res.status(500).json({ error: result.error });
    }
    // DB再同期
    const records = await fetchFromSpreadsheet();
    await syncProductsToDB(records);
    clearCache();
    res.json({ ok: true, message: `キーワード「${keyword}」を登録し、${records.length}件再同期しました` });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

export default router;
