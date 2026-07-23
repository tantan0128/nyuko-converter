import express from "express";
import multer from "multer";
import iconv from "iconv-lite";
import { ocrWithDocumentAI, extractWithGemini } from "./ocr";
import { loadProductMaster, matchByJan, matchByName, matchBySupplierCode, guessSupplierPrefix, appendDeliveryKeyword, appendKeywordByName, fetchJunidouList } from "./sheets";

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
  const notFound: Array<{ label: string; productName: string; quantity: number }> = [];
  const errors: string[] = [];
  let detectedSupplier = ""; // Geminiが抽出した仕入先名

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
        const supplier = await processImageOrPDF(file, mode, products, allRows, notFound, errors, logs);
        if (supplier && !detectedSupplier) detectedSupplier = supplier;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${file.originalname}: ${msg}`);
        logs.push(`エラー: ${file.originalname} - ${msg}`);
      }
    }

    // 同一コードの数量を合算して1行にまとめる
    const mergedRows = mergeRowsByCode(allRows);
    logs.push(`合算後: ${mergedRows.length}件（合算前: ${allRows.length}件）`);

    res.json({ rows: mergedRows, notFound, errors, logs, supplier: detectedSupplier });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

type NotFoundItem = { label: string; productName: string; quantity: number };

async function processImageOrPDF(
  file: Express.Multer.File,
  mode: string,
  products: Awaited<ReturnType<typeof loadProductMaster>>,
  allRows: ReturnType<typeof buildRow>[],
  notFound: NotFoundItem[],
  errors: string[],
  logs: string[]
): Promise<string | undefined> {
  const mimeType = file.mimetype;
  let ocrText = "";
  let imageBase64: string | undefined;
  let imageMimeType: string | undefined;

  // Try Document AI OCR first
  const ocrResult = await ocrWithDocumentAI(file.buffer, mimeType);
  if (ocrResult.error) {
    logs.push(`Document AI: ${ocrResult.error} → Gemini画像直接処理に切り替え`);
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
    return undefined;
  }

  logs.push(`Gemini抽出: ${extracted.items.length}件`);

  const dateStr = extracted.date || formatDate(new Date());
  // name_pdf モードは商品名・商品コードで照合
  const useProductName = mode === "name_pdf";

  // 仕入元プレフィックスを推定（仕入先名がある場合）
  const supplierPrefix = extracted.supplier ? guessSupplierPrefix(extracted.supplier) : null;
  if (supplierPrefix) {
    logs.push(`仕入元推定: ${extracted.supplier} → プレフィックス「${supplierPrefix}-」で絞り込み`);
  }

  const detectedSupplierName = extracted.supplier || undefined;

    for (const item of extracted.items) {
    if (item.quantity <= 0) continue;

    let code: string | null = null;
    let matchedByJan = false;

    // ステップ1: JAN完全一致（最優先）
    if (item.jan && item.jan.length >= 8) {
      code = matchByJan(item.jan, products);
      if (code) {
        matchedByJan = true;
        logs.push(`JAN照合成功: ${item.jan} → ${code}`);
      } else {
        logs.push(`JAN未登録: ${item.jan}`);
      }
    }

    // ステップ2: 仕入先品番コードで照合（コードのハイフン後部分と一致）
    if (!code && item.supplierCode) {
      code = matchBySupplierCode(item.supplierCode, products, supplierPrefix ?? undefined);
      if (code) {
        logs.push(`品番照合成功: ${item.supplierCode} → ${code}`);
      }
    }

    // ステップ3: 仕入元絞り込みで商品名/D列キーワード照合
    if (!code && item.productName && supplierPrefix) {
      code = matchByName(item.productName, products, supplierPrefix);
      if (code) {
        logs.push(`商品名照合成功（${supplierPrefix}-絞り込み）: ${item.productName} → ${code}`);
      }
    }

    // ステップ4: 絞り込みなしで全体から商品名/D列キーワード照合
    if (!code && item.productName) {
      code = matchByName(item.productName, products);
      if (code) {
        logs.push(`商品名照合成功（全体）: ${item.productName} → ${code}`);
      }
    }

    if (code) {
      allRows.push(buildRow(code, item.quantity, dateStr));
      // JANコード以外で照合成功した場合、D列にキーワードを自動記入
      if (!matchedByJan && item.productName) {
        appendDeliveryKeyword(code, item.productName).catch((e) =>
          logs.push(`D列記入スキップ: ${e instanceof Error ? e.message : String(e)}`)
        );
      }
    } else {
      const label = item.jan
        ? `JAN:${item.jan}`
        : item.productName
          ? `${item.productName}${item.supplierCode ? ` [品番:${item.supplierCode}]` : ""}`
          : "不明";
      notFound.push({ label, productName: item.productName || item.jan || "不明", quantity: item.quantity });
    }
  }

  return detectedSupplierName;
}

/** 同一コードの行を数量合算して1行にまとめる */
function mergeRowsByCode(
  rows: ReturnType<typeof buildRow>[]
): ReturnType<typeof buildRow>[] {
  const map = new Map<string, ReturnType<typeof buildRow>>();
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

/** 未登録商品のキーワード登録（その場登録）
 * keyword: D列に登録する品番など
 * productName: C列の商品名で検索するための名前（省略時はkeywordで検索） */
router.post("/register-keyword", express.json(), async (req, res) => {
  try {
    const { keyword, productName } = req.body as { keyword?: string; productName?: string };
    if (!keyword || !keyword.trim()) {
      return res.status(400).json({ ok: false, error: "キーワードは必須です" });
    }
    const kw = keyword.trim();
    const pn = productName?.trim() || undefined;
    // productNameがあればそれでC列を検索し、keyword（品番）をD列に登録
    const result = await appendKeywordByName(kw, pn);
    res.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** 十二堂CSV変換エンドポイント
 * Shift-JISのCSVを受け取り、十二堂商品リストで照合して助ネコ在庫CSV形式で出力 */
router.post("/process-junidou-csv", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ ok: false, error: "CSVファイルが選択されていません" });
    }

    // Shift-JISデコード
    const csvText = iconv.decode(file.buffer, "Shift_JIS");

    // CSV行を解析
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) {
      return res.status(400).json({ ok: false, error: "CSVが空です" });
    }

    // 十二堂商品リストを取得
    const junidouList = await fetchJunidouList();
    const codeMap = new Map<string, string>();
    for (const item of junidouList) {
      codeMap.set(item.junidouCode.toLowerCase(), item.sukenekoCde);
    }

    const resultRows: Array<{ code: string; quantity: number; date: string; original: string }> = [];
    const notFound: string[] = [];

    for (const line of lines) {
      // CSV列を解析（カンマ区切り、クォート対応）
      const cols = parseCSVLine(line);
      if (cols.length < 2) continue;

      const junidouCode = cols[0].trim();
      const quantityStr = cols[1].trim();
      const dateStr = cols.length >= 3 ? cols[2].trim() : "";

      if (!junidouCode) continue;

      const quantity = parseInt(quantityStr, 10);
      if (isNaN(quantity) || quantity <= 0) continue;

      // 十二堂コード → 助ネココード照合
      const sukenekoCde = codeMap.get(junidouCode.toLowerCase());
      if (sukenekoCde) {
        // 日付フォーマット変換（YYYY/MM/DD形式に統一）
        const formattedDate = formatJunidouDate(dateStr);
        resultRows.push({ code: sukenekoCde, quantity, date: formattedDate, original: junidouCode });
      } else {
        notFound.push(junidouCode);
      }
    }

    // 同一コードの数量を合算
    const mergedMap = new Map<string, { code: string; quantity: number; date: string }>();
    for (const row of resultRows) {
      const key = `${row.code}__${row.date}`;
      if (mergedMap.has(key)) {
        mergedMap.get(key)!.quantity += row.quantity;
      } else {
        mergedMap.set(key, { code: row.code, quantity: row.quantity, date: row.date });
      }
    }
    const mergedRows = Array.from(mergedMap.values());

    // 助ネコ在庫CSV形式で出力
    const header = "自社商品コード,在庫指定,在庫数,入庫日,入庫時間,備考";
    const csvLines = mergedRows.map((r) =>
      [
        `"${r.code}"`,
        `"通常在庫"`,
        `"${r.quantity}"`,
        `"${r.date}"`,
        `"00:00"`,
        `"十二堂"`,
      ].join(",")
    );
    const csvContent = [header, ...csvLines].join("\r\n");

    res.json({
      ok: true,
      csvContent,
      rowCount: mergedRows.length,
      notFound,
      notFoundCount: notFound.length,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** CSV行を解析（ダブルクォート対応） */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === ',' && !inQuote) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/** 十二堂CSVの日付をYYYY/MM/DD形式に変換 */
function formatJunidouDate(dateStr: string): string {
  if (!dateStr) {
    const now = new Date();
    return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
  }
  // YYYYMMDD → YYYY/MM/DD
  const m8 = dateStr.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m8) return `${m8[1]}/${m8[2]}/${m8[3]}`;
  // YYYY-MM-DD → YYYY/MM/DD
  const mDash = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mDash) return `${mDash[1]}/${mDash[2]}/${mDash[3]}`;
  // YYYY/MM/DD はそのまま
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(dateStr)) return dateStr;
  // その他はそのまま返す
  return dateStr;
}

export default router;
