import * as dotenv from "dotenv";
dotenv.config();

import { google } from "googleapis";

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);
oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

const gmail = google.gmail({ version: "v1", auth: oauth2Client });

async function checkInbox() {
  // 全メール確認
  const all = await gmail.users.messages.list({
    userId: "me",
    maxResults: 20,
    q: "has:attachment filename:pdf",
  });
  console.log(`PDF添付メール: ${all.data.resultSizeEstimate}件`);

  if (all.data.messages && all.data.messages.length > 0) {
    for (const msg of all.data.messages.slice(0, 10)) {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "Date"],
      });
      const headers = detail.data.payload?.headers || [];
      const subject = headers.find(h => h.name === "Subject")?.value || "(件名なし)";
      const from = headers.find(h => h.name === "From")?.value || "";
      const date = headers.find(h => h.name === "Date")?.value || "";
      const labels = detail.data.labelIds || [];
      const processed = labels.includes("nyuko-processed") ? "✓処理済" : "未処理";
      console.log(`[${processed}] ${date} | ${from} | ${subject}`);
    }
  }

  // 未処理のみ
  const unprocessed = await gmail.users.messages.list({
    userId: "me",
    maxResults: 20,
    q: "has:attachment filename:pdf -label:nyuko-processed",
  });
  console.log(`\n未処理PDF: ${unprocessed.data.resultSizeEstimate}件`);
}

checkInbox().catch(console.error);
