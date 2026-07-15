/**
 * スプレッドシートからJANなし商品（C列キーワードで照合できるもの）を検索
 */
import { google } from "googleapis";
import * as dotenv from "dotenv";
dotenv.config();

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CRED_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const RANGE = "全商品取り扱いリスト!A:C";

const credentials = JSON.parse(CRED_JSON);
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });

const SEARCH_TERMS = [
  "RADEN", "raden", "螺鈿",
  "東洋竹工", "団扇立", "うちわ立",
  "ふじた", "風鈴", "鉄瓶",
  "大岸", "とんがり",
  "大寺", "蝶々", "烏の鈴",
  "木村硝子", "深寶",
  "藤芸", "チャンドラ",
  "塩見", "なごみ",
  "三力", "シンフォニー",
  "SUN GLASS", "墨流し",
  "メルクロス", "庄六",
  "ヤマト", "PZN",
  "中西富一", "フライパン洗い",
  "ムラエ", "ナポレオン",
  "シラキ", "ReJAPAN",
];

async function main() {
  console.log("スプレッドシートを読み込み中...");
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE,
  });
  const rows = res.data.values || [];
  console.log(`総行数: ${rows.length}\n`);

  // JANなし行（A列が空またはヘッダー行以外）
  const noJanRows = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const jan = String(row[0] || "").trim().replace(/^'/, "");
    const code = String(row[1] || "").trim();
    const kw = String(row[2] || "").trim();
    if (!jan && code) {
      noJanRows.push({ rowNum: i + 1, jan, code, kw });
    }
  }
  console.log(`JANなし行: ${noJanRows.length}件`);
  if (noJanRows.length > 0) {
    console.log("--- JANなし行（最初の50件）---");
    noJanRows.slice(0, 50).forEach(r => {
      console.log(`  行${r.rowNum}: CODE="${r.code}" KW="${r.kw}"`);
    });
  }

  // キーワード検索
  console.log("\n--- キーワード検索結果 ---");
  for (const term of SEARCH_TERMS) {
    const found = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const kw = String(row[2] || "").toLowerCase();
      const code = String(row[1] || "").trim();
      const jan = String(row[0] || "").trim();
      if (kw.includes(term.toLowerCase())) {
        found.push({ rowNum: i + 1, jan, code, kw: row[2] });
      }
    }
    if (found.length > 0) {
      console.log(`\n"${term}" → ${found.length}件`);
      found.slice(0, 5).forEach(r => {
        console.log(`  行${r.rowNum}: JAN="${r.jan}" CODE="${r.code}" KW="${r.kw}"`);
      });
    }
  }
}

main().catch(console.error);
