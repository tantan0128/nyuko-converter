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

// 全メールのラベルを確認
console.log("=== 全メールのラベル詳細 ===");
const allMail = await gmail.users.messages.list({ userId: "me", maxResults: 10, includeSpamTrash: true });
const allList = allMail.data.messages || [];
console.log("全メール数:", allList.length);

for (const msg of allList) {
  const m = await gmail.users.messages.get({ userId: "me", id: msg.id, format: "metadata", metadataHeaders: ["Subject", "From", "Date"] });
  const headers = m.data.payload?.headers || [];
  const subject = headers.find(h => h.name === "Subject")?.value || "";
  const labels = m.data.labelIds || [];
  console.log(`  ID: ${msg.id}`);
  console.log(`  Subject: ${subject}`);
  console.log(`  Labels: ${labels.join(", ")}`);
  console.log(`  nyuko-processed含む: ${labels.some(l => l.includes("nyuko") || l.startsWith("Label_"))}`);
  
  // Label_1の詳細を確認
  for (const labelId of labels) {
    if (labelId.startsWith("Label_")) {
      const labelInfo = await gmail.users.labels.get({ userId: "me", id: labelId });
      console.log(`  ラベル詳細 ${labelId}: ${labelInfo.data.name}`);
    }
  }
}

// nyuko-processedラベルの存在確認
console.log("\n=== nyuko-processedラベル確認 ===");
const labelsList = await gmail.users.labels.list({ userId: "me" });
for (const label of (labelsList.data.labels || [])) {
  if (label.name?.toLowerCase().includes("nyuko") || label.id?.startsWith("Label_")) {
    console.log(`  ${label.name} (id: ${label.id})`);
  }
}
