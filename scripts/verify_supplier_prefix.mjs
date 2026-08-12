import { google } from "googleapis";

function value(v) {
  return String(v ?? "").trim();
}

const [prefixArg, expectedSupplier] = process.argv.slice(2);
const prefix = value(prefixArg).toLowerCase();
if (!prefix || !expectedSupplier) {
  throw new Error("使用方法: node scripts/verify_supplier_prefix.mjs <接頭辞> <仕入れ元>");
}
if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.SPREADSHEET_ID) {
  throw new Error("Googleスプレッドシート接続用の環境変数がありません");
}

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });
const response = await sheets.spreadsheets.values.get({
  spreadsheetId: process.env.SPREADSHEET_ID,
  range: "全商品取り扱いリスト!A:E",
});

const rows = response.data.values || [];
const targets = [];
for (let index = 1; index < rows.length; index++) {
  const code = value(rows[index][1]);
  if (!code.toLowerCase().startsWith(`${prefix}-`)) continue;
  targets.push({ row: index + 1, code, supplier: value(rows[index][4]) });
}

const failures = targets.filter((target) => target.supplier !== expectedSupplier);
console.log(JSON.stringify({
  prefix,
  expectedSupplier,
  totalRows: targets.length,
  matchingRows: targets.length - failures.length,
  verificationFailures: failures,
}, null, 2));
