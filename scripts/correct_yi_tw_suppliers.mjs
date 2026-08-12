import { google } from "googleapis";

function value(v) {
  return String(v ?? "").trim();
}

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.SPREADSHEET_ID) {
  throw new Error("Googleスプレッドシート接続用の環境変数がありません");
}

const corrections = [
  { prefix: "yi", previous: "山一", next: "ユミトルインポート" },
  { prefix: "tw", previous: "TEN-TWO", next: "十二堂" },
];
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.SPREADSHEET_ID;
const sheetName = "全商品取り扱いリスト";
const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A:E` });
const rows = response.data.values || [];
const updates = [];
const conflicts = [];

for (let index = 1; index < rows.length; index++) {
  const code = value(rows[index][1]).toLowerCase();
  const currentSupplier = value(rows[index][4]);
  const correction = corrections.find((candidate) => code.startsWith(`${candidate.prefix}-`));
  if (!correction) continue;
  if (!currentSupplier || currentSupplier === correction.previous) {
    updates.push({ row: index + 1, code, previous: currentSupplier, next: correction.next });
  } else if (currentSupplier !== correction.next) {
    conflicts.push({ row: index + 1, code, currentSupplier, expected: correction.next });
  }
}

if (updates.length) {
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: updates.map((update) => ({ range: `${sheetName}!E${update.row}`, values: [[update.next]] })),
    },
  });
}

const verified = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A:E` });
const verificationFailures = updates.filter((update) => value(verified.data.values?.[update.row - 1]?.[4]) !== update.next);
const updatedByPrefix = Object.fromEntries(corrections.map((correction) => [correction.prefix, updates.filter((update) => update.code.startsWith(`${correction.prefix}-`)).length]));
console.log(JSON.stringify({ correctedRows: updates.length, updatedByPrefix, conflicts, verificationFailures, sample: updates.slice(0, 10) }, null, 2));
