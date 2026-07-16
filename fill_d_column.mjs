import { createRequire } from "module";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dotenv = require("dotenv");
const { google } = require("googleapis");

dotenv.config({ path: resolve(__dirname, ".env") });

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = "全商品取り扱いリスト";

function getAuthClient() {
  const credJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON が設定されていません");
  const credentials = JSON.parse(credJson);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

/**
 * カスタム商品コードからベンダーコードを抽出
 * 例: "id-4580219383232" → "id"
 */
function extractVendorCode(code) {
  const m = code.match(/^([a-z]+)-/);
  return m ? m[1] : null;
}

/**
 * カスタム商品コードのハイフン後ろ部分を抽出（品番）
 * 例: "du-r615-737" → "r615-737"
 * 例: "id-4580219383232" → "4580219383232"（JANと同じ場合は除外）
 */
function extractItemCode(code, jan) {
  const parts = code.split("-");
  if (parts.length < 2) return null;
  const itemPart = parts.slice(1).join("-");
  // JANコードと同じ場合はキーワードとして不要
  if (jan && itemPart === jan) return null;
  // 純粋な数字のみ（JANコードの可能性が高い）は除外
  if (/^\d{8,}$/.test(itemPart)) return null;
  return itemPart;
}

/**
 * 商品名から括弧内の型番・品番を抽出
 * 例: "スマートキーケース JIBBON ジボン 革 イタリアンレザー【ypt】" → "ypt"
 */
function extractModelFromName(productName) {
  const keywords = [];
  // 【...】内の文字列
  const m1 = productName.match(/【([^】]+)】/g);
  if (m1) keywords.push(...m1.map(s => s.replace(/[【】]/g, "").trim()));
  // [...]内の文字列
  const m2 = productName.match(/\[([^\]]+)\]/g);
  if (m2) keywords.push(...m2.map(s => s.replace(/[\[\]]/g, "").trim()));
  return keywords.filter(k => k.length > 0 && k.length <= 20);
}

/**
 * 商品名から英数字の型番を抽出（アルファベット+数字の組み合わせ）
 * 例: "R615-737", "1071497"
 */
function extractAlphanumericCode(productName) {
  // アルファベット+数字の組み合わせ（2文字以上）
  const matches = productName.match(/[A-Za-z][A-Za-z0-9\-]{2,}/g) || [];
  return matches.filter(m => m.length >= 3 && m.length <= 20);
}

async function main() {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  // A:D列を取得
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:D`,
  });

  const rows = response.data.values || [];
  console.log(`取得行数: ${rows.length}`);

  // D列の更新データを準備
  const updates = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const jan = String(row[0] || "").trim().replace(/^'/, "");
    const code = String(row[1] || "").trim();
    const productName = String(row[2] || "").trim();
    const existingD = String(row[3] || "").trim();

    // 1行目（ヘッダー行）の処理
    if (i === 0) {
      if (!existingD) {
        updates.push({ row: i + 1, value: "納品書キーワード" });
        console.log(`行1: ヘッダー追加 → "納品書キーワード"`);
      } else {
        updates.push({ row: i + 1, value: existingD }); // 既存を維持
      }
      continue;
    }

    // コードがない行はスキップ
    if (!code) {
      updates.push({ row: i + 1, value: existingD });
      continue;
    }

    // D列にすでに値がある場合はスキップ
    if (existingD) {
      updates.push({ row: i + 1, value: existingD });
      continue;
    }

    // キーワードを生成
    const keywords = new Set();

    // 1. ベンダーコード後ろの品番（JANと異なる場合）
    const itemCode = extractItemCode(code, jan);
    if (itemCode) keywords.add(itemCode);

    // 2. 商品名内の【...】や[...]の型番
    const modelKeywords = extractModelFromName(productName);
    for (const k of modelKeywords) keywords.add(k);

    // 3. 商品名内の英数字型番（アルファベット始まり）
    const alphaKeywords = extractAlphanumericCode(productName);
    for (const k of alphaKeywords) {
      // 一般的な単語（cm, ml, set等）は除外
      if (!["cm", "ml", "set", "SET", "pro", "PRO", "new", "NEW"].includes(k.toLowerCase())) {
        keywords.add(k);
      }
    }

    const keywordStr = Array.from(keywords).join(",");
    updates.push({ row: i + 1, value: keywordStr });

    if (keywordStr) {
      console.log(`行${i + 1}: ${code} → "${keywordStr}"`);
    }
  }

  // バッチ更新（D列全体を一括書き込み）
  const values = updates.map(u => [u.value]);
  
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!D1:D${updates.length}`,
    valueInputOption: "RAW",
    requestBody: { values },
  });

  const filled = updates.filter((u, i) => i > 0 && u.value && !rows[i]?.[3]).length;
  console.log(`\n完了: ${filled}件のD列キーワードを追加しました`);
}

main().catch(console.error);
