/**
 * OCR処理モジュール
 * ユーザーのGemini APIキー（GEMINI_API_KEY）を使ってPDF/画像から商品情報を抽出する。
 * Manusクレジット・invokeLLMは一切使用しない。
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
 * 商品名でない文字列を判定する（サーバー側フィルタリング）
 * Geminiが誤抽出した表ヘッダー・住所・挨拶文・会社名などを除外する
 */
function isNonProductName(name: string): boolean {
  const s = name.trim();
  // 1〜2文字の断片（「川」「価」「単」など）
  if (s.length <= 2) return true;
  // 明らかな非商品パターン
  const nonProductPatterns = [
    /^下記のとおり/,
    /納品いたしました/,
    /ご確認/,
    /よろしくお願い/,
    /上記の通り/,
    /^品番[\s・\-]*品名$/,
    /^品番$/,
    /^品名$/,
    /^数量[\s　]*単位?$/,
    /^単価$/,
    /^金額$/,
    /^備考$/,
    /^区分$/,
    /^単$/,
    /^価$/,
    /^連番$/,
    /^摘要$/,
    /^対象額$/,
    /^税率/,
    /^納品書$/,
    /^発注書$/,
    /^請求書$/,
    /^領収書$/,
    /^売上伝票/,
    /^伝票/,
    /町[0-9０-９]+番地?/,    // 住所
    /丁目[0-9０-９]/,         // 住所
    /^[0-9０-９\-\s,，、]+$/, // 数字のみ
    /^(有限会社|株式会社|合同会社|合資会社)[^\s]{1,30}$/, // 会社名のみ
  ];
  return nonProductPatterns.some((re) => re.test(s));
}

/**
 * Gemini APIを直接呼び出してPDF/画像から商品情報を抽出する
 * ※ invokeLLM（Manusプロキシ）は使用しない
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
以下のPDF/画像から【商品の明細行のみ】を全て抽出してください。

【抽出対象】
- 実際の商品・製品の明細行のみ（商品名、品番、JANコード、数量がある行）

【抽出ルール】
- 全ページを読み取り、全商品を漏れなく抽出すること
- JANコード：13桁の数字（4から始まることが多い）。「984000」で始まるものは除外
- 仕入先品番（supplierCode）：英字+数字の組み合わせ（例：CMG-350-W、22218200、WAS-WP-006）
- 商品名：実際の商品・製品の名称のみ
- 数量：整数。「入数×C/T=総数」の場合は総数を使用
- 日付：納品日または発行日（YYYY/MM/DD形式）
- 仕入先名：書類を発行した会社名（送り主）

【絶対に抽出しないもの（これらは商品ではない）】
- 「下記のとおり納品いたしました」「上記の通り」「ご確認」などの挨拶文・定型文
- 「品番・品名」「数量」「単価」「金額」「区分」「備考」「連番」「摘要」などの表ヘッダー行
- 「納品書」「発注書」「請求書」などの書類タイトル
- 会社名のみの行（商品名・品番・JANがない行）
- 住所・電話番号・郵便番号
- 「小計」「合計」「消費税」「税率」「送料」「手数料」「対象額」を含む行
- 「選べる」「廃番」「お選びください」を含む行
- 1〜2文字の断片テキスト（「川」「価」「単」「古」など）
- 数字のみの行
- 「前ページより」などの繰越行

必ず以下のJSON形式のみで返答してください（説明文不要）：
{
  "date": "YYYY/MM/DD",
  "supplier": "会社名",
  "items": [
    {
      "jan": "4977642221826",
      "supplierCode": "WAS-WP-006",
      "productName": "プレミアム ディナーフォーク",
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
      return { items: [], error: `Gemini APIエラー (${res.status}): ${errText.slice(0, 300)}` };
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
      // 商品名でない行をサーバー側でもフィルタリング
      if (item.productName && isNonProductName(item.productName)) return false;
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
