/**
 * OCR処理モジュール
 * ユーザーのGemini APIキー（GEMINI_API_KEY）を使ってPDF/画像から商品情報を抽出する。
 * Manusクレジットは消費しない。
 */

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

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * Gemini APIを直接呼び出してPDF/画像から商品情報を抽出する
 */
export async function extractWithGemini(
  _mode: string,
  _ocrText: string,
  _imageBase64?: string,
  _imageMimeType?: string,
  fileBuffer?: Buffer,
  fileMimeType?: string
): Promise<ExtractedData> {
  if (!GEMINI_API_KEY) {
    return { items: [], error: "GEMINI_API_KEYが設定されていません" };
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    return { items: [], error: "ファイルデータがありません" };
  }

  const mime = fileMimeType || "application/pdf";
  const base64 = fileBuffer.toString("base64");

  const prompt = `あなたは日本の納品書・発注書・請求書を読み取るOCRシステムです。
以下のPDF/画像から商品情報を全て抽出してください。

抽出ルール：
- 全ページを読み取り、全商品を漏れなく抽出すること
- JANコード：13桁の数字（4から始まることが多い）。「984000」で始まるものは除外
- 仕入先品番（supplierCode）：英字+数字の組み合わせ（例：CMG-350-W、22218200）
- 商品名：日本語または英語の商品名
- 数量：整数。「入数×C/T=総数」の場合は総数を使用
- 日付：納品日または発行日（YYYY/MM/DD形式）
- 仕入先名：会社名

除外する行：
- 「選べる」「廃番」「お選びください」「小計」「合計」「消費税」「送料」「手数料」を含む行

必ず以下のJSON形式のみで返答してください（説明文不要）：
{
  "date": "YYYY/MM/DD",
  "supplier": "会社名",
  "items": [
    {
      "jan": "4977642221826",
      "supplierCode": "CMG-350-W",
      "productName": "セラミックコーティング真空二重マグ",
      "quantity": 24
    }
  ]
}`;

  try {
    const body = {
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: mime,
                data: base64,
              },
            },
            { text: prompt },
          ],
        },
      ],
      generationConfig: {
        response_mime_type: "application/json",
      },
    };

    const res = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { items: [], error: `Gemini APIエラー (${res.status}): ${errText.slice(0, 200)}` };
    }

    const data = await res.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      error?: { message?: string };
    };

    if (data.error) {
      return { items: [], error: `Gemini APIエラー: ${data.error.message}` };
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!rawText) {
      return { items: [], error: "Geminiからレスポンスがありません" };
    }

    // JSONパース（コードブロック対応）
    let jsonStr = rawText.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

    const parsed = JSON.parse(jsonStr) as {
      date?: string;
      supplier?: string;
      items?: Array<{
        jan?: string;
        supplierCode?: string;
        productName?: string;
        quantity?: number | string;
      }>;
    };

    const items: ExtractedItem[] = (parsed.items || []).map((item) => ({
      jan: item.jan?.replace(/\D/g, "") || undefined,
      supplierCode: item.supplierCode || undefined,
      productName: item.productName || undefined,
      quantity: typeof item.quantity === "string" ? parseInt(item.quantity, 10) || 1 : (item.quantity || 1),
    })).filter((item) => {
      // 984000で始まるJANは除外
      if (item.jan && item.jan.startsWith("984000")) item.jan = undefined;
      return item.productName || item.jan || item.supplierCode;
    });

    return {
      date: parsed.date || undefined,
      supplier: parsed.supplier || undefined,
      items,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { items: [], error: `OCR処理エラー: ${msg}` };
  }
}
