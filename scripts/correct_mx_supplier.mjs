import { google } from "googleapis";

function value(v) {
  return String(v ?? "").trim();
}

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.SPREADSHEET_ID) {
  throw new Error("Googleスプレッドシート接続用の環境変数がありません");
}

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.SPREADSHEET_ID;
const sheetName = "全商品取り扱いリスト";
const oldSupplier = "マックス";
const newSupplier = "メルクロス";

const response = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: `${sheetName}!A:E`,
});
const rows = response.data.values || [];
const updates = [];
const conflicts = [];

for (let index = 1; index < rows.length; index++) {
  const code = value(rows[index][1]);
  const currentSupplier = value(rows[index][4]);
  if (!code.toLowerCase().startsWith("mx-")) continue;

  if (!currentSupplier || currentSupplier === oldSupplier) {
    updates.push({ row: index + 1, code, previous: currentSupplier, next: newSupplier });
  } else if (currentSupplier !== newSupplier) {
    conflicts.push({ row: index + 1, code, currentSupplier });
  }
}

if (updates.length) {
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: updates.map((update) => ({
        range: `${sheetName}!E${update.row}`,
        values: [[update.next]],
      })),
    },
  });
}

const verified = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: `${sheetName}!A:E`,
});
const verificationFailures = updates.filter((update) => value(verified.data.values?.[update.row - 1]?.[4]) !== newSupplier);

console.log(JSON.stringify({ correctedRows: updates.length, conflicts, verificationFailures, sample: updates.slice(0, 10) }, null, 2));
