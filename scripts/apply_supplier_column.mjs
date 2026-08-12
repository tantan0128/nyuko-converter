import fs from "node:fs";
import { google } from "googleapis";

function value(v) {
  return String(v ?? "").trim();
}

function loadVendorMap() {
  const source = fs.readFileSync("/home/ubuntu/nyuko-converter/server/sheets.ts", "utf8");
  const block = source.match(/VENDOR_CODE_TO_NAME: Record<string, string> = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error("VENDOR_CODE_TO_NAME の定義が見つかりません");

  const map = {};
  for (const match of block[1].matchAll(/^\s*([a-z0-9]+):\s*"([^"]+)",?\s*$/gm)) {
    map[match[1]] = match[2];
  }
  return map;
}

function getPrefix(code) {
  return (value(code).match(/^([a-z0-9]+)-/i)?.[1] || "").toLowerCase();
}

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.SPREADSHEET_ID) {
  throw new Error("Googleスプレッドシート接続用の環境変数がありません");
}

const vendors = loadVendorMap();
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.SPREADSHEET_ID;
const sheetName = "全商品取り扱いリスト";

// 更新直前の値を読込み、E列が空の定義済み接頭辞だけを対象にする。
const before = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: `${sheetName}!A:E`,
});
const rows = before.data.values || [];
const updates = [];
const unmapped = [];
const preservedExisting = [];

for (let index = 1; index < rows.length; index++) {
  const row = rows[index];
  const code = value(row[1]);
  const currentSupplier = value(row[4]);
  const prefix = getPrefix(code);
  const supplier = vendors[prefix];

  if (currentSupplier) {
    preservedExisting.push({ row: index + 1, code, prefix, supplier: currentSupplier });
    continue;
  }
  if (!supplier) {
    unmapped.push({ row: index + 1, code, prefix });
    continue;
  }
  updates.push({ row: index + 1, code, prefix, supplier });
}

// API制限を考慮し、500セルずつ更新する。
const batchSize = 500;
for (let start = 0; start < updates.length; start += batchSize) {
  const batch = updates.slice(start, start + batchSize);
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: batch.map((update) => ({
        range: `${sheetName}!E${update.row}`,
        values: [[update.supplier]],
      })),
    },
  });
}

// 更新後の対象セルを再読込みし、定義どおりに書き込まれたことを検証する。
const verificationFailures = [];
for (let start = 0; start < updates.length; start += batchSize) {
  const batch = updates.slice(start, start + batchSize);
  const verified = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: batch.map((update) => `${sheetName}!E${update.row}`),
  });
  const valueRanges = verified.data.valueRanges || [];
  for (let index = 0; index < batch.length; index++) {
    const expected = batch[index];
    const actual = value(valueRanges[index]?.values?.[0]?.[0]);
    if (actual !== expected.supplier) {
      verificationFailures.push({ ...expected, actual });
    }
  }
}

const prefixSummary = {};
for (const update of updates) {
  prefixSummary[update.prefix] = (prefixSummary[update.prefix] || 0) + 1;
}

console.log(JSON.stringify({
  results: {
    updatedRows: updates.length,
    preservedExistingRows: preservedExisting.length,
    unmappedRows: unmapped.length,
    verificationFailures: verificationFailures.length,
  },
  updatedByPrefix: prefixSummary,
  unmappedPrefixes: [...new Set(unmapped.map((item) => item.prefix || "形式外"))].sort(),
  unmappedSamples: unmapped.slice(0, 30),
  verificationFailures,
}, null, 2));
