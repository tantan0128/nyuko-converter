/**
 * nyuko-processedラベルを外して再処理できるようにする
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

// nyuko-processedラベルのIDを確認
const labelsList = await gmail.users.labels.list({ userId: "me" });
const nyukoLabel = (labelsList.data.labels || []).find(l => l.name === "nyuko-processed");
if (!nyukoLabel) {
  console.log("nyuko-processedラベルが見つかりません");
  process.exit(0);
}
console.log(`nyuko-processedラベルID: ${nyukoLabel.id}`);

// 全メールからラベルを外す
const allMail = await gmail.users.messages.list({ userId: "me", maxResults: 50 });
const allList = allMail.data.messages || [];
let removed = 0;
for (const msg of allList) {
  const m = await gmail.users.messages.get({ userId: "me", id: msg.id, format: "metadata", metadataHeaders: ["Subject"] });
  const labels = m.data.labelIds || [];
  if (labels.includes(nyukoLabel.id)) {
    const headers = m.data.payload?.headers || [];
    const subject = headers.find(h => h.name === "Subject")?.value || "";
    console.log(`ラベルを外す: ${subject} (ID: ${msg.id})`);
    await gmail.users.messages.modify({
      userId: "me",
      id: msg.id,
      requestBody: { removeLabelIds: [nyukoLabel.id] },
    });
    removed++;
    console.log(`  → 完了`);
  }
}
console.log(`\n合計 ${removed} 件のメールからnyuko-processedラベルを外しました`);
