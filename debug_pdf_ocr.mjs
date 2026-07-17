/**
 * GmailからPDFを取得してOCR・Gemini抽出結果を確認するデバッグスクリプト
 */
import { createRequire } from "module";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync } from "fs";
const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dotenv = require("dotenv");
const { google } = require("googleapis");
dotenv.config({ path: resolve(__dirname, ".env") });

// Gmail設定
const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;
const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
oauth2Client.setCredentials({ refresh_token: refreshToken });
const gmail = google.gmail({ version: "v1", auth: oauth2Client });

// 最新のメールからPDFを取得
const allMail = await gmail.users.messages.list({ userId: "me", maxResults: 5 });
const allList = allMail.data.messages || [];

for (const msg of allList) {
  const m = await gmail.users.messages.get({ userId: "me", id: msg.id, format: "full" });
  const headers = m.data.payload?.headers || [];
  const subject = headers.find(h => h.name === "Subject")?.value || "";
  console.log(`\nメール: ${subject}`);
  
  // PDFパートを探す
  function findPdfParts(payload) {
    const parts = [];
    if (payload.mimeType === "application/pdf" && payload.body?.attachmentId) {
      parts.push(payload);
    }
    if (payload.parts) {
      for (const part of payload.parts) {
        parts.push(...findPdfParts(part));
      }
    }
    return parts;
  }
  
  const pdfParts = findPdfParts(m.data.payload);
  for (const part of pdfParts) {
    console.log(`  PDF: ${part.filename} (${part.body?.size} bytes)`);
    
    // PDFをダウンロード
    const attRes = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId: msg.id,
      id: part.body.attachmentId,
    });
    const buffer = Buffer.from(attRes.data.data, "base64url");
    const savePath = `/tmp/${part.filename}`;
    writeFileSync(savePath, buffer);
    console.log(`  保存先: ${savePath}`);
    
    // Document AIでOCR
    console.log("\n  OCR処理中...");
    const { ocrWithDocumentAI } = await import("./server/ocr.js");
    const ocrResult = await ocrWithDocumentAI(buffer, "application/pdf");
    console.log("  OCRテキスト:");
    console.log(ocrResult.text?.substring(0, 2000) || "(テキストなし)");
    if (ocrResult.error) {
      console.log("  OCRエラー:", ocrResult.error);
    }
    
    // Gemini抽出
    console.log("\n  Gemini抽出中...");
    const { extractWithGemini } = await import("./server/ocr.js");
    let imageBase64, imageMimeType;
    if (ocrResult.error) {
      imageBase64 = buffer.toString("base64");
      imageMimeType = "application/pdf";
    }
    const extracted = await extractWithGemini("jan_pdf", ocrResult.text || "", imageBase64, imageMimeType);
    console.log("  抽出結果:");
    console.log(JSON.stringify(extracted, null, 2));
  }
}
