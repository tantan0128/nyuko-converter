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

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.SPREADSHEET_ID) {
  throw new Error("Googleスプレッドシート接続用の環境変数がありません");
}

const vendors = loadVendorMap();
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
const byPrefix = new Map();
const unmapped = [];
const existingMatches = [];
const existingConflicts = [];
let noCode = 0;
let emptySupplier = 0;

for (let index = 1; index < rows.length; index++) {
  const row = rows[index];
  const code = value(row[1]);
  const existingSupplier = value(row[4]);
  if (!code) {
    noCode++;
    continue;
  }

  const prefix = (code.match(/^([a-z0-9]+)-/i)?.[1] || "").toLowerCase();
  const expectedSupplier = vendors[prefix];
  const entry = byPrefix.get(prefix) || { prefix, supplier: expectedSupplier || null, total: 0, emptyE: 0, existingE: 0 };
  entry.total++;
  if (existingSupplier) entry.existingE++;
  else {
    entry.emptyE++;
    emptySupplier++;
  }
  byPrefix.set(prefix, entry);

  if (!expectedSupplier) {
    unmapped.push({ row: index + 1, code, prefix, currentE: existingSupplier });
  } else if (existingSupplier && existingSupplier === expectedSupplier) {
    existingMatches.push({ row: index + 1, code, supplier: existingSupplier });
  } else if (existingSupplier && existingSupplier !== expectedSupplier) {
    existingConflicts.push({ row: index + 1, code, prefix, expectedSupplier, currentE: existingSupplier });
  }
}

const report = {
  headers: rows[0] || [],
  totalRows: rows.length - 1,
  rowsWithoutCode: noCode,
  emptySupplierCells: emptySupplier,
  vendorMapSize: Object.keys(vendors).length,
  prefixes: [...byPrefix.values()].sort((a, b) => b.total - a.total),
  existing: {
    exactMatches: existingMatches.length,
    conflicts: existingConflicts.length,
    conflictSamples: existingConflicts.slice(0, 30),
  },
  unmapped: {
    rows: unmapped.length,
    prefixes: [...new Set(unmapped.map((item) => item.prefix || "形式外"))].sort(),
    samples: unmapped.slice(0, 30),
  },
};

console.log(JSON.stringify(report, null, 2));
