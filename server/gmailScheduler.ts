/**
 * Gmail自動処理スケジューラー
 * Heartbeat（5分ごと）でGmailを監視し、PDF添付メールを自動処理する
 */
import express from "express";
import { fetchUnprocessedPdfEmails, markAsProcessed, testGmailConnection } from "./gmail";
import { loadProductMaster, matchByJan } from "./sheets";
import { ocrWithDocumentAI, extractWithGemini, ExtractedItem } from "./ocr";
import { getDb } from "./db";
import { gmailJobs } from "../drizzle/schema";
import { desc } from "drizzle-orm";

const router = express.Router();

/** Gmail接続テスト */
router.get("/gmail-status", async (_req, res) => {
  const result = await testGmailConnection();
  res.json(result);
});

/** 処理済みジョブ一覧 */
router.get("/gmail-jobs", async (_req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.json([]);
    const jobs = await db.select().from(gmailJobs).orderBy(desc(gmailJobs.processedAt)).limit(50);
    res.json(jobs);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

/** 手動実行エンドポイント（テスト用） */
router.post("/gmail-fetch-now", async (_req, res) => {
  try {
    const result = await processGmailPdfs();
    res.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

/** Heartbeatコールバック（5分ごとに自動実行） */
router.post("/scheduled/gmail-fetch", async (req, res) => {
  try {
    const result = await processGmailPdfs();
    res.json({ ok: true, ...result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg, timestamp: new Date().toISOString() });
  }
});

/** Gmail PDFを取得して処理するメイン関数 */
export async function processGmailPdfs(): Promise<{
  processed: number;
  skipped: number;
  errors: string[];
  jobs: Array<{ filename: string; from: string; rows: number; notFound: number }>;
}> {
  const errors: string[] = [];
  const jobResults: Array<{ filename: string; from: string; rows: number; notFound: number }> = [];
  let processed = 0;
  let skipped = 0;

  // 商品マスター読み込み
  const products = await loadProductMaster();

  // 未処理PDFメールを取得
  const attachments = await fetchUnprocessedPdfEmails();

  if (attachments.length === 0) {
    return { processed: 0, skipped: 0, errors: [], jobs: [] };
  }

  const db = await getDb();

  for (const att of attachments) {
    try {
      // OCR処理
      const ocrResult = await ocrWithDocumentAI(att.data, att.mimeType);
      let ocrText = ocrResult.text || "";
      let imageBase64: string | undefined;
      let imageMimeType: string | undefined;

      if (ocrResult.error) {
        // PDFをbase64に変換してGeminiに直接送る
        imageBase64 = att.data.toString("base64");
        imageMimeType = att.mimeType;
      }

      // Gemini抽出（JANモードで処理）
      const extracted = await extractWithGemini("jan_pdf", ocrText, imageBase64, imageMimeType);

      if (extracted.error) {
        errors.push(`${att.filename}: ${extracted.error}`);
        skipped++;
        continue;
      }

      const dateStr = extracted.date || formatDate(new Date());
      const rows: Array<{ code: string; stockType: string; quantity: number; date: string; time: string; note: string }> = [];
      const notFoundItems: string[] = [];

      for (const item of extracted.items) {
        if (item.quantity <= 0) continue;
        let code: string | null = null;

        if (item.jan && item.jan.length >= 8) {
          code = matchByJan(item.jan, products);
        }

        if (code) {
          rows.push({ code, stockType: "通常在庫", quantity: item.quantity, date: dateStr, time: "00:00", note: "" });
        } else {
          notFoundItems.push(item.jan ? `JAN:${item.jan}` : item.productName || "不明");
        }
      }

      // 同一コードの数量合算
      const mergedRows = mergeRowsByCode(rows);

      // CSV生成
      const csvContent = generateCsv(mergedRows);

      // DBに保存
      if (db) {
        await db.insert(gmailJobs).values({
          messageId: att.messageId,
          subject: att.subject,
          fromEmail: att.from,
          filename: att.filename,
          processedAt: new Date(),
          rowCount: mergedRows.length,
          notFoundCount: notFoundItems.length,
          csvContent,
          status: "done",
        });
      }

      // 処理済みラベルを付ける
      await markAsProcessed(att.messageId);

      jobResults.push({
        filename: att.filename,
        from: att.from,
        rows: mergedRows.length,
        notFound: notFoundItems.length,
      });
      processed++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${att.filename}: ${msg}`);
      skipped++;
    }
  }

  return { processed, skipped, errors, jobs: jobResults };
}

function mergeRowsByCode(
  rows: Array<{ code: string; stockType: string; quantity: number; date: string; time: string; note: string }>
) {
  const map = new Map<string, typeof rows[0]>();
  for (const row of rows) {
    const key = `${row.code}__${row.date}`;
    if (map.has(key)) {
      map.get(key)!.quantity += row.quantity;
    } else {
      map.set(key, { ...row });
    }
  }
  return Array.from(map.values());
}

function generateCsv(rows: Array<{ code: string; stockType: string; quantity: number; date: string; time: string; note: string }>) {
  const header = "自社商品コード,在庫指定,在庫数,入庫日,入庫時間,備考";
  const lines = rows.map((r) =>
    [r.code, r.stockType, r.quantity, r.date, r.time, r.note]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header, ...lines].join("\n");
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export default router;
