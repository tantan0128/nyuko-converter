import { afterEach, describe, expect, it, vi } from "vitest";
import { appSuspensionMiddleware } from "./_core/appSuspension";

const originalAppSuspended = process.env.APP_SUSPENDED;

afterEach(() => {
  if (originalAppSuspended === undefined) {
    delete process.env.APP_SUSPENDED;
  } else {
    process.env.APP_SUSPENDED = originalAppSuspended;
  }
});

describe("公開アプリの停止スイッチ", () => {
  it("APP_SUSPENDED=trueではHTTPアクセスを503で拒否する", () => {
    process.env.APP_SUSPENDED = "true";
    const next = vi.fn();
    const send = vi.fn();
    const type = vi.fn().mockReturnThis();
    const status = vi.fn().mockReturnThis();
    const response = { status, type, send } as any;

    appSuspensionMiddleware({} as any, response, next);

    expect(status).toHaveBeenCalledWith(503);
    expect(type).toHaveBeenCalledWith("text/html");
    expect(send).toHaveBeenCalledWith(expect.stringContaining("一時停止中"));
    expect(next).not.toHaveBeenCalled();
  });
});
