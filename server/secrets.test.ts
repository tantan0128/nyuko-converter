import { describe, it, expect } from "vitest";
import { google } from "googleapis";

describe("環境変数・外部接続テスト", () => {
  it("APP_PASSWORD が設定されている", () => {
    expect(process.env.APP_PASSWORD).toBeTruthy();
    expect(process.env.APP_PASSWORD).toBe("phezzan4414");
  });

  it("SPREADSHEET_ID が設定されている", () => {
    expect(process.env.SPREADSHEET_ID).toBeTruthy();
    expect(process.env.SPREADSHEET_ID).toBe("1kabgk_u2Ahg5p2lgZtqW9uxyLBM5Baome6yrjOCNA58");
  });

  it("GOOGLE_SERVICE_ACCOUNT_JSON が有効なJSONである", () => {
    const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    expect(json).toBeTruthy();
    const parsed = JSON.parse(json!);
    expect(parsed.type).toBe("service_account");
    expect(parsed.client_email).toContain("nyuko-converter@");
  });

  it("DOCUMENT_AI_PROCESSOR_ID が設定されている", () => {
    expect(process.env.DOCUMENT_AI_PROCESSOR_ID).toBe("3ecf3b05594ce434");
  });

  it("Googleスプレッドシートに接続できる", async () => {
    const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!json) {
      console.warn("GOOGLE_SERVICE_ACCOUNT_JSON が未設定のためスキップ");
      return;
    }
    const credentials = JSON.parse(json);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID!,
      range: "全商品取り扱いリスト!A1:C3",
    });
    expect(res.data.values).toBeTruthy();
    expect(res.data.values!.length).toBeGreaterThan(0);
    console.log("スプレッドシート接続成功。先頭3行:", res.data.values);
  }, 30000);
});
