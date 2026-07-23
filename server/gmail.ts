/**
 * Gmail連携モジュール
 * 複合機からスキャンされたPDF添付メールを自動取り込みして処理する
 */
import { google } from "googleapis";

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

function getGmailClient() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Gmail認証情報が設定されていません（GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN）");
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

export interface GmailAttachment {
  messageId: string;
  subject: string;
  from: string;
  date: string;
  filename: string;
  mimeType: string;
  data: Buffer;
}

/**
 * 未処理のPDF添付メールを取得する
 * ラベル「nyuko-processed」がついていないメールを対象とする
 */
export async function fetchUnprocessedPdfEmails(): Promise<GmailAttachment[]> {
  const gmail = getGmailClient();

  // nyuko-processedラベルIDを取得
  const processedLabelId = await getOrCreateLabel(gmail, "nyuko-processed");

  // 未処理の添付メールを取得（クエリはインデックス遅延の影響を受けるため、ラベルIDでフィルタリング）
  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: "has:attachment",
    maxResults: 50,
  });

  // ラベルIDで未処理のみフィルタリング
  const allMessages = listRes.data.messages || [];
  const messages = allMessages.filter(msg => {
    // メッセージのラベルは後で確認するため、ここでは全件返す
    return true;
  });
  const attachments: GmailAttachment[] = [];

  for (const msg of messages) {
    if (!msg.id) continue;

    try {
      const msgRes = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "full",
      });

      // 処理済ラベルIDが付いている場合はスキップ
      const msgLabels = msgRes.data.labelIds || [];
      if (msgLabels.includes(processedLabelId)) continue;

      const payload = msgRes.data.payload;
      if (!payload) continue;

      // メタデータ取得
      const headers = payload.headers || [];
      const subject = headers.find((h) => h.name === "Subject")?.value || "(件名なし)";
      const from = headers.find((h) => h.name === "From")?.value || "";
      const date = headers.find((h) => h.name === "Date")?.value || "";

      // 添付ファイルを再帰的に探す
      const pdfParts = findPdfParts(payload);

      for (const part of pdfParts) {
        if (!part.body?.attachmentId || !part.filename) continue;

        const attRes = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId: msg.id,
          id: part.body.attachmentId,
        });

        const data = attRes.data.data;
        if (!data) continue;

        // Base64URLデコード
        const buffer = Buffer.from(data, "base64url");

        attachments.push({
          messageId: msg.id,
          subject,
          from,
          date,
          filename: part.filename,
          mimeType: part.mimeType || "application/pdf",
          data: buffer,
        });
      }
    } catch (e) {
      console.error(`[gmail] メッセージ ${msg.id} の取得エラー:`, e);
    }
  }

  return attachments;
}

/** PDFパートを再帰的に探す（mimeTypeまたはファイル名で判定） */
function findPdfParts(payload: any): any[] {
  const parts: any[] = [];

  const isPdf =
    payload.mimeType === "application/pdf" ||
    (payload.filename && payload.filename.toLowerCase().endsWith(".pdf"));

  if (isPdf && payload.body?.attachmentId) {
    parts.push(payload);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      parts.push(...findPdfParts(part));
    }
  }

  return parts;
}

/**
 * 処理済みラベルを付ける
 * ラベルがなければ作成する
 */
export async function markAsProcessed(messageId: string): Promise<void> {
  const gmail = getGmailClient();

  // ラベルを取得または作成
  const labelId = await getOrCreateLabel(gmail, "nyuko-processed");

  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds: [labelId],
    },
  });
}

async function getOrCreateLabel(gmail: any, labelName: string): Promise<string> {
  const listRes = await gmail.users.labels.list({ userId: "me" });
  const labels = listRes.data.labels || [];

  const existing = labels.find((l: any) => l.name === labelName);
  if (existing) return existing.id;

  const createRes = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: labelName,
      labelListVisibility: "labelHide",
      messageListVisibility: "hide",
    },
  });

  return createRes.data.id;
}

/** Gmail接続テスト */
// Gmail Refresh Token renewed 2026-07-23
export async function testGmailConnection(): Promise<{ ok: boolean; email?: string; error?: string }> {
  try {
    const gmail = getGmailClient();
    const profile = await gmail.users.getProfile({ userId: "me" });
    return { ok: true, email: profile.data.emailAddress || undefined };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
