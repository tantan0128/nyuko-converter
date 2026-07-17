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

// 全メールを取得して添付ファイルの詳細を確認
const allMail = await gmail.users.messages.list({ userId: "me", maxResults: 10 });
const allList = allMail.data.messages || [];

for (const msg of allList) {
  const m = await gmail.users.messages.get({ userId: "me", id: msg.id, format: "full" });
  const headers = m.data.payload?.headers || [];
  const subject = headers.find(h => h.name === "Subject")?.value || "(件名なし)";
  console.log(`\n=== メール: ${subject} ===`);
  console.log(`ID: ${msg.id}`);
  
  // パーツを再帰的に確認
  function inspectParts(parts, depth = 0) {
    if (!parts) return;
    for (const part of parts) {
      const indent = "  ".repeat(depth);
      console.log(`${indent}mimeType: ${part.mimeType}`);
      if (part.filename) {
        console.log(`${indent}  filename: ${part.filename}`);
        console.log(`${indent}  size: ${part.body?.size}`);
        console.log(`${indent}  attachmentId: ${part.body?.attachmentId ? "あり" : "なし"}`);
      }
      if (part.parts) inspectParts(part.parts, depth + 1);
    }
  }
  
  const payload = m.data.payload;
  console.log(`ルートmimeType: ${payload?.mimeType}`);
  if (payload?.filename) {
    console.log(`ルートfilename: ${payload.filename}`);
  }
  inspectParts(payload?.parts);
}
