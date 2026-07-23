import { useState, useRef, useCallback, useEffect } from "react";
import { useAppAuth } from "../contexts/AuthContext";
import { toast } from "sonner";
import { Link } from "wouter";

type ProcessMode =
  | "jan_jpg"
  | "jan_pdf"
  | "name_pdf"
  | "junidou_csv";

interface ProcessModeConfig {
  id: ProcessMode;
  label: string;
  accept: string;
  description: string;
}

const MODES: ProcessModeConfig[] = [
  { id: "jan_jpg", label: "JAN読み取りJPG", accept: "image/jpeg,image/jpg,image/png,image/webp", description: "JPG画像からJANコードを読み取り" },
  { id: "jan_pdf", label: "JAN読み取りPDF", accept: "application/pdf", description: "PDFからJANコードを読み取り" },
  { id: "name_pdf", label: "商品名・商品コード読み取りPDF", accept: "application/pdf,image/jpeg,image/jpg,image/png,image/webp", description: "PDF/画像から商品名・商品コードで照合" },
  { id: "junidou_csv", label: "十二堂CSV変換", accept: ".csv,text/csv", description: "十二堂CSVを助ネコ在庫CSV形式に変換" },
];

interface ResultRow {
  code: string;
  stockType: string;
  quantity: number;
  date: string;
  time: string;
  note: string;
}

interface NotFoundItem {
  label: string;       // 表示用ラベル
  productName: string; // 商品名（照合用）
  quantity: number;
}

interface ProcessResult {
  rows: ResultRow[];
  notFound: NotFoundItem[];
  errors: string[];
  logs: string[];
  supplier?: string;
}

interface JunidouResult {
  ok: boolean;
  csvContent?: string;
  rowCount?: number;
  notFound?: string[];
  notFoundCount?: number;
  error?: string;
}

interface KeywordModalState {
  open: boolean;
  productName: string;
  keyword: string;
  code: string;
  registering: boolean;
}

interface SyncStatus {
  count: number;
  syncedAt: string | null;
}

interface GmailJob {
  id: number;
  filename: string;
  processedAt: string;
  rowCount: number;
  notFoundCount: number;
  csvContent: string | null;
  supplier: string | null;
  status: string;
  downloadedAt: string | null;
}

