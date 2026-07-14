import { google } from "googleapis";

export interface ProductRecord {
  jan: string;
  code: string;
  nameKeywords: string; // C列: 検索キーワード
}

let cachedProducts: ProductRecord[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5分キャッシュ

function getAuthClient() {
  const credJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON が設定されていません");
  const credentials = JSON.parse(credJson);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

export async function loadProductMaster(): Promise<ProductRecord[]> {
  const now = Date.now();
  if (cachedProducts && now - cacheTime < CACHE_TTL) {
    return cachedProducts;
  }

  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("SPREADSHEET_ID が設定されていません");

  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const range = process.env.SPREADSHEET_RANGE || "全商品取り扱いリスト!A:C";
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const rows = response.data.values || [];
  const products: ProductRecord[] = [];

  for (const row of rows) {
    const jan = String(row[0] || "").trim();
    const code = String(row[1] || "").trim();
    const nameKeywords = String(row[2] || "").trim();
    if (code) {
      products.push({ jan, code, nameKeywords });
    }
  }

  cachedProducts = products;
  cacheTime = now;
  return products;
}

export function clearCache() {
  cachedProducts = null;
  cacheTime = 0;
}

/** JANコード完全一致で照合 */
export function matchByJan(jan: string, products: ProductRecord[]): string | null {
  if (!jan || jan.length < 8) return null;
  const normalized = jan.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const found = products.find((p) => p.jan === normalized);
  return found?.code || null;
}

/** 商品名あいまいマッチング */
export function matchByName(productName: string, products: ProductRecord[]): string | null {
  if (!productName) return null;

  const normalize = (s: string) =>
    s
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[　]/g, " ")
      .toLowerCase()
      .trim();

  const normInput = normalize(productName);
  const inputNoSpace = normInput.replace(/\s+/g, "");

  let bestCode: string | null = null;
  let bestScore = 0;

  for (const p of products) {
    if (!p.nameKeywords) continue;
    const normKeywords = normalize(p.nameKeywords);
    const keywordsNoSpace = normKeywords.replace(/\s+/g, "");

    // パス1: スペース除去完全一致
    if (inputNoSpace === keywordsNoSpace) {
      return p.code;
    }

    // パス2: トークンマッチング
    const inputTokens = normInput.split(/\s+/).filter(Boolean);
    let score = 0;

    for (const token of inputTokens) {
      if (token.length < 1) continue;
      // C列の文字列にトークンが含まれるか
      if (normKeywords.includes(token) || keywordsNoSpace.includes(token)) {
        // 数字を含むトークンは+2、通常は+1
        score += /\d/.test(token) ? 2 : 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestCode = p.code;
    }
  }

  // スコア2以上で採用
  return bestScore >= 2 ? bestCode : null;
}
