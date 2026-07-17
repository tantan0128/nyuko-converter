/**
 * Gmailのクエリ問題をデバッグ＆メールを直接処理するスクリプト
 */
import { createRequire } from "module";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dotenv = require("dotenv");
const { google } = require("googleapis");
dotenv.config({ path: resolve(__dirname, ".env") });

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;
const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
oauth2Client.setCredentials({ refresh_token: refreshToken });
const gmail = google.gmail({ version: "v1", auth: oauth2Client });

// 各クエリで検索してみる
const queries = [
  "has:attachment filename:pdf",
  "has:attachment filename:.pdf",
  "has:attachment",
  "filename:pdf",
  "subject:スキャン",
  "from:yasubase-printer",
];

for (const q of queries) {
  const res = await gmail.users.messages.list({ userId: "me", q, maxResults: 5 });
  const count = res.data.resultSizeEstimate || 0;
  const msgs = res.data.messages || [];
  console.log(`クエリ「${q}」: ${count}件 (実際: ${msgs.length}件)`);
}

// ラベルなしで全件取得
console.log("\n=== ラベルなし全件取得 ===");
const allRes = await gmail.users.messages.list({ userId: "me", maxResults: 20, includeSpamTrash: true });
console.log("全件(スパム含む):", allRes.data.resultSizeEstimate, "件");
