import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { invokeLLM } from "./_core/llm";

interface OcrResult {
  text: string;
  error?: string;
}

function getDocumentAIClient() {
  const credJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credJson) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON が設定されていません");
  }
  const credentials = JSON.parse(credJson);
  return new DocumentProcessorServiceClient({ credentials });
}

export async function ocrWithDocumentAI(
  fileBuffer: Buffer,
  mimeType: string
): Promise<OcrResult> {
  const processorId = process.env.DOCUMENT_AI_PROCESSOR_ID;
  const projectId = process.env.DOCUMENT_AI_PROJECT_ID;
  const location = process.env.DOCUMENT_AI_LOCATION || "us";

  if (!processorId || !projectId) {
    // Fallback: use Gemini vision directly
    return { text: "", error: "Document AI未設定 - Gemini直接処理を使用" };
  }

  try {
    const client = getDocumentAIClient();
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
    return { text: "", error: `Document AI エラー: ${msg}` };
  }
}

export interface ExtractedItem {
  jan?: string;
  productName?: string;
  supplierCode?: string; // 仕入先品番コード
  quantity: number;
  date?: string;
}

export interface ExtractedData {
  date?: string;
  supplier?: string; // 仕入先会社名
  items: ExtractedItem[];
  error?: string;
}

const GEMINI_SYSTEM_PROMPT = `あなたは日本の納品書・売上伝票のデータ抽出専門家です。
与えられたテキストまたは画像から、以下の情報を正確に抽出してください。

抽出ルール：
- 仕入先会社名：納品書の発行元会社名。主に右上または左上に記載されている「株式会社」「有限会社」「・・・社」「・・・コーポレーション」などの社名を抽出する。「株式会社」「有限会社」などの法人格は含めた完全な社名を返す。「納品先」「お届け先」「送り先」などの返送先ではなく、納品書を発行した会社名を返すこと。
- JANコード：13桁の数字（バーコード番号）
- 商品名：JANコードの隣にある商品の名称
- 数量：出荷数・納品数・数量（欠品・返品は除外）
- 日付：伝票の日付（YYYY/MM/DD形式）。現在は2026年です。年が不明な場合は2026年としてください。
- 数量0の行は除外する
- ページ端の記号（▶、→、►など）は無視して全行読み取る
- 複数の伝票が含まれる場合は全て読み取る
- 「運賃」「送料」「配送料」「送料込」「運送料」「宅配料」「手数料」「消費税」「税」「値引」「割引」「小計」「合計」「請求額」などの商品以外の行は除外する

必ずJSON形式で返してください。`;

export async function extractWithGemini(
  mode: string,
  ocrText: string,
  imageBase64?: string,
  imageMimeType?: string
): Promise<ExtractedData> {
  const prompt = buildPrompt(mode, ocrText);

  const messages: Array<{ role: "user" | "system"; content: unknown }> = [
    { role: "system", content: GEMINI_SYSTEM_PROMPT },
  ];

  if (imageBase64 && imageMimeType) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: { url: `data:${imageMimeType};base64,${imageBase64}`, detail: "high" },
        },
      ],
    });
  } else {
    messages.push({ role: "user", content: prompt });
  }

  try {
    const response = await invokeLLM({
      messages: messages as Parameters<typeof invokeLLM>[0]["messages"],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "extracted_data",
          strict: true,
          schema: {
            type: "object",
            properties: {
              date: { type: "string", description: "伝票日付 YYYY/MM/DD" },
              supplier: { type: "string", description: "仕入先会社名（納品書の発行元会社名、なければ空文字）" },
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    jan: { type: "string", description: "13桁JANコード（なければ空文字）" },
                    productName: { type: "string", description: "商品名" },
                    supplierCode: { type: "string", description: "仕入先品番コード（メーカー品番・商品コード、なければ空文字）" },
                    quantity: { type: "number", description: "数量" },
                  },
                  required: ["jan", "productName", "supplierCode", "quantity"],
                  additionalProperties: false,
                },
              },
            },
            required: ["date", "supplier", "items"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) throw new Error("Geminiからレスポンスがありません");

    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    // 年が正しくない場合（2020未満または2030超）は現在年に補正
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

function buildPrompt(mode: string, ocrText: string): string {
  const baseInstruction = ocrText
    ? `以下のOCRテキストから情報を抽出してください:\n\n${ocrText}`
    : "添付の画像から情報を抽出してください。";

  const modeInstructions: Record<string, string> = {
    jan_jpg: `${baseInstruction}\n\nJANコード（13桁）と数量を全行抽出してください。数量0の行は除外。`,
    jan_pdf: `${baseInstruction}\n\nJANコード（13桁）と数量を全行抽出してください。数量0の行は除外。`,
    name_pdf: `${baseInstruction}\n\n商品名・商品コード（仕入先品番）と数量を全行抽出してください。JANコードがあれば併せて抽出してください。`,
  };

  return modeInstructions[mode] || baseInstruction;
}
