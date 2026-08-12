import XLSX from "xlsx";
import { google } from "googleapis";

const inputPath = "/home/ubuntu/upload/納品書DX1.0.xlsx";
const sheetName = "全商品取り扱いリスト";

function value(v) {
  return String(v ?? "").trim();
}

function splitKeywords(v) {
  return value(v)
    .split(",")
    .map(value)
    .filter(Boolean);
}

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.SPREADSHEET_ID) {
  throw new Error("Googleスプレッドシート接続用の環境変数がありません");
}

const workbook = XLSX.readFile(inputPath, { cellDates: false });
const sourceSheet = workbook.Sheets["マスターデータ"];
if (!sourceSheet) throw new Error("添付Excelに「マスターデータ」シートがありません");

const sourceRows = XLSX.utils.sheet_to_json(sourceSheet, {
  header: 1,
  defval: "",
  blankrows: false,
});

// 添付Excel: A=納品書コード、B=カスタム商品コード
const sourceMappings = sourceRows.slice(1)
  .map((row, index) => ({
    sourceRow: index + 2,
    deliveryCode: value(row[0]),
    customCode: value(row[1]),
    sourceProductName: value(row[2]),
  }))
  .filter((row) => row.deliveryCode && row.customCode);

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.SPREADSHEET_ID;

// 更新直前に最新の全商品リストを読み込む。
const beforeResponse = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: `${sheetName}!A:D`,
});
const targetRows = beforeResponse.data.values || [];
const targetByCode = new Map();
for (let index = 1; index < targetRows.length; index++) {
  const row = targetRows[index];
  const code = value(row[1]);
  if (code) {
    targetByCode.set(code, {
      rowNumber: index + 1,
      code,
      productName: value(row[2]),
      keywords: splitKeywords(row[3]),
    });
  }
}

const updates = [];
const alreadyPresent = [];
const unmatched = [];

for (const source of sourceMappings) {
  const target = targetByCode.get(source.customCode);
  if (!target) {
    unmatched.push(source);
    continue;
  }

  if (target.keywords.includes(source.deliveryCode)) {
    alreadyPresent.push({ ...source, targetRow: target.rowNumber });
    continue;
  }

  const nextKeywords = [...target.keywords, source.deliveryCode];
  updates.push({
    ...source,
    targetRow: target.rowNumber,
    targetProductName: target.productName,
    previousValue: target.keywords.join(","),
    nextValue: nextKeywords.join(","),
  });
}

// 同じD列を複数回更新しないように一意化する。
const updateByRow = new Map();
for (const update of updates) {
  const existing = updateByRow.get(update.targetRow);
  if (!existing) {
    updateByRow.set(update.targetRow, update);
    continue;
  }
  const merged = [...splitKeywords(existing.nextValue), update.deliveryCode];
  existing.nextValue = [...new Set(merged)].join(",");
}
const uniqueUpdates = [...updateByRow.values()];

if (uniqueUpdates.length > 0) {
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: uniqueUpdates.map((update) => ({
        range: `${sheetName}!D${update.targetRow}`,
        values: [[update.nextValue]],
      })),
    },
  });
}

// 更新後に対象D列を再読込し、追記結果を検証する。
const verification = await sheets.spreadsheets.values.batchGet({
  spreadsheetId,
  ranges: uniqueUpdates.map((update) => `${sheetName}!D${update.targetRow}`),
});
const verificationValues = verification.data.valueRanges || [];
const verificationFailures = [];
for (let index = 0; index < uniqueUpdates.length; index++) {
  const update = uniqueUpdates[index];
  const writtenValue = value(verificationValues[index]?.values?.[0]?.[0]);
  if (writtenValue !== update.nextValue) {
    verificationFailures.push({
      targetRow: update.targetRow,
      code: update.customCode,
      expected: update.nextValue,
      actual: writtenValue,
    });
  }
}

const report = {
  source: {
    workbook: inputPath,
    sheet: "マスターデータ",
    mapping: "A列（納品書コード）をB列（カスタム商品コード）で全商品リストB列へ対応付け",
    sourceRowsWithBothCodes: sourceMappings.length,
  },
  results: {
    updatedRows: uniqueUpdates.length,
    sourceMappingsAlreadyPresent: alreadyPresent.length,
    sourceMappingsUnmatched: unmatched.length,
    verificationFailures: verificationFailures.length,
  },
  updated: uniqueUpdates,
  unmatchedSamples: unmatched.slice(0, 20),
  verificationFailures,
};

console.log(JSON.stringify(report, null, 2));
