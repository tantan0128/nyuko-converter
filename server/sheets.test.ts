import { describe, it, expect } from "vitest";
import { matchByJan, matchByName, VENDOR_CODE_TO_NAME } from "./sheets";

const sampleProducts = [
  { jan: "4901234567890", code: "JSN001", nameKeywords: "テスト商品 100g" },
  { jan: "4901234567891", code: "JSN002", nameKeywords: "サンプル 200ml ボトル" },
  { jan: "4901234567892", code: "JSN003", nameKeywords: "フルーツ ジュース 500ml" },
  { jan: "4901234567893", code: "JSN004", nameKeywords: "チョコレート 板チョコ 50g" },
];

describe("matchByJan", () => {
  it("完全一致でコードを返す", () => {
    expect(matchByJan("4901234567890", sampleProducts)).toBe("JSN001");
  });

  it("存在しないJANはnullを返す", () => {
    expect(matchByJan("9999999999999", sampleProducts)).toBeNull();
  });

  it("短いJAN（8桁未満）はnullを返す", () => {
    expect(matchByJan("123456", sampleProducts)).toBeNull();
  });

  it("空文字はnullを返す", () => {
    expect(matchByJan("", sampleProducts)).toBeNull();
  });
});

describe("VENDOR_CODE_TO_NAME", () => {
  it("ユーザー確認済みのcr接頭辞をコレドへ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.cr).toBe("コレド");
  });

  it("ユーザー確認済みのbr接頭辞をブランシュアソシエへ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.br).toBe("ブランシュアソシエ");
  });

  it("ユーザー確認済みのoi接頭辞を片力商事へ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.oi).toBe("片力商事");
  });

  it("ユーザー確認済みのkn接頭辞をカク仲へ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.kn).toBe("カク仲");
  });

  it("ユーザー確認済みのnf接頭辞をネ・ルフレへ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.nf).toBe("ネ・ルフレ");
  });

  it("ユーザー確認済みのkt接頭辞を公長斎小菅へ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.kt).toBe("公長斎小菅");
  });

  it("ユーザー確認済みのkw接頭辞をカワイへ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.kw).toBe("カワイ");
  });

  it("ユーザー確認済みのsl接頭辞をサンライフへ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.sl).toBe("サンライフ");
  });

  it("ユーザー確認済みのks接頭辞を京千へ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.ks).toBe("京千");
  });

  it("ユーザー確認済みのmx接頭辞をメルクロスへ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.mx).toBe("メルクロス");
  });
});

describe("matchByName", () => {
  it("数字トークン一致でスコア2以上の場合コードを返す", () => {
    // "500ml" は数字含むトークン → スコア+2
    expect(matchByName("フルーツ 500ml", sampleProducts)).toBe("JSN003");
  });

  it("複数トークン一致でスコア2以上の場合コードを返す", () => {
    // "サンプル" と "200ml" の2トークン → スコア3
    expect(matchByName("サンプル 200ml", sampleProducts)).toBe("JSN002");
  });

  it("スコア1以下（通常単語1つのみ）はnullを返す", () => {
    // "チョコレート" のみ → スコア1 → null
    expect(matchByName("チョコレート", sampleProducts)).toBeNull();
  });

  it("空文字はnullを返す", () => {
    expect(matchByName("", sampleProducts)).toBeNull();
  });

  it("スペース除去完全一致は即採用", () => {
    // "テスト商品100g" → スペース除去で "テスト商品100g" == "テスト商品100g"
    expect(matchByName("テスト商品100g", sampleProducts)).toBe("JSN001");
  });
});
