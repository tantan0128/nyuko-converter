/**
 * スプレッドシートからD列が空の商品を仕入先別に集計する
 */
import { createRequire } from "module";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dotenv = require("dotenv");
const { google } = require("googleapis");
dotenv.config({ path: resolve(__dirname, ".env") });

const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const spreadsheetId = process.env.SPREADSHEET_ID;
const range = process.env.SPREADSHEET_RANGE || "Sheet1!A:F";

const credentials = JSON.parse(serviceAccountJson);
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });

const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
const rows = res.data.values || [];

// ヘッダー行をスキップ
const dataRows = rows.slice(1);

// D列が空の商品を仕入先別に集計
const supplierMap = new Map();
let totalEmpty = 0;
let totalFilled = 0;

for (const row of dataRows) {
  const jan = row[0] || "";      // A列: JANコード
  const code = row[1] || "";     // B列: カスタムコード
  const nameKeywords = row[2] || ""; // C列: 商品名キーワード
  const deliveryKeywords = row[3] || ""; // D列: 納品書キーワード
  
  if (!code) continue; // コードなしはスキップ
  
  // プレフィックスを取得（例: hd-4976994800116 → hd）
  const prefix = code.split("-")[0] || "unknown";
  
  if (!supplierMap.has(prefix)) {
    supplierMap.set(prefix, { empty: [], filled: 0 });
  }
  
  if (!deliveryKeywords.trim()) {
    supplierMap.get(prefix).empty.push({ code, nameKeywords });
    totalEmpty++;
  } else {
    supplierMap.get(prefix).filled++;
    totalFilled++;
  }
}

console.log(`\n=== D列記入状況 ===`);
console.log(`記入済み: ${totalFilled}件`);
console.log(`未記入: ${totalEmpty}件`);
console.log(`\n=== 仕入先別 D列未記入商品 ===`);

// 未記入が多い順にソート
const sorted = [...supplierMap.entries()]
  .filter(([, v]) => v.empty.length > 0)
  .sort((a, b) => b[1].empty.length - a[1].empty.length);

for (const [prefix, data] of sorted) {
  console.log(`\n【${prefix}】 未記入: ${data.empty.length}件 / 記入済み: ${data.filled}件`);
  for (const item of data.empty.slice(0, 5)) {
    console.log(`  ${item.code} | C列: ${item.nameKeywords}`);
  }
  if (data.empty.length > 5) {
    console.log(`  ... 他${data.empty.length - 5}件`);
  }
}
