import { describe, it, expect } from "vitest";
import {
  matchByJan,
  matchByName,
  matchBySupplierCode,
  normalizeCodeKey,
  filterBySupplier,
  guessSupplierPrefix,
  normalizeSupplierName,
  isJanLike,
} from "./sheets";

// ProductRecord 型に合わせ deliveryKeywords / supplier を含める
const sampleProducts = [
  { jan: "4901234567890", code: "JSN001", nameKeywords: "テスト商品 100g", deliveryKeywords: "", supplier: "" },
  { jan: "4901234567891", code: "JSN002", nameKeywords: "サンプル 200ml ボトル", deliveryKeywords: "", supplier: "" },
  { jan: "4901234567892", code: "JSN003", nameKeywords: "フルーツ ジュース 500ml", deliveryKeywords: "", supplier: "" },
  { jan: "4901234567893", code: "JSN004", nameKeywords: "チョコレート 板チョコ 50g", deliveryKeywords: "", supplier: "" },
  { jan: "", code: "ok-1234", nameKeywords: "オクムラ ステンレス ボウル", deliveryKeywords: "CMG-350-W, オクムラボウル", supplier: "オクムラ" },
  { jan: "", code: "km-001", nameKeywords: "木村硝子店 グラス", deliveryKeywords: "木村硝子 グラス 001", supplier: "木村硝子店" },
  { jan: "", code: "sa-5678", nameKeywords: "三陽エース ドリッパー", deliveryKeywords: "DRIP-S, ドリッパーS", supplier: "三陽エース" },
  { jan: "", code: "sa-9999", nameKeywords: "三陽エース 抹茶碗", deliveryKeywords: "MATCHA-1", supplier: "三陽エース" },
  { jan: "’4901234567894", code: "JSN005", nameKeywords: "アポストロフィ付き 商品", deliveryKeywords: "", supplier: "" },
  { jan: "'4901234567895", code: "JSN006", nameKeywords: "半角アポストロフィ付き 商品", deliveryKeywords: "", supplier: "" },
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

  it("DB側JANの全角アポストロフィ（エクセル先頭ゼロ対策）を正規化して一致する", () => {
    expect(matchByJan("4901234567894", sampleProducts)).toBe("JSN005");
  });

  it("DB側JANの半角アポストロフィも正規化して一致する", () => {
    expect(matchByJan("4901234567895", sampleProducts)).toBe("JSN006");
  });
});

describe("matchBySupplierCode（品番照合・D列完全一致）", () => {
  it("D列に登録された品番と完全一致でコードを返す", () => {
    expect(matchBySupplierCode("CMG-350-W", sampleProducts)).toBe("ok-1234");
  });

  it("品番の表記揺れ（全角・大文字・ハイフン差異）を正規化して一致する", () => {
    // "CMG350W"（ハイフンなし）も "CMG-350-W" と同じ正規化キーになる
    expect(matchBySupplierCode("cmg350w", sampleProducts)).toBe("ok-1234");
    expect(matchBySupplierCode("ＣＭＧ−３５０−Ｗ", sampleProducts)).toBe("ok-1234");
  });

  it("D列の複数キーワード（カンマ区切り）の2つ目で一致する", () => {
    expect(matchBySupplierCode("オクムラボウル", sampleProducts)).toBe("ok-1234");
  });

  it("B列コードのハイフン後部分と一致する", () => {
    // 自社コード ok-1234 のハイフン後 = 1234
    expect(matchBySupplierCode("1234", sampleProducts)).toBe("ok-1234");
  });

  it("ゼロ埋め差異（0123 vs 123）を吸収する", () => {
    expect(matchBySupplierCode("01234", sampleProducts)).toBe("ok-1234");
  });

  it("不一致の品番はnullを返す", () => {
    expect(matchBySupplierCode("ZZZ-999", sampleProducts)).toBeNull();
  });

  it("空文字・空白のみはnullを返す", () => {
    expect(matchBySupplierCode("", sampleProducts)).toBeNull();
    expect(matchBySupplierCode("   ", sampleProducts)).toBeNull();
  });

  it("仕入元プレフィックスで絞り込むと他社の同じ品番にはマッチしない", () => {
    // km-001 のD列に「001」が入っているが、ok- プレフィックスで絞るとマッチしない
    expect(matchBySupplierCode("001", sampleProducts, "ok")).toBeNull();
  });
});

describe("normalizeCodeKey（品番正規化）", () => {
  it("全角英数字を半角に変換する", () => {
    expect(normalizeCodeKey("ＡＢＣ１２３")).toBe("abc123");
  });

  it("大文字を小文字に変換する", () => {
    expect(normalizeCodeKey("ABC-123")).toBe("abc123");
  });

  it("ハイフン類と空白を除去する", () => {
    expect(normalizeCodeKey("A B―C－123　")).toBe("abc123");
  });

  it("空文字・nullは空文字を返す", () => {
    expect(normalizeCodeKey("")).toBe("");
    expect(normalizeCodeKey("   ")).toBe("");
  });
});

