import { describe, expect, it } from "vitest";
import gmailSchedulerRouter from "./gmailScheduler";

describe("gmailScheduler のOCRモジュール連携", () => {
  it("Gemini直接呼び出し版のOCRモジュールを読み込んでルーターを生成できる", () => {
    expect(gmailSchedulerRouter).toBeTruthy();
    expect(typeof gmailSchedulerRouter.use).toBe("function");
  });
});
