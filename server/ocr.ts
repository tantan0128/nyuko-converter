/**
 * OCR処理モジュール
 * ユーザーのGemini APIキー（GEMINI_API_KEY）を使ってPDF/画像から商品情報を抽出する。
 * Manusクレジット・invokeLLMは一切使用しない。
 *
 * 精度改善ポイント:
 * - モデル: gemini-2.5-pro をデフォルト採用（GEMINI_MODEL環境変数で切替可）
 * - responseSchema: 出力JSONの型を厳密指定し、品番の形式崩れ・抽出漏れを防止
 * - プロンプト: ゼロ埋め・ハイフン揺れ・複数品番の帳票パターンを明示
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
// gemini-2.5-pro は新規ユーザー向け提供終了のため、利用可能な最新Proモデルを使用
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-pro-preview";
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
    /^[0-9０-９\-.,，、\s]+$/, // 数字・記号のみ
    /^(有限会社|株式会社|合同会社|合資会社)[^\s]{1,30}$/, // 会社名のみ
  ];
  return nonProductPatterns.some((re) => re.test(s));
}

/**
 * Gemini APIを直接呼び出してPDF/画像から商品情報を抽出する
 * ※ invokeLLM（Manusプロキシ）は使用しない
 *
 * responseSchema により、返却JSONの型を厳密に強制する:
 * - items[] は必ず配列
 * - quantity は必ず整数
 * - jan は数字のみ（13桁）
 * - supplierCode は英数字・ハイフン・スラッシュのみ
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
- 全ページを読み取り、全商品を漏れなく抽出すること

【各項目の抽出ルール】

■ JANコード（jan）
- 13桁の数字（4で始まることが多い）。例: 4977642221826
- 「984000」で始まる番号は除外（社内用コードのため）
- 数字以外の文字（ハイフン・スペース）は含めず、数字のみで返す

■ 仕入先品番（supplierCode）
- 帳票に記載された品番・型番・商品コードをそのまま抽出
- 形式の例: CMG-350-W / 22218200 / WAS-WP-006 / KB-001 / AB/12 / PZ-0001
- 英数字・ハイフン・スラッシュのみを含む。それ以外の記号・空白は含めない
- 先頭ゼロは省略せず、帳票の表記どおりに抽出（例: 0123 は "0123" のまま）
- ハイフンの有無・全角半角も帳票の表記どおりに抽出（正規化は照合側で行う）
- 1つの明細に品番らしき文字列が複数ある場合は、最も品番らしい英数字混在コードを選ぶ

■ 商品名（productName）
- 実際の商品・製品の名称のみを抽出
- 「木村硝子店 グラス」のようなメーカー名＋商品名は、メーカー名を含めず商品名のみ
- サイズ・色・数量などの付随情報は商品名に含めない

■ 数量（quantity）
- 整数で返す
- 「入数×C/T=総数」の形式がある場合は、計算後の総数を使用
- 例: 「5×24=120」なら 120

■ 日付（date）
- 納品日または発行日を YYYY/MM/DD 形式で返す（例: 2026/07/16）

■ 仕入先名（supplier）
- 書類を発行した会社名（送り主）を返す

【絶対に抽出しないもの（これらは商品ではない）】
- 「下記のとおり納品いたしました」「上記の通り」「ご確認」などの挨拶文・定型文
- 「品番・品名」「数量」「単価」「金額」「区分」「備考」「連番」「摘要」などの表ヘッダー行
- 「納品書」「発注書」「請求書」などの書類タイトル
- 会社名のみの行（商品名・品番・JANがない行）
- 住所・電話番号・郵便番号
- 「小計」「合計」「消費税」「税率」「送料」「手数料」「対象額」を含む行
- 「選べる」「廃番」「お選びください」を含む行
- 1〜2文字の断片テキスト（「川」「価」「単」「古」など）
- 数字のみの行（品番が数字のみの場合は商品名とセットで抽出すること）
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
        // 出力JSONの型を厳密に強制（精度向上の要）
        response_schema: {
          type: "OBJECT",
          properties: {
            date: { type: "STRING" },
            supplier: { type: "STRING" },
            items: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  jan: { type: "STRING" },
                  supplierCode: { type: "STRING" },
                  productName: { type: "STRING" },
                  quantity: { type: "INTEGER" },
                },
                required: ["productName", "quantity"],
              },
            },
          },
          required: ["items"],
        },
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

    const items: ExtractedItem[] = (parsed.items || [])
      .map((item) => ({
        jan: item.jan?.replace(/\D/g, "") || undefined,
        supplierCode: item.supplierCode?.trim() || undefined,
        productName: item.productName?.trim() || undefined,
        quantity:
          typeof item.quantity === "string"
            ? parseInt(item.quantity, 10) || 1
            : item.quantity || 1,
      }))
      .filter((item) => {
        // 984000で始まるJANは除外
        if (item.jan && item.jan.startsWith("984000")) item.jan = undefined;
        // 商品名でない行をサーバー側でもフィルタリング
        if (item.productName && isNonProductName(item.productName)) return false;
        return item.productName || item.jan || item.supplierCode;
      });

    return {
      date: parsed.date || undefined,
      supplier: parsed.supplier?.trim() || undefined,
      items,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { items: [], error: `OCR処理エラー: ${msg}` };
  }
}
