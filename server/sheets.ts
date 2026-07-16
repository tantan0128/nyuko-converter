import { google } from "googleapis";
import { getDb } from "./db";
import { products } from "../drizzle/schema";

export interface ProductRecord {
  jan: string;
  code: string;
  nameKeywords: string; // C列: 商品名・検索キーワード
  deliveryKeywords: string; // D列: 納品書キーワード（仕入先品番・別名など）
}

// 仕入元プレフィックスと仕入先名のマッピング
export const SUPPLIER_PREFIX_MAP: Record<string, string[]> = {
  ok: ["オクムラ", "奥村", "okumura"],
  sa: ["三陽", "sanyo", "さんよう"],
  th: ["クラスアップ", "classup", "class up", "th"],
  yy: ["ワイヨット", "wayot", "wy"],
  id: ["イシダ", "石田", "ishida"],
  sd: ["東洋竹工", "toyo", "toyochikko"],
  pz: ["前原", "maehara"],
  nk: ["中川", "nakagawa"],
  du: ["大丸", "daimaru"],
  kf: ["カフェ", "cafe"],
  mx: ["マックス", "max"],
  kd: ["カドー", "kado"],
  mc: ["マクロ", "macro"],
  fj: ["藤田", "fujita"],
  fo: ["フォー", "fo"],
  ca: ["カ", "ca"],
  sh: ["昭和", "showa"],
  oi: ["オイ", "oi"],
  ac: ["アク", "ac"],
  ap: ["アップ", "ap"],
  mz: ["マズ", "mz"],
  kr: ["クル", "kr"],
  fk: ["フク", "fk"],
  za: ["ザ", "za"],
  yi: ["ヨイ", "yi"],
  kh: ["カハ", "kh"],
  po: ["ポ", "po"],
  ry: ["リュ", "ry"],
};

/** 仕入先名からプレフィックスを推定 */
export function guessSupplierPrefix(supplierName: string): string | null {
  if (!supplierName) return null;
  const normalized = supplierName.toLowerCase().replace(/\s+/g, "");
  for (const [prefix, names] of Object.entries(SUPPLIER_PREFIX_MAP)) {
    for (const name of names) {
      if (normalized.includes(name.toLowerCase().replace(/\s+/g, ""))) {
        return prefix;
      }
    }
  }
  return null;
}

// メモリキャッシュ（DB読み込み結果）
let cachedProducts: ProductRecord[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5分キャッシュ

function getAuthClient(readonly = true) {
  const credJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON が設定されていません");
  const credentials = JSON.parse(credJson);
  const scopes = readonly
    ? ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    : ["https://www.googleapis.com/auth/spreadsheets"];
  return new google.auth.GoogleAuth({ credentials, scopes });
}

/** スプレッドシートから商品データを取得（同期用）- A:D列を読み込む */
export async function fetchFromSpreadsheet(): Promise<ProductRecord[]> {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("SPREADSHEET_ID が設定されていません");

  const auth = getAuthClient(true);
  const sheets = google.sheets({ version: "v4", auth });

  // D列まで読み込む
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "全商品取り扱いリスト!A:D",
  });

  const rows = response.data.values || [];
  const result: ProductRecord[] = [];

  for (const row of rows) {
    const jan = String(row[0] || "").trim().replace(/^'/, "");
    const code = String(row[1] || "").trim();
    const nameKeywords = String(row[2] || "").trim();
    const deliveryKeywords = String(row[3] || "").trim();
    if (code) {
      result.push({ jan, code, nameKeywords, deliveryKeywords });
    }
  }

  return result;
}

