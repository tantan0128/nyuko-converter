import { describe, it, expect } from "vitest";

// CSV生成ロジックのテスト（フロントエンドと同等のロジックをサーバー側でも検証）
function generateCsv(rows: Array<{ code: string; stockType: string; quantity: number; date: string; time: string; note: string }>) {
  const header = "自社商品コード,在庫指定,在庫数,入庫日,入庫時間,備考";
  const csvRows = rows.map((r) =>
    [r.code, r.stockType, r.quantity, r.date, r.time, r.note]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  return "\uFEFF" + [header, ...csvRows].join("\r\n");
}

describe("CSV生成", () => {
  it("助ネコ正式フォーマットのヘッダーが正しい", () => {
    const csv = generateCsv([]);
    expect(csv).toContain("自社商品コード,在庫指定,在庫数,入庫日,入庫時間,備考");
  });

  it("BOM付きUTF-8で出力される", () => {
    const csv = generateCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });

  it("データ行が正しく生成される", () => {
    const rows = [
      { code: "JSN001", stockType: "通常在庫", quantity: 10, date: "2026/07/14", time: "00:00", note: "" },
    ];
    const csv = generateCsv(rows);
    expect(csv).toContain('"JSN001"');
    expect(csv).toContain('"通常在庫"');
    expect(csv).toContain('"10"');
    expect(csv).toContain('"2026/07/14"');
    expect(csv).toContain('"00:00"');
  });

  it("ダブルクォートを含む値はエスケープされる", () => {
    const rows = [
      { code: 'JSN"001', stockType: "通常在庫", quantity: 5, date: "2026/07/14", time: "00:00", note: "" },
    ];
    const csv = generateCsv(rows);
    expect(csv).toContain('"JSN""001"');
  });

  it("複数行が正しく生成される", () => {
    const rows = [
      { code: "JSN001", stockType: "通常在庫", quantity: 10, date: "2026/07/14", time: "00:00", note: "" },
      { code: "JSN002", stockType: "通常在庫", quantity: 5, date: "2026/07/14", time: "00:00", note: "" },
    ];
    const csv = generateCsv(rows);
    const lines = csv.split("\r\n");
    // BOM + header + 2 data rows = 3 lines
    expect(lines.length).toBe(3);
  });
});
