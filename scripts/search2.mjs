import { google } from "googleapis";
import * as dotenv from "dotenv";
dotenv.config();

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CRED_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const RANGE = "全商品取り扱いリスト!A:C";

const credentials = JSON.parse(CRED_JSON);
const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
const sheets = google.sheets({ version: "v4", auth });

const TERMS = ["RADEN","螺鈿","蝶々","チャンドラ","なごみ","ふじた","烏の鈴","PZN01","PZN","ヤマト株式会社","草土","ムラエ","エフディー","廣田硝子"];

async function main() {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: RANGE });
  const rows = res.data.values || [];
  console.log(`総行数: ${rows.length}`);

  for (const term of TERMS) {
    const found = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const kw = String(row[2] || "");
      const code = String(row[1] || "");
      const jan = String(row[0] || "");
      if (kw.toLowerCase().includes(term.toLowerCase()) || code.toLowerCase().includes(term.toLowerCase())) {
        found.push({ rowNum: i+1, jan, code, kw });
      }
    }
    if (found.length > 0) {
      console.log(`\n"${term}" → ${found.length}件`);
      found.slice(0,3).forEach(r => console.log(`  行${r.rowNum}: JAN="${r.jan}" CODE="${r.code}" KW="${r.kw}"`));
    } else {
      console.log(`"${term}" → 0件（未登録）`);
    }
  }
}
main().catch(console.error);
