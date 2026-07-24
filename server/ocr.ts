import { invokeLLM } from "./_core/llm";
import { storagePut, storageGetSignedUrl } from "./storage";

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

const SYSTEM_PROMPT = `あなたは日本の納品書・売上伝票・出荷案内書のデータ抽出の専門家です。
PDFまたは画像に含まれる全ての商品情報を漏れなく正確に抽出してください。

【抽出ルール】
- 仕入先会社名：納品書の発行元（送り主）の会社名。右上・左上・ヘッダーに記載の「株式会社」「有限会社」等を含む正式名称。「納品先」「お届け先」は除外。
- JANコード：13桁の数字のみ（バーコード番号）。12桁や8桁は除外。
- 仕入先品番（supplierCode）：メーカー品番・商品コード・品番・型番・品目コード等。英数字混在が多い。JANコードとは別の項目。
- 商品名：商品の名称。できるだけ完全な名称を抽出。
- 数量：出荷数・納品数・数量の列の値。整数で返す。
- 日付：伝票日付（YYYY/MM/DD形式）。年が不明な場合は2026年。

【除外するもの】
- 数量が0の行
- 運賃・送料・配送料・手数料・消費税・税・値引・割引・小計・合計・請求額
- ページ番号・備考・注意書き

【重要な注意点】
- 複数ページある場合は全ページを読み取る
- 表の罫線をまたいでも全行を読み取る
- 品番とJANコードは別フィールドに分けて抽出する
- 同じ商品が複数行に分かれている場合は数量を合算せず別行として返す
- ページ端の記号（▶→►等）は無視して全行読み取る

必ずJSON形式で返してください。`;

/**
 * PDFまたは画像をGeminiに直接渡して商品情報を抽出する
 * - PDFはS3にアップロードして署名付きURLを取得し file_url で渡す（最高精度）
 * - 画像は image_url (base64) で渡す
 * - モデルは gemini-3.1-pro-preview（最高精度）を使用
 */
export async function extractWithGemini(
  mode: string,
  _ocrText: string,
  imageBase64?: string,
  imageMimeType?: string,
  fileBuffer?: Buffer,
  fileMimeType?: string
): Promise<ExtractedData> {
  const prompt = buildPrompt(mode);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentParts: any[] = [{ type: "text", text: prompt }];

  const isPdf = fileMimeType === "application/pdf" || imageMimeType === "application/pdf";

  if (fileBuffer && isPdf) {
    // PDFはbase64でfile_urlとして直接渡す（GeminiがPDFをネイティブ読み取りできる）
    const b64 = fileBuffer.toString("base64");
    contentParts.push({
      type: "file_url",
      file_url: { url: `data:application/pdf;base64,${b64}`, mime_type: "application/pdf" },
    });
  } else if (imageBase64 && imageMimeType) {
    // 画像は base64 で直接渡す
    contentParts.push({
      type: "image_url",
      image_url: { url: `data:${imageMimeType};base64,${imageBase64}`, detail: "high" },
    });
  } else if (fileBuffer) {
    const b64 = fileBuffer.toString("base64");
    const mime = fileMimeType || "image/jpeg";
    contentParts.push({
      type: "image_url",
      image_url: { url: `data:${mime};base64,${b64}`, detail: "high" },
    });
  }

  // JSON形式をプロンプトで指示（response_format: json_schemaはfile_urlと組み合わせと空レスポンスになるため使わない）
  const jsonInstruction = `
必ず以下のJSON形式だけで返答してください（説明文不要）:
{
  "date": "伝票日付 YYYY/MM/DD",
  "supplier": "仕入先会社名",
  "items": [
    {
      "jan": "13桁JANコード（なければ空文字）",
      "productName": "商品名",
      "supplierCode": "仕入先品番・型番",
      "quantity": 数量整数
    }
  ]
}`;

  // 最後のテキストパーツにJSON指示を追加
  const finalParts = [
    ...contentParts,
    { type: "text" as const, text: jsonInstruction }
  ];

  try {
    const response = await invokeLLM({
      model: "gemini-3.1-pro-preview",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: finalParts,
        },
      ] as Parameters<typeof invokeLLM>[0]["messages"],
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) throw new Error("Geminiからレスポンスがありません");

    // Geminiがmarkdownコードブロックで返す場合があるので除去してパース
    let jsonText = typeof content === "string" ? content : JSON.stringify(content);
    // ```json ... ``` や ``` ... ``` を除去
    jsonText = jsonText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(jsonText);

    // 年の補正
    let date = parsed.date as string | undefined;
    if (date) {
      const m = date.match(/^(\d{4})([\/\-]\d{2}[\/\-]\d{2})$/);
      if (m) {
        const y = parseInt(m[1], 10);
        if (y < 2020 || y > 2030) {
          date = `${new Date().getFullYear()}${m[2]}`;
        }
      }
    }

    return {
      date,
      supplier: parsed.supplier as string | undefined,
      items: (parsed.items || []).filter((item: ExtractedItem) => item.quantity > 0),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { items: [], error: `Gemini抽出エラー: ${msg}` };
  }
}

/** Document AIは廃止。後方互換のためダミーを残す */
export async function ocrWithDocumentAI(
  _fileBuffer: Buffer,
  _mimeType: string
): Promise<{ text: string; error?: string }> {
  return { text: "", error: "Document AI廃止済み - Gemini直接処理を使用" };
}

function buildPrompt(mode: string): string {
  const modeInstructions: Record<string, string> = {
    jan_jpg: "この画像の納品書・伝票から、JANコード（13桁）・商品名・仕入先品番・数量・日付・仕入先会社名を全行漏れなく抽出してください。",
    jan_pdf: "このPDFの納品書・伝票から、JANコード（13桁）・商品名・仕入先品番・数量・日付・仕入先会社名を全ページ・全行漏れなく抽出してください。",
    name_pdf: "このPDFの納品書・伝票から、商品名・仕入先品番（商品コード・型番）・数量・日付・仕入先会社名を全ページ・全行漏れなく抽出してください。JANコードがあれば併せて抽出してください。",
  };
  return modeInstructions[mode] || "この納品書・伝票から商品情報を全行漏れなく抽出してください。";
}
