import express from "express";
import multer from "multer";
import iconv from "iconv-lite";
import { extractWithGemini } from "./ocr";
import { loadProductMaster, matchByJan, matchByName, matchBySupplierCode, guessSupplierPrefix, normalizeSupplierName, supplierNameFromMaster, appendDeliveryKeyword, appendKeywordByName, fetchJunidouList, fetchFromSpreadsheet, syncProductsToDB, clearCache } from "./sheets";

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
  const notFound: Array<{ label: string; productName: string; quantity: number; supplierCode?: string; jan?: string }> = [];
  const errors: string[] = [];
  let detectedSupplier = ""; // Geminiが抽出した仕入先名
  let isPhezzanDenpyo = false; // 出庫伝票/入庫伝票（社内の倉庫⇔店舗在庫移動）判定

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
        const result = await processImageOrPDF(file, mode, products, allRows, notFound, errors, logs);
        if (result?.supplier && !detectedSupplier) detectedSupplier = result.supplier;
        // Phezzan伝票判定（出庫伝票/入庫伝票）: GeminiのdocumentType / ファイル名 / 仕入先名のいずれかで検出
        if (
          result?.documentType === "出庫伝票" ||
          result?.documentType === "入庫伝票" ||
          isPhezzanDenpyoFile(file.originalname) ||
          (result?.supplier && /出庫伝票|入庫伝票|出庫|入庫/.test(result.supplier))
        ) {
          isPhezzanDenpyo = true;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${file.originalname}: ${msg}`);
        logs.push(`エラー: ${file.originalname} - ${msg}`);
      }
    }

    // 同一コードの数量を合算して1行にまとめる
    const mergedRows = mergeRowsByCode(allRows);
    logs.push(`合算後: ${mergedRows.length}件（合算前: ${allRows.length}件）`);

    // 仕入先名の解決:
    // 1. 出庫伝票/入庫伝票（社内の倉庫⇔店舗在庫移動）の場合は「Phezzan伝票」に固定（E列優先を適用しない）
    // 2. OCR抽出した仕入先名を正規化（「株式会社 三陽エース」→「三陽エース」）
    // 3. 照合済み商品コードのE列（仕入れ先）の実データを最優先（ユーザー指定）
    // 4. E列が空の場合はプレフィックス逆引き（RAKUMART等の誤検出対策）
    if (isPhezzanDenpyo) {
      detectedSupplier = "Phezzan伝票";
      logs.push("出庫/入庫伝票と判定: 仕入先名を「Phezzan伝票」に固定");
    } else if (detectedSupplier) {
      const normalized = normalizeSupplierName(detectedSupplier);
      if (normalized) detectedSupplier = normalized;
    }
    if (!isPhezzanDenpyo && mergedRows.length > 0) {
      const code = mergedRows[0].code;
      const fromMaster = supplierNameFromMaster(code, products);
      if (fromMaster) detectedSupplier = fromMaster; // E列の実データを最優先
    }

    res.json({ rows: mergedRows, notFound, errors, logs, supplier: detectedSupplier });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

type NotFoundItem = { label: string; productName: string; quantity: number; supplierCode?: string; jan?: string };

/** ファイル名から出庫伝票/入庫伝票（Phezzan伝票）を判定する */
function isPhezzanDenpyoFile(filename: string): boolean {
  return /出庫伝票|入庫伝票|出庫票|入庫票/.test(filename || "");
}

async function processImageOrPDF(
  file: Express.Multer.File,
  mode: string,
  products: Awaited<ReturnType<typeof loadProductMaster>>,
  allRows: ReturnType<typeof buildRow>[],
  notFound: NotFoundItem[],
  errors: string[],
  logs: string[]
): Promise<{ supplier?: string; documentType?: string }> {
  const mimeType = file.mimetype;

  logs.push(`Gemini直接処理: ${file.originalname} (${mimeType})`);

  // Geminiにファイルを直接渡す（PDFはfile_url、画像はimage_url）
  const extracted = await extractWithGemini(
    mode,
    "", // ocrText不使用
    undefined,
    undefined,
    file.buffer,
    mimeType
  );
  if (extracted.error) {
    logs.push(`Gemini抽出エラー: ${extracted.error}`);
    // エラーでも抽出できた商品があれば未照合として追加
    if (!extracted.items || extracted.items.length === 0) {
      errors.push(`${file.originalname}: ${extracted.error}`);
      return { supplier: undefined, documentType: undefined };
    }
    logs.push(`エラーあり・部分抽出: ${extracted.items.length}件を未照合として処理`);
  }

  logs.push(`Gemini抽出: ${extracted.items.length}件`);

  const dateStr = extracted.date || formatDate(new Date());
  // name_pdf モードは商品名・商品コードで照合
  const useProductName = mode === "name_pdf";

  // 出庫/入庫伝票（Phezzan伝票）は社内の倉庫⇔店舗移動のためベンダーコードがバラバラ。
  // 仕入先絞り込みをすると正しく照合できないので、絞り込みなし（全体から照合）にする。
  const isPhezzan = extracted.documentType === "出庫伝票" || extracted.documentType === "入庫伝票";
  const supplierPrefix = !isPhezzan && extracted.supplier ? guessSupplierPrefix(extracted.supplier) : null;
  if (isPhezzan) {
    logs.push(`Phezzan伝票（${extracted.documentType}）: 仕入先絞り込みなしで照合`);
  } else if (supplierPrefix) {
    logs.push(`仕入元推定: ${extracted.supplier} → プレフィックス「${supplierPrefix}-」で絞り込み`);
  }

  const detectedSupplierName = extracted.supplier || undefined;

    for (const item of extracted.items) {
    if (item.quantity <= 0) continue;

    let code: string | null = null;
    let matchedByJan = false;

    // ステップ1: JAN完全一致（最優先）— JANは一意キーなので絞り込みしない
    if (item.jan && item.jan.length >= 8) {
      code = matchByJan(item.jan, products);
      if (code) {
        matchedByJan = true;
        logs.push(`JAN照合成功: ${item.jan} → ${code}`);
      } else {
        logs.push(`JAN未登録: ${item.jan}`);
      }
    }

    // JANがあるのに未登録かどうかのフラグ
    const hasJanCode = !!(item.jan && item.jan.length >= 8);

    // ステップ2: 仕入先品番コードで照合（JANがあるのに未登録の場合はスキップ）
    // 仕入先名（E列）とプレフィックスの両方で絞り込む
    if (!code && item.supplierCode && !hasJanCode) {
      code = matchBySupplierCode(
        item.supplierCode,
        products,
        supplierPrefix ?? undefined,
        detectedSupplierName
      );
      if (code) {
        logs.push(`品番照合成功: ${item.supplierCode} → ${code}`);
      }
    }

    // ステップ3: 仕入先絞り込みで商品名/D列キーワード照合（JANがあるのに未登録の場合はスキップ）
    if (!code && item.productName && !hasJanCode) {
      code = matchByName(
        item.productName,
        products,
        supplierPrefix ?? undefined,
        detectedSupplierName
      );
      if (code) {
        const by = supplierPrefix
          ? `${supplierPrefix}-絞り込み`
          : detectedSupplierName
            ? `仕入先「${detectedSupplierName}」絞り込み`
            : "全体";
        logs.push(`商品名照合成功（${by}）: ${item.productName} → ${code}`);
      }
    }

    // ステップ4: 絞り込みなしで全体から商品名/D列キーワード照合（JANがあるのに未登録の場合はスキップ）
    if (!code && item.productName && !hasJanCode) {
      code = matchByName(item.productName, products);
      if (code) {
        logs.push(`商品名照合成功（全体）: ${item.productName} → ${code}`);
      }
    }

    if (code) {
      allRows.push(buildRow(code, item.quantity, dateStr));
      // 品番で照合成功した場合のみ、その品番をD列に自動追記する（学習）。
      // 商品名（あいまい照合）での自動追記は誤照合の自己増殖を防ぐため行わない。
      // JAN照合成功時は追記不要（JANが正本のため）。
      if (!matchedByJan && item.supplierCode) {
        appendDeliveryKeyword(code, item.supplierCode).catch((e) =>
          logs.push(`D列記入スキップ: ${e instanceof Error ? e.message : String(e)}`)
        );
      }
    } else {
      // 未照合ラベル：商品名・JAN・品番を全て含める
      const parts: string[] = [];
      if (item.productName) parts.push(item.productName);
      if (item.supplierCode) parts.push(`[品番:${item.supplierCode}]`);
      if (item.jan) parts.push(`[JAN:${item.jan}]`);
      const label = parts.length > 0 ? parts.join(" ") : "不明";
      logs.push(`未照合: ${label} 数量:${item.quantity}`);
      notFound.push({
        label,
        productName: item.productName || item.jan || "不明",
        quantity: item.quantity,
        supplierCode: item.supplierCode || undefined,
        jan: item.jan || undefined,
      });
    }
  }

  return { supplier: detectedSupplierName, documentType: extracted.documentType };
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
 * productName: C列の商品名で検索するための名前（省略時はkeywordで検索）
 * supplierCode: 仕入先品番（こちらを優先してD列に登録）
 * jan: JANコード（supplierCodeがない場合に使用） */
router.post("/register-keyword", express.json(), async (req, res) => {
  try {
    const { keyword, productName, supplierCode, jan, code } = req.body as {
      keyword?: string;
      productName?: string;
      supplierCode?: string;
      jan?: string;
      code?: string;
    };

    // D列に登録するキーワードを決定：supplierCode > jan > keyword の優先順
    const keywordToRegister = (supplierCode || jan || keyword || "").trim();
    if (!keywordToRegister) {
      return res.status(400).json({ ok: false, error: "登録するキーワードがありません" });
    }

    // 自社コードが指定されている場合は、B列完全一致で確実にその行へ登録する（精度最優先）
    if (code && code.trim()) {
      const result = await appendDeliveryKeyword(code.trim(), keywordToRegister);
      if (result.ok) await resyncAfterKeywordRegister();
      return res.json(result);
    }

    const pn = productName?.trim() || undefined;
    // productNameがあればそれでC列を検索し、keywordToRegisterをD列に登録
    const result = await appendKeywordByName(keywordToRegister, pn);
    if (result.ok) await resyncAfterKeywordRegister();
    res.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: msg });
  }
});

/** D列登録後にDB再同期して即時反映する（照合はDB+5分キャッシュを参照するため） */
async function resyncAfterKeywordRegister(): Promise<void> {
  try {
    const records = await fetchFromSpreadsheet();
    await syncProductsToDB(records);
    clearCache();
  } catch (e) {
    console.warn("[register-keyword] DB再同期に失敗（次回の自動再同期で反映されます）:", e instanceof Error ? e.message : String(e));
  }
}

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