describe("matchByName（商品名あいまい照合・確信度）", () => {
  it("数字トークン一致でスコア2以上の場合コードを返す", () => {
    expect(matchByName("フルーツ 500ml", sampleProducts)).toBe("JSN003");
  });

  it("複数トークン一致でスコア2以上の場合コードを返す", () => {
    expect(matchByName("サンプル 200ml", sampleProducts)).toBe("JSN002");
  });

  it("スコア1以下（通常単語1つのみ）はnullを返す", () => {
    expect(matchByName("チョコレート", sampleProducts)).toBeNull();
  });

  it("空文字はnullを返す", () => {
    expect(matchByName("", sampleProducts)).toBeNull();
  });

  it("スペース除去完全一致は即採用", () => {
    expect(matchByName("テスト商品100g", sampleProducts)).toBe("JSN001");
  });

  it("D列キーワードも照合対象になる", () => {
    expect(matchByName("CMG-350-W", sampleProducts)).toBe("ok-1234");
  });

  it("完全に無関係な商品名はnullを返す", () => {
    expect(matchByName("パスタ ミルク", sampleProducts)).toBeNull();
  });
});

describe("filterBySupplier（E列仕入先での絞り込み）", () => {
  it("仕入先名で絞り込むと該当商品のみ返る", () => {
    const result = filterBySupplier(sampleProducts, "三陽エース");
    expect(result.length).toBe(2);
    expect(result.every((p) => p.supplier === "三陽エース")).toBe(true);
  });

  it("敬称付き（株式会社）でも正規化して絞り込める", () => {
    const result = filterBySupplier(sampleProducts, "株式会社 三陽エース");
    expect(result.length).toBe(2);
  });

  it("仕入先名が空の場合は全件返す", () => {
    expect(filterBySupplier(sampleProducts, "")).toHaveLength(sampleProducts.length);
    expect(filterBySupplier(sampleProducts, undefined as unknown as string)).toHaveLength(
      sampleProducts.length
    );
  });

  it("存在しない仕入先名は空配列を返す", () => {
    expect(filterBySupplier(sampleProducts, "存在しない会社")).toHaveLength(0);
  });
});

describe("matchByName（E列仕入先絞り込み付き）", () => {
  it("仕入先名で絞り込むと他社の類似商品に誤マッチしない", () => {
    // 「ドリッパー」は三陽エース以外に存在しないが、仕入先で絞ると確実にsa-5678
    expect(matchByName("ドリッパーS", sampleProducts, undefined, "三陽エース")).toBe("sa-5678");
  });

  it("仕入先名で絞り込むと、プレフィックスが不明でも正しい商品に当たる", () => {
    // プレフィックスなし・仕入先名のみで絞り込み
    expect(matchByName("抹茶碗", sampleProducts, undefined, "三陽エース")).toBe("sa-9999");
  });

  it("仕入先名とプレフィックスの両方で絞り込める", () => {
    expect(matchByName("抹茶碗", sampleProducts, "sa", "三陽エース")).toBe("sa-9999");
  });
});

describe("matchBySupplierCode（E列仕入先絞り込み付き）", () => {
  it("仕入先名で絞り込んで品番照合できる", () => {
    expect(matchBySupplierCode("MATCHA-1", sampleProducts, undefined, "三陽エース")).toBe("sa-9999");
  });

  it("仕入先名で絞り込むと他社の同じ品番に誤マッチしない", () => {
    // ok-1234 のD列に「オクムラボウル」があるが、三陽エースで絞るとマッチしない
    expect(matchBySupplierCode("オクムラボウル", sampleProducts, undefined, "三陽エース")).toBeNull();
  });
});

describe("guessSupplierPrefix（E列実データベースのマッピング）", () => {
  it("片力商事 → oi を返す（E列実データで修正済み）", () => {
    expect(guessSupplierPrefix("片力商事")).toBe("oi");
  });

  it("メルクロス → mx を返す（マックス→メルクロス修正済み）", () => {
    expect(guessSupplierPrefix("メルクロス")).toBe("mx");
  });

  it("ブランシュアソシエ → br を返す（新規追加）", () => {
    expect(guessSupplierPrefix("ブランシュアソシエ")).toBe("br");
  });

  it("京千 → ks を返す（新規追加）", () => {
    expect(guessSupplierPrefix("京千")).toBe("ks");
  });

  it("三陽エース → sa を返す（既存維持）", () => {
    expect(guessSupplierPrefix("三陽エース")).toBe("sa");
  });
});

describe("normalizeSupplierName（E列実データベースの正規化）", () => {
  it("敬称付き・表記ゆらぎを標準名に正規化する", () => {
    expect(normalizeSupplierName("株式会社 三陽エース")).toBe("三陽エース");
    expect(normalizeSupplierName("木村硝子店 様")).toBe("木村硝子店");
  });

  it("片力商事を標準名に正規化する", () => {
    expect(normalizeSupplierName("片力商事")).toBe("片力商事");
  });
});

describe("isJanLike（JAN判定）", () => {
  it("数字のみ8桁以上はJANとみなす", () => {
    expect(isJanLike("0028295262927")).toBe(true); // 13桁JAN
    expect(isJanLike("28295262927")).toBe(true); // 先頭0が消えたJAN（11桁）
    expect(isJanLike("719812018294")).toBe(true); // 12桁
  });

  it("文字入りのコード（ベンダー品番・商品コード）はJANとみなさない", () => {
    expect(isJanLike("sa-4573146013778")).toBe(false); // コード+JAN（納品書実在表記）
    expect(isJanLike("sa-yakisugiita-dai")).toBe(false); // 文字コード
    expect(isJanLike("CMG-350-W")).toBe(false);
    expect(isJanLike("MATCHA-1")).toBe(false);
    expect(isJanLike("")).toBe(false);
  });

  it("7桁以下の数字（品番等）はJANとみなさない", () => {
    expect(isJanLike("1234567")).toBe(false);
  });
});