export default function Main() {
  const { logout } = useAppAuth();
  const [mode, setMode] = useState<ProcessMode>("jan_jpg");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [junidouResult, setJunidouResult] = useState<JunidouResult | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [modal, setModal] = useState<KeywordModalState>({
    open: false, productName: "", keyword: "", code: "", registering: false
  });
  const [productCodes, setProductCodes] = useState<{code: string; name: string}[]>([]);
  const [gmailJobs, setGmailJobs] = useState<GmailJob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentMode = MODES.find((m) => m.id === mode)!;
  const isJunidouMode = mode === "junidou_csv";

  // 同期状況を取得
  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/sync-status");
      if (res.ok) {
        const data: SyncStatus = await res.json();
        setSyncStatus(data);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync-products", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "同期に失敗しました");
      toast.success(data.message || `${data.count}件の商品マスターを同期しました`);
      await fetchSyncStatus();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "同期に失敗しました";
      toast.error(msg);
    } finally {
      setSyncing(false);
    }
  };

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
    setJunidouResult(null);

    try {
      if (isJunidouMode) {
        // 十二堂CSVモード
        const formData = new FormData();
        formData.append("file", files[0]);
        const res = await fetch("/api/process-junidou-csv", {
          method: "POST",
          body: formData,
        });
        const data: JunidouResult = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "処理に失敗しました");
        }
        setJunidouResult(data);
        if ((data.rowCount ?? 0) > 0) {
          toast.success(`${data.rowCount}件の変換が完了しました`);
        } else {
          toast.warning("変換できるデータがありませんでした");
        }
      } else {
        // 通常モード
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
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "処理に失敗しました";
      toast.error(msg);
    } finally {
      setProcessing(false);
    }
  };

  // 商品コード一覧を取得（モーダル用）
  const fetchProductCodes = useCallback(async () => {
    try {
      const res = await fetch("/api/product-codes");
      if (res.ok) {
        const data = await res.json();
        setProductCodes(data);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchProductCodes(); }, [fetchProductCodes]);

  // Gmailジョブ一覧を取得
  const fetchGmailJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/gmail-jobs");
      if (res.ok) {
        const data = await res.json();
        setGmailJobs(Array.isArray(data) ? data.slice(0, 5) : []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchGmailJobs(); }, [fetchGmailJobs]);

  const downloadGmailJobCsv = async (job: GmailJob) => {
    if (!job.csvContent) { toast.error("CSVデータがありません"); return; }
    const bom = "\uFEFF";
    const blob = new Blob([bom + job.csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date(job.processedAt);
    const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    a.href = url;
    a.download = `助ネコ在庫up${job.supplier || ""}${mmdd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    // ダウンロード済みを記録して一覧を更新
    await fetch(`/api/gmail-jobs/${job.id}/downloaded`, { method: "POST" }).catch(() => {});
    setGmailJobs(prev => prev.map(j => j.id === job.id ? { ...j, downloadedAt: new Date().toISOString() } : j));
  };

  const openModal = (item: NotFoundItem) => {
    setModal({ open: true, productName: item.productName, keyword: item.productName, code: "", registering: false });
  };

  const handleRegisterKeyword = async () => {
    if (!modal.code || !modal.keyword.trim()) {
      toast.error("商品コードとキーワードを入力してください");
      return;
    }
    setModal(m => ({ ...m, registering: true }));
    try {
      const res = await fetch("/api/register-keyword", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: modal.code, keyword: modal.keyword.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "登録に失敗しました");
      toast.success(data.message || "キーワードを登録しました");
      setModal(m => ({ ...m, open: false }));
      await fetchSyncStatus();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "登録に失敗しました";
      toast.error(msg);
    } finally {
      setModal(m => ({ ...m, registering: false }));
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
    const mmdd = `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const supplierPart = result.supplier ? result.supplier : "";
    a.download = `助ネコ在庫up${supplierPart}${mmdd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleJunidouDownload = () => {
    if (!junidouResult?.csvContent) return;
    const bom = "\uFEFF";
    const blob = new Blob([bom + junidouResult.csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const now = new Date();
    const mmdd = `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    a.download = `助ネコ在庫up十二堂${mmdd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatSyncDate = (iso: string | null) => {
    if (!iso) return "未同期";
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const hasResult = result !== null || junidouResult !== null;

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
            <div className="flex items-center gap-4">
              <Link
                href="/gmail-jobs"
                className="text-sm font-bold text-gray-500 hover:text-black transition-colors flex items-center gap-1"
              >
                <span>📧</span> Gmail自動取り込み
              </Link>
              <button
                onClick={logout}
                className="text-sm font-bold text-gray-500 hover:text-black transition-colors"
              >
                ログアウト
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="container py-8">
        {/* 商品マスター同期バー */}
        <div className="mb-6 border border-black p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-gray-700 mb-1">商品マスター（スプレッドシート同期）</p>
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span>
                登録件数：
                <span className="font-black text-black ml-1">
                  {syncStatus ? syncStatus.count.toLocaleString() : "—"}
                </span>
                件
              </span>
              <span className="text-black/20">|</span>
              <span>
                最終同期：
                <span className="font-mono ml-1">
                  {syncStatus ? formatSyncDate(syncStatus.syncedAt) : "—"}
                </span>
              </span>
            </div>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex-shrink-0 bg-black text-white px-5 py-2 text-sm font-black tracking-[0.05em] uppercase hover:bg-[oklch(0.48_0.22_27)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {syncing ? (
              <span className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent animate-spin rounded-full" />
                同期中...
              </span>
            ) : (
              "スプレッドシートから同期"
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">
          {/* Left column: Mode + Upload */}
          <div className="lg:col-span-4 border-r border-black pr-8">
            {/* Gmail自動取り込みリンク */}
            <div className="mb-8">
              <p className="text-base font-black text-black mb-3">Gmail自動取り込み</p>
              <div className="h-px bg-[oklch(0.48_0.22_27)] mb-4" />
              <Link
                href="/gmail-jobs"
                className="block w-full bg-[oklch(0.48_0.22_27)] text-white px-5 py-4 text-base font-black text-center hover:bg-[oklch(0.38_0.22_27)] transition-colors"
              >
                {(() => {
                  const newCount = gmailJobs.filter(j => !j.downloadedAt).length;
                  return newCount > 0
                    ? `📥 未ダウンロード ${newCount}件 — ダウンロードページへ`
                    : "📧 Gmail取り込み一覧へ";
                })()}
              </Link>
            </div>

            {/* Mode selection */}
            <div className="mb-8">
              <p className="text-base font-black text-black mb-3">処理モード</p>
              <div className="h-px bg-black mb-4" />
              <div className="space-y-0">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { setMode(m.id); setFiles([]); setResult(null); setJunidouResult(null); }}
                    className={`w-full text-left px-4 py-3 text-base font-medium border-b border-black/10 transition-colors ${
                      mode === m.id
                        ? "bg-black text-white"
                        : "bg-white text-black hover:bg-gray-50"
                    }`}
                  >
                    <span className={`text-xs font-bold mr-2 ${mode === m.id ? "text-[oklch(0.48_0.22_27)]" : "text-gray-300"}`}>
                      {String(MODES.indexOf(m) + 1).padStart(2, "0")}
                    </span>
                    {m.label}
                    {m.id === "junidou_csv" && (
                      <span className="ml-2 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">NEW</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* File upload */}
            <div className="mb-6">
              <p className="text-base font-black text-black mb-3">ファイル選択</p>
              <div className="h-px bg-black mb-4" />
              {isJunidouMode && (
                <div className="mb-3 bg-green-50 border border-green-200 rounded p-3 text-xs text-green-700">
                  <strong>十二堂CSVモード：</strong>Shift-JIS形式のCSVファイルを選択してください。
                  列1=自社商品コード、列2=在庫数、列3=出荷日
                </div>
              )}
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
                <p className="text-sm font-bold text-gray-600 mb-1">ドロップ または クリック</p>
                <p className="text-sm text-gray-500">{currentMode.description}</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple={!isJunidouMode}
                accept={currentMode.accept}
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            {/* File list */}
            {files.length > 0 && (
              <div className="mb-6">
                <p className="text-sm font-bold text-gray-700 mb-2">
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
              className="w-full bg-black text-white py-4 text-base font-black tracking-[0.05em] uppercase hover:bg-[oklch(0.48_0.22_27)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {processing ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent animate-spin rounded-full" />
                  処理中...
                </span>
              ) : (
                isJunidouMode ? "十二堂CSV変換・処理実行" : "変換・処理実行"
              )}
            </button>
          </div>

          {/* Right column: Results */}
          <div className={`lg:pl-8 mt-8 lg:mt-0 ${hasResult ? 'lg:col-span-8' : 'lg:col-span-4'}`}>
            <div className="mb-4">
              <p className="text-base font-black text-black mb-3">処理結果</p>
              <div className="h-px bg-black" />
            </div>

            {!hasResult && !processing && (
              <div className="flex flex-col items-center justify-center py-4 text-center border border-dashed border-black/20 mt-2">
                <p className="text-xs font-bold text-gray-400">変換実行すると結果が表示されます</p>
                {syncStatus && syncStatus.count === 0 && !isJunidouMode && (
                  <p className="text-xs text-[oklch(0.48_0.22_27)] mt-2 font-bold">
                    ⚠ 商品マスター未同期
                  </p>
                )}
              </div>
            )}

            {processing && (
              <div className="flex flex-col items-center justify-center py-24">
                <div className="w-8 h-8 border-2 border-black border-t-[oklch(0.48_0.22_27)] animate-spin mb-4 rounded-full" />
                <p className="text-xs font-bold text-gray-400">処理中...</p>
              </div>
            )}

            {/* 十二堂CSV結果 */}
            {junidouResult && (
              <div className="space-y-6">
                {/* Stats */}
                <div className="grid grid-cols-2 gap-0 border border-black">
                  <div className="p-4 border-r border-black">
                    <p className="text-sm font-bold text-gray-600 mb-1">変換成功</p>
                    <p className="text-3xl font-black text-black">{junidouResult.rowCount ?? 0}</p>
                    <p className="text-xs text-gray-400">件</p>
                  </div>
                  <div className="p-4">
                    <p className="text-sm font-bold text-gray-600 mb-1">未登録コード</p>
                    <p className={`text-3xl font-black ${(junidouResult.notFoundCount ?? 0) > 0 ? "text-[oklch(0.48_0.22_27)]" : "text-black"}`}>
                      {junidouResult.notFoundCount ?? 0}
                    </p>
                    <p className="text-xs text-gray-400">件</p>
                  </div>
                </div>

                {/* Download button */}
                {(junidouResult.rowCount ?? 0) > 0 && (
                  <button
                    onClick={handleJunidouDownload}
                    className="w-full border-2 border-black py-3 text-sm font-black hover:bg-black hover:text-white transition-colors"
                  >
                    CSVダウンロード（{junidouResult.rowCount}件）— 助ネコ在庫up十二堂
                  </button>
                )}

                {/* 未登録コード */}
                {(junidouResult.notFoundCount ?? 0) > 0 && (
                  <div>
                    <p className="text-xs font-bold tracking-[0.15em] uppercase text-[oklch(0.48_0.22_27)] mb-2">
                      未登録コード ({junidouResult.notFoundCount}件)
                    </p>
                    <div className="h-px bg-[oklch(0.48_0.22_27)] mb-3" />
                    <p className="text-xs text-gray-400 mb-3">
                      以下の十二堂コードはスプレッドシートの「十二堂商品リスト」に登録されていません
                    </p>
                    <div className="space-y-1">
                      {junidouResult.notFound?.map((code, i) => (
                        <div key={i} className="flex items-center gap-2 py-1.5 border-b border-black/10">
                          <span className="w-4 h-4 bg-[oklch(0.48_0.22_27)] flex-shrink-0" />
                          <span className="text-xs text-gray-700 font-mono">{code}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 通常モード結果 */}
            {result && (
              <div className="space-y-6">
                {/* Stats */}
                <div className="grid grid-cols-3 gap-0 border border-black">
                  <div className="p-4 border-r border-black">
                    <p className="text-sm font-bold text-gray-600 mb-1">変換成功</p>
                    <p className="text-3xl font-black text-black">{result.rows.length}</p>
                    <p className="text-xs text-gray-400">件</p>
                  </div>
                  <div className="p-4 border-r border-black">
                    <p className="text-sm font-bold text-gray-600 mb-1">未登録</p>
                    <p className={`text-3xl font-black ${result.notFound.length > 0 ? "text-[oklch(0.48_0.22_27)]" : "text-black"}`}>
                      {result.notFound.length}
                    </p>
                    <p className="text-xs text-gray-400">件</p>
                  </div>
                  <div className="p-4">
                    <p className="text-sm font-bold text-gray-600 mb-1">エラー</p>
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
                    className="w-full border-2 border-black py-3 text-sm font-black hover:bg-black hover:text-white transition-colors"
                  >
                    CSVダウンロード（{result.rows.length}件）
                  </button>
                )}

                {/* Result table */}
                {result.rows.length > 0 && (
                  <div>
                    <p className="text-sm font-bold text-gray-700 mb-2">変換データ</p>
                    <div className="h-px bg-black mb-3" />
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-black text-white">
                            <th className="px-3 py-2 text-left font-bold">自社商品コード</th>
                            <th className="px-3 py-2 text-left font-bold">在庫指定</th>
                            <th className="px-3 py-2 text-right font-bold">在庫数</th>
                            <th className="px-3 py-2 text-left font-bold">入庫日</th>
                            <th className="px-3 py-2 text-left font-bold">入庫時間</th>
                            <th className="px-3 py-2 text-left font-bold">備考</th>
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

                {/* Not found — キーワード登録ボタン付き */}
                {result.notFound.length > 0 && (
                  <div>
                    <p className="text-xs font-bold tracking-[0.15em] uppercase text-[oklch(0.48_0.22_27)] mb-2">
                      未登録商品 ({result.notFound.length}件)
                    </p>
                    <div className="h-px bg-[oklch(0.48_0.22_27)] mb-3" />
                    <p className="text-xs text-gray-400 mb-3">
                      「登録」ボタンで納品書キーワードを登録すると、次回から自動照合されます
                    </p>
                    <div className="space-y-1">
                      {result.notFound.map((item, i) => (
                        <div key={i} className="flex items-center gap-2 py-1.5 border-b border-black/10">
                          <span className="w-4 h-4 bg-[oklch(0.48_0.22_27)] flex-shrink-0" />
                          <span className="text-xs text-gray-700 flex-1">{item.label} <span className="text-gray-400">(数量:{item.quantity})</span></span>
                          <button
                            onClick={() => openModal(item)}
                            className="text-xs border border-black px-2 py-0.5 hover:bg-black hover:text-white transition-colors flex-shrink-0 font-bold"
                          >
                            登録
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* キーワード登録モーダル */}
                {modal.open && (
                  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white border-2 border-black w-full max-w-md p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-black tracking-[0.1em] uppercase">キーワード登録</p>
                        <button onClick={() => setModal(m => ({ ...m, open: false }))} className="text-gray-400 hover:text-black text-lg">×</button>
                      </div>
                      <div className="h-px bg-black" />
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs text-gray-400 mb-1">納品書の表記</p>
                          <p className="text-sm font-mono bg-gray-50 border border-black/20 px-3 py-2">{modal.productName}</p>
                        </div>
                        <div>
                          <label className="text-xs font-bold tracking-wider uppercase text-gray-600 block mb-1">登録キーワード</label>
                          <input
                            type="text"
                            value={modal.keyword}
                            onChange={e => setModal(m => ({ ...m, keyword: e.target.value }))}
                            placeholder="カンマ区切りで複数登録可"
                            className="w-full border border-black px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black"
                          />
                          <p className="text-xs text-gray-400 mt-1">スプレッドシートD列に追記されます</p>
                        </div>
                        <div>
                          <label className="text-xs font-bold tracking-wider uppercase text-gray-600 block mb-1">納品先自社コード <span className="text-red-500">*</span></label>
                          <select
                            value={modal.code}
                            onChange={e => setModal(m => ({ ...m, code: e.target.value }))}
                            className="w-full border border-black px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-black bg-white"
                          >
                            <option value="">―選択してください―</option>
                            {productCodes.map(p => (
                              <option key={p.code} value={p.code}>{p.code} — {p.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <button
                          onClick={() => setModal(m => ({ ...m, open: false }))}
                          className="flex-1 border border-black py-2 text-sm font-bold hover:bg-gray-50 transition-colors"
                        >
                          キャンセル
                        </button>
                        <button
                          onClick={handleRegisterKeyword}
                          disabled={modal.registering || !modal.code}
                          className="flex-1 bg-black text-white py-2 text-sm font-bold hover:bg-gray-800 transition-colors disabled:opacity-50"
                        >
                          {modal.registering ? "登録中...": "登録する"}
                        </button>
                      </div>
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
                      className="text-sm font-bold text-gray-500 hover:text-black transition-colors"
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
