import { DocumentProcessorServiceClient } from "@google-cloud/documentai";

export interface ExtractedItem {
  jan?: string;
  productName?: string;
  supplierCode?: string;
  quantity: number;
  date?: string;
}

export interface ExtractedData {
  date?: string;
  supplier?: string;
  items: ExtractedItem[];
  error?: string;
}

/**
 * Document AIでPDF/画像からテキストを抽出する
 */
export async function ocrWithDocumentAI(
  fileBuffer: Buffer,
  mimeType: string
): Promise<{ text: string; error?: string }> {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "{}");
    const client = new DocumentProcessorServiceClient({ credentials });

    const projectId = process.env.DOCUMENT_AI_PROJECT_ID;
    const location = process.env.DOCUMENT_AI_LOCATION || "us";
    const processorId = process.env.DOCUMENT_AI_PROCESSOR_ID;

    if (!projectId || !processorId) {
      return { text: "", error: "Document AI設定が不足しています（PROJECT_ID/PROCESSOR_ID）" };
    }

    const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;

    const [result] = await client.processDocument({
      name,
      rawDocument: {
        content: fileBuffer.toString("base64"),
        mimeType,
      },
    });

    const text = result.document?.text || "";
    return { text };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { text: "", error: `Document AIエラー: ${msg}` };
  }
}

/**
 * Document AIで抽出したテキストからルールベースで商品情報を抽出する
 * （Gemini互換インターフェース）
 */
export async function extractWithGemini(
  mode: string,
  ocrText: string,
  _imageBase64?: string,
  _imageMimeType?: string,
  fileBuffer?: Buffer,
  fileMimeType?: string
): Promise<ExtractedData> {
  // fileBufferが渡された場合はDocument AIで処理
  let text = ocrText;
  if (fileBuffer && (!text || text.trim() === "")) {
    const mime = fileMimeType || "application/pdf";
    const docResult = await ocrWithDocumentAI(fileBuffer, mime);
    if (docResult.error && !docResult.text) {
      return { items: [], error: docResult.error };
    }
    text = docResult.text;
  }

  if (!text || text.trim() === "") {
    return { items: [], error: "テキストを抽出できませんでした" };
  }

  return extractFromText(text, mode);
}

/**
 * テキストからルールベースで商品情報を抽出する
 */
