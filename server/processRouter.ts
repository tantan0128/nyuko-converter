import express from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { ocrWithDocumentAI, extractWithGemini } from "./ocr";
import { loadProductMaster, matchByJan, matchByName } from "./sheets";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Password auth endpoint
router.post("/auth/login", express.json(), (req, res) => {
  const { password } = req.body;
  const appPassword = process.env.APP_PASSWORD || "nyuko2024";
  if (password === appPassword) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: "パスワードが正しくありません" });
  }
});

// Main process endpoint
router.post("/process", upload.array("files", 20), async (req, res) => {
  const mode = req.body.mode as string;
  const files = req.files as Express.Multer.File[];

  if (!files || files.length === 0) {
    return res.status(400).json({ error: "ファイルが選択されていません" });
  }

  const logs: string[] = [];
  const allRows: Array<{ code: string; stockType: string; quantity: number; date: string; time: string; note: string }> = [];
  const notFound: string[] = [];
  const errors: string[] = [];

  try {
    // Load product master
    logs.push("商品マスターを読み込み中...");
    let products: Awaited<ReturnType<typeof loadProductMaster>> = [];
    try {
      products = await loadProductMaster();
      logs.push(`商品マスター: ${products.length}件読み込み完了`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logs.push(`商品マスター読み込みエラー: ${msg}`);
      errors.push(`商品マスター: ${msg}`);
    }

    for (const file of files) {
      logs.push(`処理開始: ${file.originalname}`);

      try {
        if (mode === "junidou") {
          // CSV処理
          await processCSV(file, products, allRows, notFound, logs);
        } else if (mode === "sanyo") {
          // Excel処理
          await processExcel(file, products, allRows, notFound, logs);
        } else {
          // OCR + Gemini処理
          await processImageOrPDF(file, mode, products, allRows, notFound, errors, logs);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${file.originalname}: ${msg}`);
        logs.push(`エラー: ${file.originalname} - ${msg}`);
      }
    }

    res.json({ rows: allRows, notFound, errors, logs });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

async function processImageOrPDF(
  file: Express.Multer.File,
  mode: string,
  products: Awaited<ReturnType<typeof loadProductMaster>>,
  allRows: ReturnType<typeof buildRow>[],
  notFound: string[],
  errors: string[],
  logs: string[]
) {
  const mimeType = file.mimetype;
  let ocrText = "";
  let imageBase64: string | undefined;
  let imageMimeType: string | undefined;

  // Try Document AI OCR first
  const ocrResult = await ocrWithDocumentAI(file.buffer, mimeType);
  if (ocrResult.error) {
    logs.push(`Document AI: ${ocrResult.error} → Gemini画像直接処理に切り替え`);
    // Use image directly with Gemini
    imageBase64 = file.buffer.toString("base64");
    imageMimeType = mimeType;
  } else {
    ocrText = ocrResult.text;
    logs.push(`OCR完了: ${ocrText.length}文字抽出`);
  }

  // Extract with Gemini
  const extracted = await extractWithGemini(mode, ocrText, imageBase64, imageMimeType);
  if (extracted.error) {
    errors.push(`${file.originalname}: ${extracted.error}`);
    logs.push(`Gemini抽出エラー: ${extracted.error}`);
    return;
  }

  logs.push(`Gemini抽出: ${extracted.items.length}件`);

  const dateStr = extracted.date || formatDate(new Date());
  const useProductName = mode === "productname_jpg";

  for (const item of extracted.items) {
    if (item.quantity <= 0) continue;

    let code: string | null = null;

    // JAN照合
    if (item.jan && item.jan.length >= 8) {
      code = matchByJan(item.jan, products);
      if (code) {
        logs.push(`JAN照合成功: ${item.jan} → ${code}`);
      } else {
        logs.push(`JAN未登録: ${item.jan}`);
      }
    }

    // 商品名照合（JANが未登録またはモードがproductname_jpg）
    if (!code && (useProductName || !item.jan)) {
      if (item.productName) {
        code = matchByName(item.productName, products);
        if (code) {
          logs.push(`商品名照合成功: ${item.productName} → ${code}`);
        }
      }
    }

    if (code) {
      allRows.push(buildRow(code, item.quantity, dateStr));
    } else {
      const label = item.jan ? `JAN:${item.jan}` : item.productName || "不明";
      notFound.push(`${label} (数量:${item.quantity})`);
    }
  }
}

async function processCSV(
  file: Express.Multer.File,
  products: Awaited<ReturnType<typeof loadProductMaster>>,
  allRows: ReturnType<typeof buildRow>[],
  notFound: string[],
  logs: string[]
) {
  // Detect encoding (try UTF-8 first, then Shift-JIS)
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(file.buffer);
  } catch {
    text = new TextDecoder("shift-jis").decode(file.buffer);
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  logs.push(`CSV行数: ${lines.length}`);

  let dateStr = formatDate(new Date());

  for (const line of lines) {
    const cols = line.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
    if (cols.length < 2) continue;

    // Try to find JAN (13-digit number) in columns
    let jan = "";
    let qty = 0;
    let productName = "";

    for (const col of cols) {
      if (/^\d{13}$/.test(col)) jan = col;
      else if (/^\d{4}[\/-]\d{2}[\/-]\d{2}$/.test(col)) dateStr = col.replace(/\//g, "/");
    }

    // Quantity: look for numeric column
    const numCols = cols.filter((c) => /^\d+$/.test(c) && c.length < 6);
    if (numCols.length > 0) qty = parseInt(numCols[numCols.length - 1], 10);

    // Product name: longest non-numeric, non-JAN column
    const textCols = cols.filter((c) => c.length > 2 && !/^\d+$/.test(c) && c !== jan);
    if (textCols.length > 0) productName = textCols.sort((a, b) => b.length - a.length)[0];

    if (qty <= 0) continue;

    let code = jan ? matchByJan(jan, products) : null;
    if (!code && productName) code = matchByName(productName, products);

    if (code) {
      allRows.push(buildRow(code, qty, dateStr));
      logs.push(`CSV照合成功: ${jan || productName} → ${code}`);
    } else {
      notFound.push(`${jan || productName} (数量:${qty})`);
    }
  }
}

async function processExcel(
  file: Express.Multer.File,
  products: Awaited<ReturnType<typeof loadProductMaster>>,
  allRows: ReturnType<typeof buildRow>[],
  notFound: string[],
  logs: string[]
) {
  const workbook = XLSX.read(file.buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

  logs.push(`Excel行数: ${rows.length}`);
  let dateStr = formatDate(new Date());

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;

    let jan = "";
    let qty = 0;
    let productName = "";

    for (const cell of row) {
      const s = String(cell || "").trim();
      if (/^\d{13}$/.test(s)) jan = s;
      else if (/^\d{4}[\/-]\d{2}[\/-]\d{2}$/.test(s)) dateStr = s;
    }

    const numCells = row
      .map((c) => Number(c))
      .filter((n) => !isNaN(n) && n > 0 && n < 100000);
    if (numCells.length > 0) qty = numCells[numCells.length - 1];

    const textCells = row
      .map((c) => String(c || "").trim())
      .filter((s) => s.length > 2 && !/^\d+$/.test(s) && s !== jan);
    if (textCells.length > 0) productName = textCells.sort((a, b) => b.length - a.length)[0];

    if (qty <= 0) continue;

    let code = jan ? matchByJan(jan, products) : null;
    if (!code && productName) code = matchByName(productName, products);

    if (code) {
      allRows.push(buildRow(code, qty, dateStr));
      logs.push(`Excel照合成功: ${jan || productName} → ${code}`);
    } else {
      notFound.push(`${jan || productName} (数量:${qty})`);
    }
  }
}

function buildRow(code: string, quantity: number, date: string) {
  return {
    code,
    stockType: "通常在庫",
    quantity,
    date: date.replace(/\//g, "/"),
    time: "00:00",
    note: "",
  };
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export default router;
