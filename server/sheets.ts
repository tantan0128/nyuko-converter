import { google } from "googleapis";
import { getDb } from "./db";
import { products } from "../drizzle/schema";
import fs from "fs";

export interface ProductRecord {
  jan: string;
  code: string;
  nameKeywords: string; // C列: 商品名・検索キーワード
  deliveryKeywords: string; // D列: 納品書キーワード（仕入先品番・別名など）
  supplier: string; // E列: 仕入れ先名
}

// ベンダーコード → 仕入先名のマッピング（ベンダーリスト旧シートより）
export const VENDOR_CODE_TO_NAME: Record<string, string> = {
  // 全商品取り扱いリスト E列（仕入れ先）の実データに基づく
  po: "廣田硝子",
  is: "石丸陶芸",
  ht: "浜陶",
  ou: "大内工芸",
  tu: "筒井時正",
  hr: "平田商店",
  kr: "かのりゅう",
  ka: "かのりゅう",
  sh: "尚雅堂",
  mr: "ムラエ",
  sp: "石川漆宝堂",
  za: "ザッカワークス",
  fk: "ふじた花器",
  ks: "京千",
  oi: "片力商事",
  sd: "塩見団扇",
  du: "ダルトン",
  gx: "ギャラックス貿易",
  kh: "オープランニング",
  th: "クラスアップ",
  ry: "リュウコドウ",
  id: "イシダ",
  kk: "栗川商店",
  sm: "サム企画",
  gt: "我戸幹男商店",
  sa: "三陽エース",
  ok: "オクムラ",
  nk: "中川政七",
  yy: "山善",
  az: "東谷",
  sk: "酒井",
  ww: "ダブリュー",
  og: "扇や半げしょう",
  ro: "日本スエーデン",
  ac: "アミナコレクション",
  cc: "キャリアコンサルティング",
  oo: "大寺幸八郎商店",
  wd: "ワンダーウェイ",
  it: "生田カバン",
  nj: "南條工房",
  mc: "マスターズクラフト",
  hy: "ひょ",
  fo: "フォームレディ",
  kc: "晃祐堂",
  kd: "晃祐堂",
  iz: "インターゼロ",
  wb: "草土",
  yu: "ユープロダクツ",
  mh: "前原光栄商店",
  km: "木村硝子店",
  mz: "丸全",
  su: "伊藤泰三",
  be: "ベアハウス",
  ii: "井助商店",
  up: "urban ole",
  to: "東五六",
  sb: "三彩工房",
  ss: "招徳酒造",
  si: "賞美堂",
  sn: "ソニック",
  nn: "中野科学",
  nb: "ノボル電機",
  tm: "九十九",
  sr: "サカエ金襴",
  ch: "シラキ工芸",
  ap: "アピデ",
  fd: "エフディー",
  tw: "TEN-TWO",
  kf: "公長斎小菅",
  kt: "公長斎小菅",
  yi: "山一",
  mx: "メルクロス",
  ca: "カサラゴ",
  fj: "フジキ工芸",
  pz: "Phezzan",
  // E列実データで確認された追加仕入先
  br: "ブランシュアソシエ",
  cr: "コレド",
  kn: "カク仲",
  kw: "カワイ",
  nf: "ネ・ルフレ",
  sl: "サンライフ",
  le: "タカタレムノス",
  bw: "ビーワーススタイル",
  co: "コーンズ",
  fe: "株式会社シンドー",
  an: "アンツ",
};

