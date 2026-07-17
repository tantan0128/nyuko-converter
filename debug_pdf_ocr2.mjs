/**
 * GmailからPDFを取得してOCR・Gemini抽出結果を確認するデバッグスクリプト
 * Document AI と Gemini を直接呼び出す
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
    
    const attRes = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId: msg.id,
      id: part.body.attachmentId,
    });
    const buffer = Buffer.from(attRes.data.data, "base64url");
    const savePath = `/tmp/${part.filename}`;
    writeFileSync(savePath, buffer);
    console.log(`  PDFを保存: ${savePath}`);
    
    // Document AIでOCR
    const projectId = process.env.DOCUMENT_AI_PROJECT_ID;
    const location = process.env.DOCUMENT_AI_LOCATION || "us";
    const processorId = process.env.DOCUMENT_AI_PROCESSOR_ID;
    
    if (projectId && processorId) {
      console.log("\n  Document AI OCR処理中...");
      const { DocumentProcessorServiceClient } = require("@google-cloud/documentai").v1;
      const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      const credentials = JSON.parse(serviceAccountJson);
      const client = new DocumentProcessorServiceClient({ credentials });
      const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;
      try {
        const [result] = await client.processDocument({
          name,
          rawDocument: {
            content: buffer.toString("base64"),
            mimeType: "application/pdf",
          },
        });
        const ocrText = result.document?.text || "";
        console.log("  OCRテキスト（最初の2000文字）:");
        console.log(ocrText.substring(0, 2000));
        
        // Gemini APIで抽出
        const forgeApiUrl = process.env.BUILT_IN_FORGE_API_URL;
        const forgeApiKey = process.env.BUILT_IN_FORGE_API_KEY;
        
        if (forgeApiUrl && forgeApiKey) {
          console.log("\n  Gemini抽出中...");
          const prompt = `以下は納品書のOCRテキストです。JANコードと数量を抽出してください。
          
OCRテキスト:
${ocrText}

以下のJSON形式で返してください:
{
  "date": "YYYY/MM/DD",
  "items": [
    {"jan": "JANコード13桁", "productName": "商品名", "quantity": 数量}
  ]
}`;
          
          const response = await fetch(`${forgeApiUrl}/v1/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${forgeApiKey}`,
            },
            body: JSON.stringify({
              messages: [
                { role: "system", content: "You are a helpful assistant that extracts data from invoice OCR text." },
                { role: "user", content: prompt },
              ],
              response_format: { type: "json_object" },
            }),
          });
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || "{}";
          console.log("  Gemini抽出結果:");
          try {
            console.log(JSON.stringify(JSON.parse(content), null, 2));
          } catch {
            console.log(content);
          }
        }
      } catch (e) {
        console.log("  Document AIエラー:", e.message);
        // PDFをbase64でGeminiに直接送る
        console.log("\n  Geminiに直接PDF送信中...");
        const forgeApiUrl = process.env.BUILT_IN_FORGE_API_URL;
        const forgeApiKey = process.env.BUILT_IN_FORGE_API_KEY;
        const pdfBase64 = buffer.toString("base64");
        const response = await fetch(`${forgeApiUrl}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${forgeApiKey}`,
          },
          body: JSON.stringify({
            messages: [
              { role: "system", content: "You are a helpful assistant that extracts data from invoice PDFs." },
              { role: "user", content: [
                { type: "text", text: "この納品書PDFからJANコードと数量を抽出してください。JSON形式で返してください: {\"date\": \"YYYY/MM/DD\", \"items\": [{\"jan\": \"JANコード\", \"productName\": \"商品名\", \"quantity\": 数量}]}" },
                { type: "file_url", file_url: { url: `data:application/pdf;base64,${pdfBase64}`, mime_type: "application/pdf" } },
              ]},
            ],
            response_format: { type: "json_object" },
          }),
        });
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "{}";
        console.log("  Gemini直接抽出結果:");
        try {
          console.log(JSON.stringify(JSON.parse(content), null, 2));
        } catch {
          console.log(content);
        }
      }
    } else {
      console.log("  Document AI設定なし - Geminiに直接送信...");
      const forgeApiUrl = process.env.BUILT_IN_FORGE_API_URL;
      const forgeApiKey = process.env.BUILT_IN_FORGE_API_KEY;
      const pdfBase64 = buffer.toString("base64");
      const response = await fetch(`${forgeApiUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${forgeApiKey}`,
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "You are a helpful assistant that extracts data from invoice PDFs." },
            { role: "user", content: [
              { type: "text", text: "この納品書PDFからJANコードと数量を抽出してください。JSON形式で返してください: {\"date\": \"YYYY/MM/DD\", \"items\": [{\"jan\": \"JANコード\", \"productName\": \"商品名\", \"quantity\": 数量}]}" },
              { type: "file_url", file_url: { url: `data:application/pdf;base64,${pdfBase64}`, mime_type: "application/pdf" } },
            ]},
          ],
          response_format: { type: "json_object" },
        }),
      });
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "{}";
      console.log("  Gemini直接抽出結果:");
      try {
        console.log(JSON.stringify(JSON.parse(content), null, 2));
      } catch {
        console.log(content);
      }
    }
  }
}
