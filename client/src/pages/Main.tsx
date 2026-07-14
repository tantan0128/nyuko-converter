import { useState, useRef, useCallback } from "react";
import { useAppAuth } from "../contexts/AuthContext";
import { toast } from "sonner";

type ProcessMode =
  | "jan_jpg"
  | "jan_pdf"
  | "productname_jpg"
  | "maehara"
  | "ishida"
  | "cored"
  | "junidou"
  | "sanyo";

interface ProcessModeConfig {
  id: ProcessMode;
  label: string;
  accept: string;
  description: string;
}

const MODES: ProcessModeConfig[] = [
  { id: "jan_jpg", label: "JAN読み取りJPG", accept: "image/jpeg,image/jpg,image/png,image/webp", description: "JPG画像からJANコードを読み取り" },
  { id: "jan_pdf", label: "JAN読み取りPDF", accept: "application/pdf", description: "PDFからJANコードを読み取り" },
  { id: "productname_jpg", label: "商品名読み取りJPG", accept: "image/jpeg,image/jpg,image/png,image/webp", description: "JPG画像から商品名を読み取り（C列照合）" },
  { id: "maehara", label: "前原", accept: "image/jpeg,image/jpg,image/png,image/webp,application/pdf", description: "前原専用フォーマット" },
  { id: "ishida", label: "イシダ", accept: "image/jpeg,image/jpg,image/png,image/webp,application/pdf", description: "イシダ専用フォーマット" },
  { id: "cored", label: "コレド", accept: "image/jpeg,image/jpg,image/png,image/webp,application/pdf", description: "コレド専用フォーマット" },
  { id: "junidou", label: "十二堂（CSV）", accept: ".csv,text/csv", description: "十二堂CSVファイル" },
  { id: "sanyo", label: "三陽（Excel）", accept: ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", description: "三陽Excelファイル" },
];

interface ResultRow {
  code: string;
  stockType: string;
  quantity: number;
  date: string;
  time: string;
  note: string;
}

interface ProcessResult {
  rows: ResultRow[];
  notFound: string[];
  errors: string[];
  logs: string[];
}

export default function Main() {
  const { logout } = useAppAuth();
  const [mode, setMode] = useState<ProcessMode>("jan_jpg");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentMode = MODES.find((m) => m.id === mode)!;

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...dropped]);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleProcess = async () => {
    if (files.length === 0) {
      toast.error("ファイルを選択してください");
      return;
    }
    setProcessing(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("mode", mode);
      files.forEach((f) => formData.append("files", f));

      const res = await fetch("/api/process", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "処理に失敗しました" }));
        throw new Error(err.error || "処理に失敗しました");
      }

      const data: ProcessResult = await res.json();
      setResult(data);

      if (data.rows.length > 0) {
        toast.success(`${data.rows.length}件の変換が完了しました`);
      } else {
        toast.warning("変換できるデータがありませんでした");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "処理に失敗しました";
      toast.error(msg);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!result || result.rows.length === 0) return;

    const header = "自社商品コード,在庫指定,在庫数,入庫日,入庫時間,備考";
    const rows = result.rows.map((r) =>
      [r.code, r.stockType, r.quantity, r.date, r.time, r.note]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = "\uFEFF" + [header, ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    a.download = `入庫変換_${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif" }}>
      {/* Header */}
      <header className="border-b border-black">
        <div className="container">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-4">
              <div className="w-6 h-6 bg-[oklch(0.48_0.22_27)]" />
              <span className="text-sm font-black tracking-tight uppercase">入庫変換アプリ</span>
            </div>
            <button
              onClick={logout}
              className="text-xs font-bold tracking-[0.1em] uppercase text-gray-400 hover:text-black transition-colors"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <div className="container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">
          {/* Left column: Mode + Upload */}
          <div className="lg:col-span-4 border-r border-black pr-8">
            {/* Mode selection */}
            <div className="mb-8">
              <p className="text-xs font-bold tracking-[0.15em] uppercase text-gray-400 mb-3">処理モード</p>
              <div className="h-px bg-black mb-4" />
              <div className="space-y-0">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { setMode(m.id); setFiles([]); setResult(null); }}
                    className={`w-full text-left px-4 py-3 text-sm font-medium border-b border-black/10 transition-colors ${
                      mode === m.id
                        ? "bg-black text-white"
                        : "bg-white text-black hover:bg-gray-50"
                    }`}
                  >
                    <span className={`text-xs font-bold mr-2 ${mode === m.id ? "text-[oklch(0.48_0.22_27)]" : "text-gray-300"}`}>
                      {String(MODES.indexOf(m) + 1).padStart(2, "0")}
                    </span>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* File upload */}
            <div className="mb-6">
              <p className="text-xs font-bold tracking-[0.15em] uppercase text-gray-400 mb-3">ファイル選択</p>
              <div className="h-px bg-black mb-4" />
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed cursor-pointer transition-colors p-6 text-center ${
                  dragging ? "border-[oklch(0.48_0.22_27)] bg-red-50" : "border-black/30 hover:border-black"
                }`}
              >
                <div className="w-8 h-8 bg-black mx-auto mb-3" style={{ clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)" }} />
                <p className="text-xs font-bold tracking-wide uppercase text-gray-500 mb-1">ドロップ または クリック</p>
                <p className="text-xs text-gray-400">{currentMode.description}</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={currentMode.accept}
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            {/* File list */}
            {files.length > 0 && (
              <div className="mb-6">
                <p className="text-xs font-bold tracking-[0.15em] uppercase text-gray-400 mb-2">
                  選択ファイル <span className="text-[oklch(0.48_0.22_27)]">{files.length}</span>
                </p>
                <div className="h-px bg-black mb-3" />
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-black/10">
                      <span className="text-xs text-gray-600 truncate flex-1 mr-2">{f.name}</span>
                      <button
                        onClick={() => removeFile(i)}
                        className="text-xs text-gray-300 hover:text-[oklch(0.48_0.22_27)] font-bold flex-shrink-0"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Process button */}
            <button
              onClick={handleProcess}
              disabled={processing || files.length === 0}
              className="w-full bg-black text-white py-4 text-sm font-black tracking-[0.1em] uppercase hover:bg-[oklch(0.48_0.22_27)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {processing ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent animate-spin" style={{ borderRadius: "50%" }} />
                  処理中...
                </span>
              ) : (
                "変換・処理実行"
              )}
            </button>
          </div>

          {/* Right column: Results */}
          <div className="lg:col-span-8 lg:pl-8 mt-8 lg:mt-0">
            <div className="mb-6">
              <p className="text-xs font-bold tracking-[0.15em] uppercase text-gray-400 mb-3">処理結果</p>
              <div className="h-px bg-black mb-4" />
            </div>

            {!result && !processing && (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="w-12 h-12 border-2 border-black/10 mb-4" />
                <p className="text-xs font-bold tracking-widest uppercase text-gray-300">
                  ファイルを選択して処理を実行してください
                </p>
              </div>
            )}

            {processing && (
              <div className="flex flex-col items-center justify-center py-24">
                <div className="w-8 h-8 border-2 border-black border-t-[oklch(0.48_0.22_27)] animate-spin mb-4" style={{ borderRadius: "50%" }} />
                <p className="text-xs font-bold tracking-widest uppercase text-gray-400">処理中...</p>
              </div>
            )}

            {result && (
              <div className="space-y-6">
                {/* Summary */}
                <div className="grid grid-cols-3 gap-0 border border-black">
                  <div className="p-4 border-r border-black">
                    <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-1">変換成功</p>
                    <p className="text-3xl font-black text-black">{result.rows.length}</p>
                    <p className="text-xs text-gray-400">件</p>
                  </div>
                  <div className="p-4 border-r border-black">
                    <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-1">未登録</p>
                    <p className={`text-3xl font-black ${result.notFound.length > 0 ? "text-[oklch(0.48_0.22_27)]" : "text-black"}`}>
                      {result.notFound.length}
                    </p>
                    <p className="text-xs text-gray-400">件</p>
                  </div>
                  <div className="p-4">
                    <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-1">エラー</p>
                    <p className={`text-3xl font-black ${result.errors.length > 0 ? "text-[oklch(0.48_0.22_27)]" : "text-black"}`}>
                      {result.errors.length}
                    </p>
                    <p className="text-xs text-gray-400">件</p>
                  </div>
                </div>

                {/* Download button */}
                {result.rows.length > 0 && (
                  <button
                    onClick={handleDownload}
                    className="w-full border-2 border-black py-3 text-sm font-black tracking-[0.1em] uppercase hover:bg-black hover:text-white transition-colors"
                  >
                    CSVダウンロード（{result.rows.length}件）
                  </button>
                )}

                {/* Result table */}
                {result.rows.length > 0 && (
                  <div>
                    <p className="text-xs font-bold tracking-[0.15em] uppercase text-gray-400 mb-2">変換データ</p>
                    <div className="h-px bg-black mb-3" />
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-black text-white">
                            <th className="px-3 py-2 text-left font-bold tracking-wider uppercase">自社商品コード</th>
                            <th className="px-3 py-2 text-left font-bold tracking-wider uppercase">在庫指定</th>
                            <th className="px-3 py-2 text-right font-bold tracking-wider uppercase">在庫数</th>
                            <th className="px-3 py-2 text-left font-bold tracking-wider uppercase">入庫日</th>
                            <th className="px-3 py-2 text-left font-bold tracking-wider uppercase">入庫時間</th>
                            <th className="px-3 py-2 text-left font-bold tracking-wider uppercase">備考</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.rows.map((row, i) => (
                            <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                              <td className="px-3 py-2 border-b border-black/10 font-mono">{row.code}</td>
                              <td className="px-3 py-2 border-b border-black/10">{row.stockType}</td>
                              <td className="px-3 py-2 border-b border-black/10 text-right font-mono">{row.quantity}</td>
                              <td className="px-3 py-2 border-b border-black/10 font-mono">{row.date}</td>
                              <td className="px-3 py-2 border-b border-black/10 font-mono">{row.time}</td>
                              <td className="px-3 py-2 border-b border-black/10 text-gray-500">{row.note}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Not found */}
                {result.notFound.length > 0 && (
                  <div>
                    <p className="text-xs font-bold tracking-[0.15em] uppercase text-[oklch(0.48_0.22_27)] mb-2">
                      未登録商品 ({result.notFound.length}件)
                    </p>
                    <div className="h-px bg-[oklch(0.48_0.22_27)] mb-3" />
                    <div className="space-y-1">
                      {result.notFound.map((item, i) => (
                        <div key={i} className="flex items-start gap-2 py-1.5 border-b border-black/10">
                          <span className="w-4 h-4 bg-[oklch(0.48_0.22_27)] flex-shrink-0 mt-0.5" />
                          <span className="text-xs text-gray-700">{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Errors */}
                {result.errors.length > 0 && (
                  <div>
                    <p className="text-xs font-bold tracking-[0.15em] uppercase text-[oklch(0.48_0.22_27)] mb-2">
                      エラー ({result.errors.length}件)
                    </p>
                    <div className="h-px bg-[oklch(0.48_0.22_27)] mb-3" />
                    <div className="space-y-1">
                      {result.errors.map((err, i) => (
                        <div key={i} className="py-1.5 border-b border-black/10">
                          <span className="text-xs text-gray-600">{err}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Logs toggle */}
                {result.logs.length > 0 && (
                  <div>
                    <button
                      onClick={() => setShowLogs(!showLogs)}
                      className="text-xs font-bold tracking-[0.1em] uppercase text-gray-400 hover:text-black transition-colors"
                    >
                      {showLogs ? "▲" : "▼"} 処理ログ ({result.logs.length}件)
                    </button>
                    {showLogs && (
                      <div className="mt-3 bg-gray-50 border border-black/10 p-4 max-h-48 overflow-y-auto">
                        {result.logs.map((log, i) => (
                          <p key={i} className="text-xs font-mono text-gray-500 py-0.5">{log}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
