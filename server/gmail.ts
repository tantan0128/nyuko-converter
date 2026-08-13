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

// ============================================================
// レート制限（User-rate limit）の自己増幅防止
// 429を受けたら Retry after までGmail APIを呼ばない。
// 呼び続けると Retry after が毎回再計算され、制限が延長され続けるため。
// ============================================================
let gmailRateLimitUntil: number | null = null; // epoch ms

/** エラーメッセージから "Retry after <ISO時刻>" をパースして待機時刻を設定する */
export function noteGmailRateLimit(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: number })?.code;
  if (code !== 429 && !/rate limit/i.test(msg)) return;

  const m = msg.match(/Retry after\s+([\dT:.Z+-]+)/i);
  const t = m ? Date.parse(m[1]) : NaN;
  gmailRateLimitUntil = Number.isNaN(t) ? Date.now() + 5 * 60_000 : t;
}

/** レート制限中なら true（この間はAPI呼び出しをスキップする） */
export function isGmailRateLimited(): boolean {
  return gmailRateLimitUntil !== null && Date.now() < gmailRateLimitUntil;
}

/** レート制限が明けたら呼ぶ（成功応答時にリセット） */
export function clearGmailRateLimit(): void {
  gmailRateLimitUntil = null;
}

/** 残り待機秒数（ログ用） */
function rateLimitRemainingSec(): number {
  if (gmailRateLimitUntil === null) return 0;
  return Math.max(0, Math.ceil((gmailRateLimitUntil - Date.now()) / 1000));
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
  // レート制限中はAPIを呼ばず即スキップ（Retry afterまで待つ）
  if (isGmailRateLimited()) {
    console.log(`[gmail] レート制限中のためGmail取得をスキップ（残り${rateLimitRemainingSec()}秒）`);
    return [];
  }

  const gmail = getGmailClient();

  // 処理済みラベル(nyuko-processed)をクエリで除外。
  // 以前は has:attachment で全件取得→個別にラベル確認していたため、
  // 処理済みメールも毎回取得してGmail APIのレート制限(User-rate limit)を
  // 自ら発生させていた。クエリ除外で対象件数が激減する。
  // ただしラベルインデックス反映に遅延があるため、後段のラベルチェックも併用する。
  let listRes;
  try {
    listRes = await gmail.users.messages.list({
      userId: "me",
      q: "has:attachment -label:nyuko-processed",
      maxResults: 50,
    });
  } catch (e) {
    // 最初の一覧取得が429で失敗した場合も、Retry afterを記録してスキップ状態にする。
    // 記録しないと5分ごとに毎回APIを叩いてRetry afterが延び続ける悪循環になる。
    noteGmailRateLimit(e);
    console.error("[gmail] メッセージ一覧の取得に失敗（レート制限として記録）:", e instanceof Error ? e.message : String(e));
    return [];
  }

  const messages = listRes.data.messages || [];
  const attachments: GmailAttachment[] = [];

  // ラベルチェック用のIDを取得（クエリ除外の遅延フォールバック用）。
  // レート制限中にlabels.listも失敗しうるため、失敗しても続行する。
  let processedLabelId: string | null = null;
  try {
    processedLabelId = await getOrCreateLabel(gmail, "nyuko-processed");
  } catch (e) {
    console.error("[gmail] nyuko-processedラベルIDの取得に失敗（クエリ除外のみで継続）:", e instanceof Error ? e.message : String(e));
  }

  for (const msg of messages) {
    if (!msg.id) continue;

    try {
      const msgRes = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "full",
      });

      // 処理済ラベルIDが付いている場合はスキップ（クエリ除外の遅延フォールバック）
      const msgLabels = msgRes.data.labelIds || [];
      if (processedLabelId && msgLabels.includes(processedLabelId)) continue;

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
    } catch (e: unknown) {
      // レート制限エラー(429)は残りのメッセージ取得を中断し、次回スケジュールに回す。
      // 制限中も全件試行し続けると Retry after がどんどん延びる悪循環になるため。
      const errMsg = e instanceof Error ? e.message : String(e);
      const code = (e as { code?: number })?.code;
      if (code === 429 || /rate limit/i.test(errMsg)) {
        noteGmailRateLimit(e);
        console.error(`[gmail] レート制限のため残り${messages.length - attachments.length}件の取得を中断（Retry afterまで待機）`);
        break;
      }
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
  try {
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
  } catch (e) {
    noteGmailRateLimit(e);
    throw e;
  }
}

/** Gmail接続テスト */
// Gmail Refresh Token renewed 2026-07-23
export async function testGmailConnection(): Promise<{ ok: boolean; email?: string; error?: string }> {
  // レート制限中はAPIを呼ばず、キャッシュしたエラーを返す（呼ぶとRetry afterが延長される）
  if (isGmailRateLimited()) {
    const remain = rateLimitRemainingSec();
    const d = new Date(gmailRateLimitUntil!);
    return {
      ok: false,
      error: `User-rate limit exceeded. Retry after ${d.toISOString()}（残り${remain}秒・自動回復待ち）`,
    };
  }
  try {
    const gmail = getGmailClient();
    const profile = await gmail.users.getProfile({ userId: "me" });
    clearGmailRateLimit(); // 成功したら制限フラグをリセット
    return { ok: true, email: profile.data.emailAddress || undefined };
  } catch (e: unknown) {
    noteGmailRateLimit(e);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