/** スプレッドシートのD列にキーワードを追記する */
export async function appendDeliveryKeyword(
  code: string,
  keyword: string
): Promise<{ ok: boolean; error?: string }> {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) return { ok: false, error: "SPREADSHEET_ID が設定されていません" };

  try {
    const auth = getAuthClient(false);
    const sheets = google.sheets({ version: "v4", auth });

    // 全行を取得してcodeが一致する行番号を探す
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "全商品取り扱いリスト!A:D",
    });

    const rows = response.data.values || [];
    let rowIndex = -1;
    let currentD = "";

    for (let i = 0; i < rows.length; i++) {
      const rowCode = String(rows[i][1] || "").trim();
      if (rowCode === code) {
        rowIndex = i + 1; // 1-indexed
        currentD = String(rows[i][3] || "").trim();
        break;
      }
    }

    if (rowIndex < 0) {
      return { ok: false, error: `コード「${code}」が見つかりません` };
    }

    // 既存キーワードに追記（重複除去）
    const existing = currentD
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const newKeywords = keyword
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const merged = [...existing, ...newKeywords].filter((k) => {
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).join(",");

    // D列を更新
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `全商品取り扱いリスト!D${rowIndex}`,
      valueInputOption: "RAW",
      requestBody: { values: [[merged]] },
    });

    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/** DBに商品マスターを同期保存 */
export async function syncProductsToDB(records: ProductRecord[]): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("データベースに接続できません");

  await db.delete(products);

  if (records.length === 0) return 0;

  const batchSize = 500;
  let inserted = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize).map((r) => ({
      jan: r.jan,
      code: r.code,
      nameKeywords: r.nameKeywords,
      deliveryKeywords: r.deliveryKeywords,
    }));
    await db.insert(products).values(batch);
    inserted += batch.length;
  }

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
      deliveryKeywords: r.deliveryKeywords ?? "",
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

  const dbProducts = await loadFromDB();
  if (dbProducts && dbProducts.length > 0) {
    cachedProducts = dbProducts;
    cacheTime = now;
    return dbProducts;
  }

  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) return [];

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

/** 仕入先コードのハイフン後部分で照合（品番照合） */
export function matchBySupplierCode(
  supplierCode: string,
  products: ProductRecord[],
  supplierPrefix?: string
): string | null {
  if (!supplierCode) return null;
  const norm = supplierCode.toLowerCase().replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  ).trim();

  // 絞り込み対象
  const candidates = supplierPrefix
    ? products.filter((p) => p.code.startsWith(supplierPrefix + "-"))
    : products;

  for (const p of candidates) {
    // B列コードのハイフン後部分と照合
    const afterHyphen = p.code.split("-").slice(1).join("-").toLowerCase();
    if (afterHyphen && norm.includes(afterHyphen)) return p.code;
    if (afterHyphen && afterHyphen.includes(norm)) return p.code;
  }
  return null;
}

/** 商品名あいまいマッチング（仕入元絞り込み対応） */
export function matchByName(
  productName: string,
  products: ProductRecord[],
  supplierPrefix?: string
): string | null {
  if (!productName) return null;

  const normalize = (s: string) =>
    s
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[　]/g, " ")
      .toLowerCase()
      .trim();

  const normInput = normalize(productName);
  const inputNoSpace = normInput.replace(/\s+/g, "");

  // 仕入元プレフィックスで絞り込み
  const candidates = supplierPrefix
    ? products.filter((p) => p.code.startsWith(supplierPrefix + "-"))
    : products;

  let bestCode: string | null = null;
  let bestScore = 0;

  for (const p of candidates) {
    // C列（nameKeywords）とD列（deliveryKeywords）を結合して照合
    const combinedKeywords = [p.nameKeywords, p.deliveryKeywords].filter(Boolean).join(" ");
    if (!combinedKeywords) continue;

    const normKeywords = normalize(combinedKeywords);
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

    // パス3: サブストリングマッチング（トークン内の重複なし全マッチ）
    if (score < 2) {
      let subScore = 0;
      for (const token of inputTokens) {
        const used = new Array(token.length).fill(false);
        for (let len = Math.min(token.length, 6); len >= 2; len--) {
          for (let i = 0; i <= token.length - len; i++) {
            if (used.slice(i, i + len).some((v) => v)) continue;
            const sub = token.substring(i, i + len);
            if (/^\d+$/.test(sub)) continue; // 純粋な数字のみは除外
            if (normKeywords.includes(sub)) {
              subScore += /\d/.test(sub) ? 2 : 1;
              for (let j = i; j < i + len; j++) used[j] = true;
            }
          }
        }
      }
      if (subScore > score) score = subScore;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCode = p.code;
    }
  }

  return bestScore >= 2 ? bestCode : null;
}
