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

// アカウントプロフィール確認
console.log("=== Gmailアカウント確認 ===");
const profile = await gmail.users.getProfile({ userId: "me" });
console.log("メールアドレス:", profile.data.emailAddress);
console.log("メッセージ総数:", profile.data.messagesTotal);
console.log("スレッド総数:", profile.data.threadsTotal);

// 全メール（INBOXとALL MAIL両方）
console.log("\n=== 全メール（最新10件） ===");
const allMail = await gmail.users.messages.list({ 
  userId: "me", 
  maxResults: 10 
});
console.log("全メール件数(概算):", allMail.data.resultSizeEstimate);
const allList = allMail.data.messages || [];
for (const msg of allList.slice(0, 10)) {
  const m = await gmail.users.messages.get({ 
    userId: "me", 
    id: msg.id, 
    format: "metadata", 
    metadataHeaders: ["Subject", "From", "Date", "To"] 
  });
  const headers = m.data.payload?.headers || [];
  const subject = headers.find(h => h.name === "Subject")?.value || "(件名なし)";
  const from = headers.find(h => h.name === "From")?.value || "";
  const to = headers.find(h => h.name === "To")?.value || "";
  const date = headers.find(h => h.name === "Date")?.value || "";
  const labels = m.data.labelIds || [];
  const parts = m.data.payload?.parts || [];
  const attachments = parts.filter(p => p.filename && p.filename.length > 0).map(p => p.filename);
  console.log(`  [${date}]`);
  console.log(`    To: ${to}`);
  console.log(`    From: ${from}`);
  console.log(`    Subject: ${subject}`);
  console.log(`    Labels: ${labels.join(", ")}`);
  if (attachments.length > 0) console.log(`    添付: ${attachments.join(", ")}`);
}