// 仕入元プレフィックスと仕入先名のマッピング（照合用キーワード）
// 全商品取り扱いリスト E列（仕入れ先）の実データに基づく
export const SUPPLIER_PREFIX_MAP: Record<string, string[]> = {
  ok: ["オクムラ", "奥村", "okumura", "リバーライト"],
  sa: ["三陽", "sanyo", "さんよう", "三陽エース"],
  th: ["クラスアップ", "classup", "class up", "TOHO"],
  yy: ["ワイヨット", "山善", "wayot", "yamaze"],
  id: ["イシダ", "石田", "ishida"],
  sd: ["塩見", "塩見団扇", "shiomi"],
  pz: ["Phezzan", "フェザーン", "phezzan"],
  nk: ["中川", "nakagawa", "中川政七"],
  du: ["ダルトン", "dalton"],
  kf: ["公長斎", "小菅", "kohchosai"],
  kt: ["公長斎", "小菅", "kohchosai"],
  kh: ["オープランニング", "open planning"],
  ry: ["リュウコドウ", "ryukodo"],
  kr: ["かのりゅう", "kanoryu"],
  ka: ["かのりゅう", "kanoryu"],
  fk: ["ふじた", "藤田花器", "fujita"],
  ks: ["京千", "kyousen", "kyosen"],
  za: ["ザッカワークス", "zacca"],
  po: ["廣田", "ポステック", "hirotag", "postecc"],
  ht: ["浜陶", "hamato"],
  ou: ["大内", "ouchi"],
  sh: ["尚雅堂", "shogado"],
  mr: ["ムラエ", "murae"],
  sp: ["石川漆宝堂", "ishikawa"],
  oi: ["片力", "katariki", "片力商事"],
  gx: ["ギャラックス", "galax"],
  gt: ["我戸幹男", "gato"],
  kk: ["栗川", "kurikawa"],
  sm: ["サム企画", "sam"],
  ac: ["アミナ", "amina"],
  og: ["扇や", "半げしょう", "hangesho"],
  mh: ["前原", "maehara"],
  km: ["木村硝子", "kimura"],
  ap: ["アピデ", "apide"],
  mc: ["マスターズ", "masters"],
  fo: ["フォームレディ", "form lady"],
  mz: ["丸全", "maruzen"],
  fd: ["エフディー", "fd"],
  tw: ["TEN-TWO", "ten two"],
  br: ["ブランシュアソシエ", "blanche"],
  cr: ["コレド", "coledo"],
  kn: ["カク仲", "kakunaka"],
  kw: ["カワイ", "kawai"],
  nf: ["ネ・ルフレ", "nefure", "nerf"],
  sl: ["サンライフ", "sunlife", "sun life"],
  le: ["タカタレムノス", "takata", "lemnos"],
  bw: ["ビーワーススタイル", "beworth"],
  co: ["コーンズ", "coens"],
  fe: ["シンドー", "shindo"],
  an: ["アンツ", "antz"],
  mx: ["メルクロス", "merclos", "melcross"],
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

/**
 * 仕入先名を既知の仕入先リストと照合して標準名に正規化する。
 * Geminiが「株式会社 木村硝子店」「木村硝子店 様」「木村硝子(株)」など
 * 表記ゆらぎ・敬称付きで抽出した場合でも、標準名（例: 木村硝子店）へ統一する。
 * 既知リストに該当しない場合は、抽出名から敬称・住所らしき表記を取り除いたものを返す。
 */
export function normalizeSupplierName(supplierName: string): string | null {
  if (!supplierName) return null;
  const trimmed = supplierName.trim();
  if (!trimmed) return null;

  // 既知の仕入先名（VENDOR_CODE_TO_NAMEの値）と部分一致で標準名へ正規化
  const knownNames = Array.from(new Set(Object.values(VENDOR_CODE_TO_NAME)));
  // 長い名前から順にチェック（「かのりゅう」vs「石川漆宝堂」等の部分一致誤爆を防ぐ）
  const sorted = [...knownNames].sort((a, b) => b.length - a.length);
  for (const known of sorted) {
    if (known.length < 2) continue;
    // 抽出名に既知の仕入先名が含まれる（または逆）場合、標準名を返す
    if (trimmed.includes(known) || known.includes(trimmed)) {
      return known;
    }
  }

  // 既知リストにない場合: 敬称・住所・不要語を除去
  const cleaned = trimmed
    .replace(/^(株式会社|有限会社|合同会社|合資会社)/, "")
    .replace(/(株式会社|有限会社|合同会社|合資会社|\(株\)|（株）)$/, "")
    .replace(/様|御中|行$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

/**
 * 仕入先名が空・不明な場合に、自社商品コードのプレフィックスから仕入先名を逆引きする。
 * 例: code="km-001" → VENDOR_CODE_TO_NAME["km"] = "木村硝子店"
 */
export function supplierNameFromCode(code: string): string | null {
  if (!code) return null;
  const m = code.match(/^([a-z]{2,3})-/i);
  if (!m) return null;
  const prefix = m[1].toLowerCase();
  return VENDOR_CODE_TO_NAME[prefix] || null;
}

// メモリキャッシュ（DB読み込み結果）
let cachedProducts: ProductRecord[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5分キャッシュ

function getAuthClient(readonly = true) {
  const scopes = readonly
    ? ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    : ["https://www.googleapis.com/auth/spreadsheets"];

  // 優先: サービスアカウント（本番運用向け）
  const credJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (credJson) {
    const credentials = JSON.parse(credJson);
    return new google.auth.GoogleAuth({ credentials, scopes });
  }

  // フォールバック: OAuthクライアント（~/.hermes/google_token.json + google-oauth-client.json）
  // Hermes の Google Workspace MCP と同じ認証情報を使う
  const home = process.env.HOME || "/home/aiuser";
  const tokenPath = process.env.GOOGLE_TOKEN_JSON || `${home}/.hermes/google_token.json`;
  const clientPath = `${home}/.hermes/google-oauth-client.json`;
  if (fs.existsSync(tokenPath) && fs.existsSync(clientPath)) {
    const token = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
    const client = JSON.parse(fs.readFileSync(clientPath, "utf8"));
    const oauth = new google.auth.OAuth2(
      client.installed?.client_id || client.web?.client_id,
      client.installed?.client_secret || client.web?.client_secret,
      client.installed?.redirect_uris?.[0] || "http://localhost"
    );
    oauth.setCredentials({
      refresh_token: token.refresh_token,
      access_token: token.token,
      expiry_date: token.expiry ? new Date(token.expiry).getTime() : undefined,
      scope: (token.scopes || []).join(" "),
    });
    return oauth;
  }

  throw new Error(
    "認証情報がありません: GOOGLE_SERVICE_ACCOUNT_JSON または ~/.hermes/google_token.json を設定してください"
  );
}

/** スプレッドシートから商品データを取得（同期用）- A:E列を読み込む */
export async function fetchFromSpreadsheet(): Promise<ProductRecord[]> {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("SPREADSHEET_ID が設定されていません");

  const auth = getAuthClient(true);
  const sheets = google.sheets({ version: "v4", auth });

  // E列（仕入れ先）まで読み込む。ヘッダー行（A2開始）をスキップ
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "全商品取り扱いリスト!A2:E",
  });

  const rows = response.data.values || [];
  const result: ProductRecord[] = [];

  for (const row of rows) {
    const jan = String(row[0] || "").trim().replace(/^'/, "");
    const code = String(row[1] || "").trim();
    const nameKeywords = String(row[2] || "").trim();
    const deliveryKeywords = String(row[3] || "").trim();
    const supplier = String(row[4] || "").trim();
    if (code) {
      result.push({ jan, code, nameKeywords, deliveryKeywords, supplier });
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

/** 商品名でスプレッドシートを検索し、一致行のD列にキーワードを追記する
 * @param keyword D列に登録するキーワード（品番など）
 * @param productName C列の商品名で検索するための名前（省略時はkeywordで検索）
 */
export async function appendKeywordByName(
  keyword: string,
  productName?: string
): Promise<{ ok: boolean; error?: string; matched?: string }> {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) return { ok: false, error: "SPREADSHEET_ID が設定されていません" };

  try {
    const auth = getAuthClient(false);
    const sheets = google.sheets({ version: "v4", auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "全商品取り扱いリスト!A:D",
    });

    const rows = response.data.values || [];
    let rowIndex = -1;
    let currentD = "";
    let matchedName = "";

    // ① まずkeyword（品番）でB列を完全一致検索
    const kwLower = keyword.toLowerCase().trim();
    for (let i = 0; i < rows.length; i++) {
      const code = String(rows[i][1] || "").trim().toLowerCase();
      if (code && code === kwLower) {
        rowIndex = i + 1;
        currentD = String(rows[i][3] || "").trim();
        matchedName = String(rows[i][2] || "").trim();
        break;
      }
    }

    // ② B列で見つからない場合、productName（商品名）でC列を部分一致検索
    if (rowIndex < 0 && productName) {
      const searchLower = productName.toLowerCase().trim();
      for (let i = 0; i < rows.length; i++) {
        const name = String(rows[i][2] || "").trim();
        if (name && name.toLowerCase().includes(searchLower)) {
          rowIndex = i + 1;
          currentD = String(rows[i][3] || "").trim();
          matchedName = name;
          break;
        }
      }
    }

    // ③ 商品名でも見つからない場合、C列でkeywordを部分一致検索
    if (rowIndex < 0) {
      const searchLower = keyword.toLowerCase().trim();
      for (let i = 0; i < rows.length; i++) {
        const name = String(rows[i][2] || "").trim();
        if (name && name.toLowerCase().includes(searchLower)) {
          rowIndex = i + 1;
          currentD = String(rows[i][3] || "").trim();
          matchedName = name;
          break;
        }
      }
    }

    if (rowIndex < 0) {
      return { ok: false, error: `「${keyword}」に一致する商品が見つかりません。スプレッドシートに直接登録してください。` };
    }

    // D列に登録するのはkeyword（品番）
    const existing = currentD.split(",").map((k) => k.trim()).filter(Boolean);
    const newKeywords = keyword.split(",").map((k) => k.trim()).filter(Boolean);
    const seen = new Set<string>();
    const merged = [...existing, ...newKeywords].filter((k) => {
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).join(",");

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `全商品取り扱いリスト!D${rowIndex}`,
      valueInputOption: "RAW",
      requestBody: { values: [[merged]] },
    });

    return { ok: true, matched: matchedName };
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
  const now = new Date();
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize).map((r) => ({
      jan: r.jan,
      code: r.code,
      nameKeywords: r.nameKeywords,
      deliveryKeywords: r.deliveryKeywords,
      supplier: r.supplier ?? "",
      syncedAt: now,
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
      supplier: r.supplier ?? "",
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

/** JANコード完全一致で照合（仕入先絞り込み対応） */
export function matchByJan(
  jan: string,
  products: ProductRecord[],
  supplierName?: string
): string | null {
  if (!jan || jan.length < 8) return null;
  const normalized = jan.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const candidates = supplierName ? filterBySupplier(products, supplierName) : products;
  const found = candidates.find((p) => p.jan === normalized);
  return found?.code || null;
}

/**
 * 仕入先名（E列の値）で商品リストを絞り込む。
 * normalizeSupplierName で正規化した標準名と E列の仕入先名を比較する。
 * 仕入先名が空・不明の場合は全件返す（絞り込みしない）。
 */
export function filterBySupplier(
  products: ProductRecord[],
  supplierName: string
): ProductRecord[] {
  if (!supplierName) return products;
  const normalized = normalizeSupplierName(supplierName);
  if (!normalized) return products;
  // 完全一致を最優先、部分一致も許容（例: 「株式会社 三陽エース」→「三陽エース」）
  const exact = products.filter((p) => p.supplier === normalized);
  if (exact.length > 0) return exact;
  return products.filter(
    (p) => p.supplier && (p.supplier.includes(normalized) || normalized.includes(p.supplier))
  );
}

/**
 * 品番・キーワードの正規化キーを生成する
 * - 全角英数字 → 半角
 * - 大文字 → 小文字
 * - ハイフン類（半角/全角/長音/ダッシュ/マイナス）・空白・全角空白を除去
 * 例: "ＡＢＣ-123" / "abc 123" / "ABC―123" → すべて "abc123"
 */
export function normalizeCodeKey(s: string): string {
  return (s || "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/[\u002D\u2212\u30FC\u2010\u2011\u2012\u2013\u2014\u2015\uFF0D\u301C\uFF5E\s\u3000]+/g, "")
    .trim();
}

/** 数字のみのキーから先頭ゼロを除去する（ゼロ埋め差異の吸収） */
function stripLeadingZeros(s: string): string {
  return s.replace(/^0+(?=\d)/, "");
}

/**
 * 仕入先品番で照合する（品番照合）
 *
 * 照合順序:
 * 1. D列（deliveryKeywords）をカンマ単位に分割し、正規化完全一致（最優先）
 * 2. B列自社商品コードのハイフン後部分との正規化完全一致
 * 部分一致（includes）は誤マッチの元になるため使用しない。
 * 数字のみの品番は先頭ゼロの有無（例: 0123 vs 123）を吸収する。
 */
export function matchBySupplierCode(
  supplierCode: string,
  products: ProductRecord[],
  supplierPrefix?: string,
  supplierName?: string
): string | null {
  if (!supplierCode) return null;
  const inputKey = normalizeCodeKey(supplierCode);
  if (!inputKey) return null;

  // 絞り込み対象（仕入先名 → プレフィックス → 全件 の優先順）
  let candidates = products;
  if (supplierName) {
    const bySupplier = filterBySupplier(products, supplierName);
    if (bySupplier.length > 0) candidates = bySupplier;
  }
  if (supplierPrefix) {
    candidates = candidates.filter((p) => p.code.startsWith(supplierPrefix + "-"));
  }

  const isNumericKey = /^\d+$/.test(inputKey);

  // パス1: D列（納品書キーワード）のカンマ分割・正規化完全一致
  for (const p of candidates) {
    const dKeywords = (p.deliveryKeywords || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    for (const kw of dKeywords) {
      const kwKey = normalizeCodeKey(kw);
      if (!kwKey) continue;
      if (kwKey === inputKey) return p.code;
      // 数字のみの場合はゼロ埋め差異を吸収
      if (
        isNumericKey &&
        /^\d+$/.test(kwKey) &&
        stripLeadingZeros(kwKey) === stripLeadingZeros(inputKey)
      ) {
        return p.code;
      }
    }
  }

  // パス2: B列コードのハイフン後部分との正規化完全一致
  for (const p of candidates) {
    const afterHyphen = p.code.split("-").slice(1).join("-");
    const afterHyphenKey = normalizeCodeKey(afterHyphen);
    if (!afterHyphenKey) continue;
    if (afterHyphenKey === inputKey) return p.code;
    // 数字のみの場合はゼロ埋め差異を吸収
    if (
      isNumericKey &&
      /^\d+$/.test(afterHyphenKey) &&
      stripLeadingZeros(afterHyphenKey) === stripLeadingZeros(inputKey)
    ) {
      return p.code;
    }
  }

  return null;
}

/** 商品名あいまいマッチング（仕入元絞り込み対応） */
export function matchByName(
  productName: string,
  products: ProductRecord[],
  supplierPrefix?: string,
  supplierName?: string
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
  const inputTokens = normInput.split(/\s+/).filter(Boolean);
  if (inputTokens.length === 0) return null;

  // 仕入先名 → プレフィックス の順で絞り込み
  let candidates = products;
  let narrowed = false; // 仕入先名で実際に絞り込まれたか
  if (supplierName) {
    const bySupplier = filterBySupplier(products, supplierName);
    if (bySupplier.length > 0) {
      candidates = bySupplier;
      narrowed = bySupplier.length < products.length;
    }
  }
  if (supplierPrefix) {
    candidates = candidates.filter((p) => p.code.startsWith(supplierPrefix + "-"));
    narrowed = narrowed || candidates.length < products.length;
  }

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

  // 仕入先名・プレフィックスで絞り込めた場合は誤マッチリスクが低いので閾値を下げる
  // （単一トークンの日本語商品名「抹茶碗」等もスコア1で採用できる）
  const threshold = narrowed ? 1 : 2;

  return bestScore >= threshold ? bestCode : null;
}

/** 十二堂商品リストのレコード型 */
export interface JunidouRecord {
  junidouCode: string; // A列: 十二堂コード
  sukenekoCde: string; // B列: 助ネコ商品コード
  name: string;        // C列: 商品名
}

/** スプレッドシートから十二堂商品リストを取得 */
export async function fetchJunidouList(): Promise<JunidouRecord[]> {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("SPREADSHEET_ID が設定されていません");

  const auth = getAuthClient(true);
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "十二堂商品リスト!A:C",
  });

  const rows = response.data.values || [];
  const result: JunidouRecord[] = [];

  for (const row of rows) {
    const junidouCode = String(row[0] || "").trim();
    const sukenekoCde = String(row[1] || "").trim();
    const name = String(row[2] || "").trim();
    if (junidouCode && sukenekoCde) {
      result.push({ junidouCode, sukenekoCde, name });
    }
  }

  return result;
}
