/**
 * Gmail自動処理スケジューラー
 * Heartbeat（5分ごと）でGmailを監視し、PDF添付メールを自動処理する
 */
import express from "express";
import { fetchUnprocessedPdfEmails, markAsProcessed, testGmailConnection } from "./gmail";
import { loadProductMaster, matchByJan, matchByName, matchBySupplierCode, guessSupplierPrefix, appendDeliveryKeyword, VENDOR_CODE_TO_NAME, normalizeSupplierName, supplierNameFromMaster } from "./sheets";
import { extractWithGemini, ExtractedItem } from "./ocr";
import { getDb } from "./db";
import { gmailJobs } from "../drizzle/schema";
import { desc, eq } from "drizzle-orm";

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

/** CSVダウンロード済みフラグを記録 */
router.post("/gmail-jobs/:id/downloaded", async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.json({ ok: false });
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "invalid id" });
    await db.update(gmailJobs).set({ downloadedAt: new Date() }).where(eq(gmailJobs.id, id));
    res.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

/** Gmailデバッグ：メール一覧確認（ラベルIDベース） */
router.get("/gmail-debug", async (_req, res) => {
  try {
    const { google } = await import("googleapis");
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    const oauth2Client = new (google.auth.OAuth2 as any)(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: "me" });

    // ラベル一覧を取得
    const labelsRes = await gmail.users.labels.list({ userId: "me" });
    const allLabels = labelsRes.data.labels || [];
    const nyukoLabel = allLabels.find((l: any) => l.name === "nyuko-processed");
    const processedLabelId = nyukoLabel?.id || null;

    // has:attachmentで全件取得
    const listRes = await gmail.users.messages.list({ userId: "me", q: "has:attachment", maxResults: 20 });
    const messages = listRes.data.messages || [];

    const details = [];
    let unprocessedCount = 0;
    for (const msg of messages.slice(0, 10)) {
      const m = await gmail.users.messages.get({ userId: "me", id: msg.id!, format: "metadata", metadataHeaders: ["Subject", "From", "Date"] });
      const headers = m.data.payload?.headers || [];
      const subject = headers.find((h: any) => h.name === "Subject")?.value || "";
      const from = headers.find((h: any) => h.name === "From")?.value || "";
      const date = headers.find((h: any) => h.name === "Date")?.value || "";
      const msgLabels = m.data.labelIds || [];
      const isProcessed = processedLabelId ? msgLabels.includes(processedLabelId) : false;
      if (!isProcessed) unprocessedCount++;
      details.push({ id: msg.id, subject, from, date, labels: msgLabels, isProcessed });
    }
    res.json({
      email: profile.data.emailAddress,
      totalMessages: profile.data.messagesTotal,
      processedLabelId,
      unprocessedCount,
      messages: details,
    });
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
      // Gemini直接処理（Document AI廃止）
      // PDFはS3経由でfile_url、画像はimage_urlでGeminiに直接渡す（最高精度）
      let extracted = await extractWithGemini(
        "jan_pdf",
        "",
        undefined,
        undefined,
        att.data,
        att.mimeType
      );

      // JANモードで全件未照合の場合は商品名モードで再試行
      if (!extracted.error && extracted.items.length > 0) {
        const hasJan = extracted.items.some(item => item.jan && item.jan.length >= 8);
        if (!hasJan) {
          // JANコードが1件も取れなかった → 商品名モードで再抽出
          extracted = await extractWithGemini(
            "name_pdf",
            "",
            undefined,
            undefined,
            att.data,
            att.mimeType
          );
        }
      }

      if (extracted.error) {
        // エラーでも抽出できた商品があれば未照合として処理を継続
        if (!extracted.items || extracted.items.length === 0) {
          errors.push(`${att.filename}: ${extracted.error}`);
          skipped++;
          continue;
        }
        errors.push(`${att.filename}: 部分抽出 (${extracted.items.length}件) - ${extracted.error}`);
      }

      // 仕入元プレフィックスを推定
      let supplierPrefix = extracted.supplier ? guessSupplierPrefix(extracted.supplier) : null;

      // OCRで会社名が読み取れなかった場合、商品コードのベンダーコードから推定
      if (!supplierPrefix && extracted.items.length > 0) {
        // 商品コードのベンダープレフィックス（ハイフン前の小文字アルファベット）を集計
        const prefixCounts: Record<string, number> = {};
        for (const item of extracted.items) {
          if (item.supplierCode) {
            const m = item.supplierCode.match(/^([a-z]{2,3})-/i);
            if (m) {
              const p = m[1].toLowerCase();
              prefixCounts[p] = (prefixCounts[p] || 0) + 1;
            }
          }
        }
        // 最多数のプレフィックスを使用
        const topPrefix = Object.entries(prefixCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (topPrefix && VENDOR_CODE_TO_NAME[topPrefix]) {
          supplierPrefix = topPrefix;
          if (!extracted.supplier) {
            extracted = { ...extracted, supplier: VENDOR_CODE_TO_NAME[topPrefix] };
          }
        }
      }

      const dateStr = extracted.date || formatDate(new Date());
      const rows: Array<{ code: string; stockType: string; quantity: number; date: string; time: string; note: string }> = [];
      const notFoundItems: Array<{ label: string; quantity: number }> = [];
      const detectedSupplierName = extracted.supplier || undefined;

      for (const item of extracted.items) {
        if (item.quantity <= 0) continue;
        let code: string | null = null;
        let matchedByJan = false;

        // ステップ1: JAN完全一致（一意キーなので絞り込みしない）
        if (item.jan && item.jan.length >= 8) {
          code = matchByJan(item.jan, products);
          if (code) matchedByJan = true;
        }

        // JANがあるのに未登録かどうかのフラグ
        const hasJanCode = !!(item.jan && item.jan.length >= 8);

        // ステップ2: 仕入先品番コードで照合（JANがあるのに未登録の場合はスキップ）
        if (!code && item.supplierCode && !hasJanCode) {
          code = matchBySupplierCode(
            item.supplierCode,
            products,
            supplierPrefix ?? undefined,
            detectedSupplierName
          );
        }

        // ステップ3: 仕入先絞り込みで商品名照合（JANがあるのに未登録の場合はスキップ）
        if (!code && item.productName && !hasJanCode) {
          code = matchByName(
            item.productName,
            products,
            supplierPrefix ?? undefined,
            detectedSupplierName
          );
        }

        // ステップ4: 全体から商品名照合（JANがあるのに未登録の場合はスキップ）
        if (!code && item.productName && !hasJanCode) {
          code = matchByName(item.productName, products);
        }

        if (code) {
          rows.push({ code, stockType: "通常在庫", quantity: item.quantity, date: dateStr, time: "00:00", note: "" });
          // 品番で照合成功した場合のみ、その品番をD列に自動追記する（学習）。
          // 商品名（あいまい照合）での自動追記は誤照合の自己増殖を防ぐため行わない。
          if (!matchedByJan && item.supplierCode) {
            appendDeliveryKeyword(code, item.supplierCode).catch((e) =>
              console.warn(`[gmail] D列記入スキップ: ${e instanceof Error ? e.message : String(e)}`)
            );
          }
        } else {
          // 未照合ラベル：商品名・JAN・品番を全て含める
          const parts: string[] = [];
          if (item.productName) parts.push(item.productName);
          if (item.supplierCode) parts.push(`[品番:${item.supplierCode}]`);
          if (item.jan) parts.push(`[JAN:${item.jan}]`);
          const label = parts.length > 0 ? parts.join(" ") : "不明";
          notFoundItems.push({ label, quantity: item.quantity });
        }
      }

      // 同一コードの数量合算
      const mergedRows = mergeRowsByCode(rows);

      // 仕入先名の解決:
      // 1. OCR抽出した仕入先名を正規化
      // 2. 照合済み商品コードのE列（仕入れ先）の実データを最優先（ユーザー指定）
      // 3. E列が空の場合はプレフィックス逆引き（RAKUMART等の誤検出対策）
      let resolvedSupplier = "";
      if (extracted.supplier) {
        const normalized = normalizeSupplierName(extracted.supplier);
        if (normalized) resolvedSupplier = normalized;
      }
      // E列の実データを最優先（CSV出力の名前は必ずE列から）
      if (rows.length > 0) {
        const fromMaster = supplierNameFromMaster(rows[0].code, products);
        if (fromMaster) {
          resolvedSupplier = fromMaster;
        } else {
          // E列が空の場合はプレフィックス逆引き
          const matchedPrefixCounts: Record<string, number> = {};
          for (const row of rows) {
            const m = row.code.match(/^([a-z]{2,3})-/i);
            if (m) {
              const p = m[1].toLowerCase();
              matchedPrefixCounts[p] = (matchedPrefixCounts[p] || 0) + 1;
            }
          }
          const topMatchedPrefix = Object.entries(matchedPrefixCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
          if (topMatchedPrefix && VENDOR_CODE_TO_NAME[topMatchedPrefix]) {
            resolvedSupplier = VENDOR_CODE_TO_NAME[topMatchedPrefix];
          }
        }
      }
      if (resolvedSupplier) {
        extracted = { ...extracted, supplier: resolvedSupplier };
      }

      // CSV生成（備考列に仕入れ元名を追加）
      const supplierName = extracted.supplier || "";
      const mergedRowsWithSupplier = mergedRows.map(r => ({ ...r, note: supplierName }));
      const csvContent = generateCsv(mergedRowsWithSupplier);

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
          notFoundContent: notFoundItems.length > 0 ? JSON.stringify(notFoundItems) : null,
          supplier: extracted.supplier || null,
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
