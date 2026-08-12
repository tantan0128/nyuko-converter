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
const expectedOldSupplier = "大泉物産";
const correctSupplier = "片力商事";

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
  if (!code.toLowerCase().startsWith("oi-")) continue;

  if (!currentSupplier || currentSupplier === expectedOldSupplier) {
    updates.push({ row: index + 1, code, previous: currentSupplier, next: correctSupplier });
  } else if (currentSupplier !== correctSupplier) {
    conflicts.push({ row: index + 1, code, currentSupplier });
  }
}

if (updates.length > 0) {
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

const verify = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: `${sheetName}!A:E`,
});
const verificationFailures = [];
for (const update of updates) {
  const actual = value(verify.data.values?.[update.row - 1]?.[4]);
  if (actual !== correctSupplier) verificationFailures.push({ ...update, actual });
}

console.log(JSON.stringify({
  correctedRows: updates.length,
  conflicts,
  verificationFailures,
  sample: updates.slice(0, 10),
}, null, 2));
