import { afterEach, describe, expect, it } from "vitest";
import { testGmailConnection } from "./gmail";

const originalGmailIntegrationEnabled = process.env.GMAIL_INTEGRATION_ENABLED;

afterEach(() => {
  if (originalGmailIntegrationEnabled === undefined) {
    delete process.env.GMAIL_INTEGRATION_ENABLED;
  } else {
    process.env.GMAIL_INTEGRATION_ENABLED = originalGmailIntegrationEnabled;
  }
});

describe("Gmail連携の無効化スイッチ", () => {
  it("GMAIL_INTEGRATION_ENABLED=falseではOAuth情報を使わず接続確認を拒否する", async () => {
    process.env.GMAIL_INTEGRATION_ENABLED = "false";

    await expect(testGmailConnection()).resolves.toEqual({
      ok: false,
      error: "Gmail連携は無効化されています",
    });
  });
});
