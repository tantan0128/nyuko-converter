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

  it("ユーザー確認済みのnk接頭辞を二光社へ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.nk).toBe("二光社");
  });

  it("ユーザー確認済みのwc接頭辞を若兆へ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.wc).toBe("若兆");
  });

  it("ユーザー確認済みのie接頭辞を家田紙工へ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.ie).toBe("家田紙工");
  });

  it("ユーザー確認済みのyy接頭辞をワイヨットへ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.yy).toBe("ワイヨット");
  });

  it("ユーザー確認済みのmk接頭辞を前謙へ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.mk).toBe("前謙");
  });

  it("未確認のsg接頭辞は自動対応表に含めない", () => {
    expect(VENDOR_CODE_TO_NAME.sg).toBeUndefined();
  });

  it("ユーザー確認済みのms接頭辞をミランダスタイルへ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.ms).toBe("ミランダスタイル");
  });

  it("ユーザー確認済みのiq接頭辞を一久へ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.iq).toBe("一久");
  });

  it("ユーザー確認済みのsc接頭辞を瀬戸刃物へ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.sc).toBe("瀬戸刃物");
  });

  it("ユーザー確認済みのyi接頭辞をユミトルインポートへ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.yi).toBe("ユミトルインポート");
  });

  it("ユーザー確認済みのtw接頭辞を十二堂へ対応付ける", () => {
    expect(VENDOR_CODE_TO_NAME.tw).toBe("十二堂");
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
