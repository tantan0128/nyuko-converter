/**
 * スプレッドシートのC列（商品名キーワード）を読み込み、
 * JANなし仕入先の商品コードに対してキーワードを設定する。
 *
 * 使い方: node scripts/update_keywords.mjs [--dry-run]
 */

import { google } from "googleapis";
import * as dotenv from "dotenv";
dotenv.config();

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CRED_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const RANGE = "全商品取り扱いリスト!A:C";
const DRY_RUN = process.argv.includes("--dry-run");

if (!SPREADSHEET_ID || !CRED_JSON) {
  console.error("SPREADSHEET_ID または GOOGLE_SERVICE_ACCOUNT_JSON が未設定");
  process.exit(1);
}

const credentials = JSON.parse(CRED_JSON);
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// ===== JANなし仕入先のキーワードマッピング =====
// キー: 商品コード（B列）, 値: キーワード（C列に設定する文字列）
// 商品コードが不明な場合は商品名の一部をキーワードにして照合
// ※ 色バリエーションがある場合は色を除いた共通部分のみ
const KEYWORD_MAP = {
  // 大岸正商店 - RADENシリーズ（色バリエーションあり）
  // 東洋竹工
  // 塩見団扇
  // 三力商事
  // SUN GLASS STUDIO KYOTO
  // メルクロス（扇子系）
  // ヤマト
  // 中西富一工房
  // ムラエ商事
  // 大寺幸八郎商店
  // シラキ工芸
  // ふじた花器
  // 藤芸
};

async function main() {
  // 1. 現在のシート内容を取得
  console.log("スプレッドシートを読み込み中...");
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE,
  });
  const rows = res.data.values || [];
  console.log(`総行数: ${rows.length}`);

  // 2. 現在のC列が空でB列（コード）が存在する行を確認
  const emptyKeywordRows = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const jan = String(row[0] || "").trim();
    const code = String(row[1] || "").trim();
    const keyword = String(row[2] || "").trim();
    if (code && !jan && !keyword) {
      emptyKeywordRows.push({ rowIndex: i + 1, code, jan, keyword });
    }
  }

  console.log(`\nJANなし・キーワードなし行: ${emptyKeywordRows.length}件`);
  emptyKeywordRows.slice(0, 30).forEach(r => {
    console.log(`  行${r.rowIndex}: コード="${r.code}"`);
  });

  // 3. JANありだがキーワードなしの行も確認
  const janRows = rows.filter((r, i) => {
    const jan = String(r[0] || "").trim();
    const code = String(r[1] || "").trim();
    return jan && code;
  });
  console.log(`\nJANあり行: ${janRows.length}件`);

  // 4. 全行のコードとJAN一覧を表示（最初の50行）
  console.log("\n--- 最初の50行のA,B,C列 ---");
  rows.slice(0, 50).forEach((row, i) => {
    const jan = String(row[0] || "").trim();
    const code = String(row[1] || "").trim();
    const kw = String(row[2] || "").trim();
    if (code) {
      console.log(`行${i+1}: JAN="${jan}" CODE="${code}" KW="${kw}"`);
    }
  });
}

main().catch(console.error);