function extractFromText(text: string, _mode: string): ExtractedData {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  // ---- 日付の抽出 ----
  let date: string | undefined;
  for (const line of lines) {
    const m = line.match(/(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})/);
    if (m) {
      date = `${m[1]}/${m[2].padStart(2, "0")}/${m[3].padStart(2, "0")}`;
      break;
    }
  }

  // ---- 仕入先会社名の抽出 ----
  let supplier: string | undefined;
  for (const line of lines) {
    if (/(株式会社|有限会社|合同会社)/.test(line) &&
        !line.includes("送り先") && !line.includes("届け先") &&
        !line.includes("納品先") && !line.includes("様")) {
      supplier = line.replace(/[　\s]+/g, " ").trim();
      break;
    }
  }

  // ---- 商品情報の抽出 ----
  // Document AIのテキストは行ごとに分割されているため、
  // JANコード（13桁）を起点に前後の行から品番・商品名・数量を組み立てる

  const JAN_RE = /^(4\d{12})$/;
  // 品番パターン：英字+数字混在、または5〜8桁の数字コード
  const CODE_RE = /^([A-Z]{1,5}[-]?\d{3,}[A-Z0-9\-]*|\d{5,8})$/;
  // 数量パターン：1〜4桁の数字のみの行
  const QTY_RE = /^(\d{1,4})$/;
  // 日本語を含む行（商品名候補）
  const JP_RE = /[\u3040-\u30FF\u4E00-\u9FFF]/;

  const items: ExtractedItem[] = [];
  const usedLines = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // JANコードの行を見つける
    if (!JAN_RE.test(line)) continue;
    const jan = line;
    if (jan.startsWith("984000")) continue; // 除外
    if (usedLines.has(i)) continue;
    usedLines.add(i);

    // 前後5行のコンテキストを収集
    const before = lines.slice(Math.max(0, i - 5), i);
    const after = lines.slice(i + 1, Math.min(lines.length, i + 6));

    // 品番：JANの直前の行にあることが多い
    let supplierCode: string | undefined;
    for (let j = before.length - 1; j >= 0; j--) {
      if (CODE_RE.test(before[j]) && !JAN_RE.test(before[j])) {
        supplierCode = before[j];
        break;
      }
    }

    // 商品名：日本語を含む行（前後から探す）
    let productName: string | undefined;
    // afterから先に探す
    for (const l of after) {
      if (JP_RE.test(l) && !l.includes("株式会社") && !l.includes("様") && !l.includes("送り先")) {
        const cleaned = l.replace(/[　\s]+/g, " ").trim();
        if (cleaned.length > 2) { productName = cleaned; break; }
      }
    }
    if (!productName) {
      for (let j = before.length - 1; j >= 0; j--) {
        if (JP_RE.test(before[j]) && !before[j].includes("株式会社") && !before[j].includes("様")) {
          const cleaned = before[j].replace(/[　\s]+/g, " ").trim();
          if (cleaned.length > 2) { productName = cleaned; break; }
        }
      }
    }

    // 数量：afterの中から数量らしい行を探す
    // 「入数 C/T 端数 総数」パターン（例: "24 1 24"）を優先
    let quantity = 0;
    const afterText = after.join(" ");
    // 「数字 数字 数字」パターン（入数・C/T・総数）
    const multiNumMatch = afterText.match(/(\d+)\s+(\d+)\s+(\d+)/);
    if (multiNumMatch) {
      // 最後の数字が総数
      quantity = parseInt(multiNumMatch[3], 10);
    } else {
      // 単独の数量行
      for (const l of after) {
        if (QTY_RE.test(l)) {
          const n = parseInt(l, 10);
          if (n > 0 && n <= 9999) { quantity = n; break; }
        }
      }
    }
    if (quantity <= 0) quantity = 1;

    items.push({ jan, productName, supplierCode, quantity });
  }

  // JANコードが見つからなかった場合：品番ベースで抽出
  if (items.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!JP_RE.test(line)) continue;
      if (line.includes("株式会社") || line.includes("様") || line.includes("送り先")) continue;
      const excludeWords = ["選べる", "廃番", "お選びください", "小計", "合計", "消費税", "送料", "手数料"];
      if (excludeWords.some(w => line.includes(w))) continue;

      const context = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 4)).join(" ");
      let quantity = 0;
      const multiNumMatch = context.match(/(\d+)\s+(\d+)\s+(\d+)/);
      if (multiNumMatch) {
        quantity = parseInt(multiNumMatch[3], 10);
      } else {
        const nums = context.match(/\b(\d{1,4})\b/g);
        if (nums) {
          const valid = nums.map(Number).filter(n => n > 0 && n <= 9999);
          if (valid.length > 0) quantity = valid[valid.length - 1];
        }
      }
      if (quantity <= 0) continue;

      let supplierCode: string | undefined;
      const codeMatch = context.match(/\b([A-Z]{1,5}[-]?\d{3,}[A-Z0-9\-]*)\b/g);
      if (codeMatch) {
        const filtered = codeMatch.filter(c => c.length >= 4);
        if (filtered.length > 0) supplierCode = filtered[0];
      }

      items.push({
        productName: line.replace(/[　\s]+/g, " ").trim(),
        supplierCode,
        quantity,
      });
    }
  }

  // 重複除去
  const seen = new Set<string>();
  const uniqueItems = items.filter(item => {
    const key = item.jan || item.productName || "";
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { date, supplier, items: uniqueItems };
}
