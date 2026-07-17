import * as dotenv from "dotenv";
dotenv.config();
import { google } from "googleapis";

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: "v1", auth: oauth2Client });

async function main() {
  // ラベル一覧
  const labels = await gmail.users.labels.list({ userId: "me" });
  const allLabels = labels.data.labels || [];
  console.log("=== ラベル一覧 ===");
  for (const l of allLabels) {
    console.log(`  ${l.id}: ${l.name}`);
  }

  const nyukoLabel = allLabels.find(l => l.name === "nyuko-processed");
  console.log(`\nnyuko-processedラベル: ${nyukoLabel ? `存在 (ID: ${nyukoLabel.id})` : "存在しない"}`);

  // クエリテスト
  console.log("\n=== クエリテスト ===");
  const queries = [
    "has:attachment",
    "has:attachment -label:nyuko-processed",
    "has:attachment in:inbox",
    "from:yasubase-printer@phezzan.jp",
  ];
  for (const q of queries) {
    const res = await gmail.users.messages.list({ userId: "me", q, maxResults: 5 });
    console.log(`"${q}" → ${res.data.resultSizeEstimate}件`);
  }
}

main().catch(console.error);
