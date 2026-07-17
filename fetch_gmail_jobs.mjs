/**
 * DBからGmailジョブのCSVデータを取得して、照合済み商品コードを抽出する
 */
import { createRequire } from "module";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dotenv = require("dotenv");
dotenv.config({ path: resolve(__dirname, ".env") });

const mysql = require("mysql2/promise");
const db = await mysql.createConnection(process.env.DATABASE_URL);

// Gmailジョブ一覧を取得
const [jobs] = await db.query(
  "SELECT id, filename, fromEmail, processedAt, rowCount, notFoundCount, csvContent, status FROM gmail_jobs ORDER BY processedAt DESC LIMIT 500"
);

console.log(`\n=== Gmailジョブ一覧 (${jobs.length}件) ===`);
for (const job of jobs) {
  const date = new Date(job.processedAt).toLocaleString("ja-JP");
  console.log(`[${job.id}] ${date} | ${job.filename} | rows:${job.rowCount} notFound:${job.notFoundCount}`);
}

// CSV内容から照合済み商品コードを集計
console.log("\n=== 照合済み商品コード集計 ===");
const codeSet = new Set();

for (const job of jobs) {
  if (!job.csvContent) continue;
  const lines = job.csvContent.split("\n").slice(1); // ヘッダーをスキップ
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split(",");
    const code = cols[0]?.trim();
    if (!code) continue;
    codeSet.add(code);
  }
}

console.log(`照合済みユニークコード数: ${codeSet.size}件`);
console.log("\nコード一覧:");
for (const code of [...codeSet].sort()) {
  console.log(`  ${code}`);
}

await db.end();
