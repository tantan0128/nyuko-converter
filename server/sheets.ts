import { google } from "googleapis";
import { getDb } from "./db";
import { products } from "../drizzle/schema";

export interface ProductRecord {
  jan: string;
  code: string;
  nameKeywords: string; // C列: 検索キーワード
}

// メモリキャッシュ（DB読み込み結果）
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

/** スプレッドシートから商品データを取得（同期用） */
export async function fetchFromSpreadsheet(): Promise<ProductRecord[]> {
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
  const result: ProductRecord[] = [];

  for (const row of rows) {
    const jan = String(row[0] || "").trim().replace(/^'/, ""); // 先頭の ' を除去
    const code = String(row[1] || "").trim();
    const nameKeywords = String(row[2] || "").trim();
    if (code) {
      result.push({ jan, code, nameKeywords });
    }
  }

  return result;
}

/** DBに商品マスターを同期保存 */
export async function syncProductsToDB(records: ProductRecord[]): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("データベースに接続できません");

  // 既存データを全削除して再挿入
  await db.delete(products);

  if (records.length === 0) return 0;

  // バッチ挿入（500件ずつ）
  const batchSize = 500;
  let inserted = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize).map((r) => ({
      jan: r.jan,
      code: r.code,
      nameKeywords: r.nameKeywords,
    }));
    await db.insert(products).values(batch);
    inserted += batch.length;
  }

  // キャッシュクリア
  cachedProducts = null;
  cacheTime = 0;

  return inserted;
}

/** DBから商品マスターを読み込み（キャッシュ付き） */
async function loadFromDB(): Promise<ProductRecord[] | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const rows = await db.select().from(products);
    if (rows.length === 0) return null;
    return rows.map((r) => ({
      jan: r.jan,
      code: r.code,
      nameKeywords: r.nameKeywords,
    }));
  } catch {
    return null;
  }
}

/** DB件数と最終同期日時を取得 */
export async function getSyncStatus(): Promise<{ count: number; syncedAt: Date | null }> {
  const db = await getDb();
  if (!db) return { count: 0, syncedAt: null };

  try {
    const rows = await db.select().from(products);
    if (rows.length === 0) return { count: 0, syncedAt: null };
    const latest = rows.reduce((a, b) => (a.syncedAt > b.syncedAt ? a : b));
    return { count: rows.length, syncedAt: latest.syncedAt };
  } catch {
    return { count: 0, syncedAt: null };
  }
}

/** 商品マスター読み込み（DB優先、なければスプレッドシートにフォールバック） */
export async function loadProductMaster(): Promise<ProductRecord[]> {
  const now = Date.now();
  if (cachedProducts && now - cacheTime < CACHE_TTL) {
    return cachedProducts;
  }

  // DB優先
  const dbProducts = await loadFromDB();
  if (dbProducts && dbProducts.length > 0) {
    cachedProducts = dbProducts;
    cacheTime = now;
    return dbProducts;
  }

  // DBが空ならスプレッドシートから直接読み込み（フォールバック）
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) {
    return [];
  }

  try {
    const sheetProducts = await fetchFromSpreadsheet();
    cachedProducts = sheetProducts;
    cacheTime = now;
    return sheetProducts;
  } catch (e) {
    console.warn("[sheets] スプレッドシートフォールバック失敗:", e);
    return [];
  }
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
      if (normKeywords.includes(token) || keywordsNoSpace.includes(token)) {
        score += /\d/.test(token) ? 2 : 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestCode = p.code;
    }
  }

  return bestScore >= 2 ? bestCode : null;
}
