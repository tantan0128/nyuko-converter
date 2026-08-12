import XLSX from "xlsx";
import { google } from "googleapis";

const inputPath = "/home/ubuntu/upload/納品書DX1.0.xlsx";
const workbook = XLSX.readFile(inputPath, { cellDates: false });

function value(v) {
  return String(v ?? "").trim();
}

const excelSheets = {};
for (const sheetName of workbook.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    blankrows: false,
  });
  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const nonEmptyByColumn = Array.from({ length: maxColumns }, (_, index) =>
    rows.slice(1).filter((row) => value(row[index])).length
  );

  excelSheets[sheetName] = {
    rowCount: rows.length,
    headers: rows[0] || [],
    maxColumns,
    nonEmptyByColumn,
    firstRows: rows.slice(0, 8),
  };
}

const masterSheet = workbook.Sheets["マスターデータ"];
const masterRows = XLSX.utils.sheet_to_json(masterSheet, {
  header: 1,
  defval: "",
  blankrows: false,
});

// 添付Excel「マスターデータ」: A=納品書コード、B=カスタム商品コード、C=商品名。
const sourceMappings = masterRows.slice(1).map((row, i) => ({
  row: i + 2,
  deliveryCode: value(row[0]),
  customCode: value(row[1]),
  productName: value(row[2]),
  columnD: value(row[3]),
}));

const withDeliveryCode = sourceMappings.filter((row) => row.deliveryCode && row.customCode);

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
  range: "全商品取り扱いリスト!A:D",
});
const rows = response.data.values || [];
const masterByCode = new Map();
for (let index = 1; index < rows.length; index++) {
  const row = rows[index];
  const code = value(row[1]);
  if (code) {
    masterByCode.set(code, {
      row: index + 1,
      jan: value(row[0]),
      code,
      productName: value(row[2]),
      deliveryKeywords: value(row[3]),
    });
  }
}

const matches = [];
const unmatched = [];
for (const source of withDeliveryCode) {
  const target = masterByCode.get(source.customCode);
  if (!target) {
    unmatched.push(source);
    continue;
  }
  const existingKeywords = target.deliveryKeywords
    .split(",")
    .map(value)
    .filter(Boolean);
  const alreadyPresent = existingKeywords.includes(source.deliveryCode);
  matches.push({
    ...source,
    targetRow: target.row,
    targetProductName: target.productName,
    currentDeliveryKeywords: target.deliveryKeywords,
    alreadyPresent,
  });
}

const report = {
  excelSheets,
  source: {
    totalDataRows: sourceMappings.length,
    rowsWithDeliveryCodeAndCustomCode: withDeliveryCode.length,
    rowsWithDeliveryCodeOnly: sourceMappings.filter((row) => row.deliveryCode && !row.customCode).length,
    rowsWithCustomCodeOnly: sourceMappings.filter((row) => !row.deliveryCode && row.customCode).length,
    assumedMapping: "添付Excelのマスターデータ: A列=納品書コード、B列=カスタム商品コード。D列ではなくA列に納品書コードが存在するため、書き込みは行わず検証のみ実施。",
  },
  target: {
    sheetName: "全商品取り扱いリスト",
    totalRows: rows.length - 1,
    codes: masterByCode.size,
  },
  mapping: {
    matched: matches.length,
    unmatched: unmatched.length,
    alreadyPresent: matches.filter((m) => m.alreadyPresent).length,
    pendingAppend: matches.filter((m) => !m.alreadyPresent).length,
    samples: matches.slice(0, 20),
    unmatchedSamples: unmatched.slice(0, 20),
  },
};

console.log(JSON.stringify(report, null, 2));
