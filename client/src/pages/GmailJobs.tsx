import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Mail, RefreshCw, Download, CheckCircle, AlertCircle, Loader2, ExternalLink, AlertTriangle } from "lucide-react";

interface NotFoundItem {
  label: string;
  quantity: number;
  supplierCode?: string;
  jan?: string;
}

interface GmailJob {
  id: number;
  messageId: string;
  subject: string;
  fromEmail: string;
  filename: string;
  processedAt: string;
  rowCount: number;
  notFoundCount: number;
  csvContent: string | null;
  notFoundContent: string | null;
  supplier: string | null;
  status: string;
  downloadedAt: string | null;
}

interface GmailStatus {
  ok: boolean;
  email?: string;
  error?: string;
}

export default function GmailJobs() {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [jobs, setJobs] = useState<GmailJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [notFoundModal, setNotFoundModal] = useState<{ open: boolean; job: GmailJob | null }>({ open: false, job: null });
  const [registeringIdx, setRegisteringIdx] = useState<number | null>(null);
  const [registeredIdxs, setRegisteredIdxs] = useState<Set<number>>(new Set());

  async function registerKeyword(item: NotFoundItem, idx: number) {
    setRegisteringIdx(idx);
    try {
      // 登録内容の優先順: supplierCode > jan > labelから抽出した品番 > 商品名
      const supplierCode = item.supplierCode || (() => {
        const m = item.label.match(/\[品番:([^\]]+)\]/);
        return m ? m[1].trim() : null;
      })();
      const jan = item.jan || (() => {
        const m = item.label.match(/\[JAN:([^\]]+)\]/);
        return m ? m[1].trim() : null;
      })();
      // 商品名：labelから品番・JANタグを除いた文字列
      const productName = item.label
        .replace(/\s*\[品番:[^\]]+\]/g, "")
        .replace(/\s*\[JAN:[^\]]+\]/g, "")
        .trim();
      // D列に登録する内容: supplierCode > jan > productName
      const keywordToRegister = supplierCode || jan || productName;

      const res = await fetch("/api/register-keyword", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: keywordToRegister,
          productName,
          supplierCode: supplierCode || undefined,
          jan: jan || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        const registered = supplierCode ? `品番:${supplierCode}` : jan ? `JAN:${jan}` : keywordToRegister;
        toast.success(`「${registered}」をD列に登録しました`);
        setRegisteredIdxs(prev => new Set(Array.from(prev).concat(idx)));
      } else {
        toast.error(`登録失敗: ${data.error || "不明なエラー"}`);
      }
    } catch {
      toast.error("登録に失敗しました");
    } finally {
      setRegisteringIdx(null);
    }
  }

  useEffect(() => {
    checkStatus();
    loadJobs();
  }, []);

  async function checkStatus() {
    setStatusLoading(true);
    try {
      const res = await fetch("/api/gmail-status");
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ ok: false, error: "接続確認に失敗しました" });
    } finally {
      setStatusLoading(false);
    }
  }

  async function loadJobs() {
    setLoading(true);
    try {
      const res = await fetch("/api/gmail-jobs");
      const data = await res.json();
      setJobs(Array.isArray(data) ? data : []);
    } catch {
      toast.error("ジョブ一覧の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function fetchNow() {
    setFetching(true);
    try {
      const res = await fetch("/api/gmail-fetch-now", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        toast.error(`エラー: ${data.error}`);
      } else {
        toast.success(`処理完了: ${data.processed}件処理、${data.skipped}件スキップ`);
        loadJobs();
      }
    } catch {
      toast.error("手動取り込みに失敗しました");
    } finally {
      setFetching(false);
    }
  }

  async function downloadCsv(job: GmailJob) {
    if (!job.csvContent) {
      toast.error("CSVデータがありません");
      return;
    }
    // 備考列に仕入れ元名を動的に追加（既存ジョブにも対応）
    const supplierName = job.supplier || "";
    const csvWithSupplier = (() => {
      const lines = job.csvContent.split("\n");
      return lines.map((line, idx) => {
        if (idx === 0) return line; // ヘッダーはそのまま
        if (!line.trim()) return line;
        // 備考列（6列目）に仕入れ元名を設定（既存値が空の場合のみ）
        const cols = line.split(",");
        if (cols.length >= 6) {
          const currentNote = cols[5].replace(/^"|"$/g, "").replace(/""/g, '"');
          if (!currentNote && supplierName) {
            cols[5] = `"${supplierName}"`;
          }
          return cols.join(",");
        }
        return line;
      }).join("\n");
    })();
    const bom = "\uFEFF";
    const blob = new Blob([bom + csvWithSupplier], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date(job.processedAt);
    const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const supplierPart = job.supplier || "";
    a.href = url;
    a.download = `助ネコ在庫up${supplierPart}${mmdd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    // ダウンロード済みを記録
    await fetch(`/api/gmail-jobs/${job.id}/downloaded`, { method: "POST" }).catch(() => {});
    setJobs(prev => prev.map(j => j.id === job.id ? { ...j, downloadedAt: new Date().toISOString() } : j));
  }

  function parseNotFound(job: GmailJob): NotFoundItem[] {
    if (!job.notFoundContent) return [];
    try {
      const parsed = JSON.parse(job.notFoundContent);
      // 旧形式（文字列配列）への後方互換
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "string") {
        return parsed.map((label: string) => ({ label, quantity: 0 }));
      }
      return parsed as NotFoundItem[];
    } catch {
      return [];
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto">
        {/* ヘッダー */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" />
              戻る
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Mail className="w-5 h-5 text-blue-600" />
              Gmail自動取り込み
            </h1>
            <p className="text-sm text-gray-500">複合機からスキャンしたPDFを自動処理します</p>
          </div>
        </div>

        {/* Gmail接続状態 */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Gmail接続状態</CardTitle>
          </CardHeader>
          <CardContent>
            {statusLoading ? (
              <div className="flex items-center gap-2 text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                確認中...
              </div>
            ) : status?.ok ? (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="w-5 h-5" />
                <span className="font-medium">接続済み</span>
                <span className="text-gray-500 text-sm">({status.email})</span>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 text-red-500 mb-3">
                  <AlertCircle className="w-5 h-5" />
                  <span className="font-medium">未接続</span>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
                  <p className="font-medium text-amber-800 mb-2">Gmail連携の設定が必要です</p>
                  <p className="text-amber-700 mb-3">
                    以下の手順でGmail APIの認証情報を設定してください：
                  </p>
                  <ol className="list-decimal list-inside space-y-1 text-amber-700">
                    <li>Google Cloud Consoleでプロジェクトを作成</li>
                    <li>Gmail APIを有効化</li>
                    <li>OAuth 2.0クライアントIDを作成（デスクトップアプリ）</li>
                    <li>認証情報（Client ID・Client Secret・Refresh Token）を取得</li>
                    <li>管理画面の「シークレット」に設定</li>
                  </ol>
                  <a
                    href="https://console.cloud.google.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-3 text-blue-600 hover:underline"
                  >
                    Google Cloud Console <ExternalLink className="w-3 h-3" />
                  </a>
                  {status?.error && (
                    <p className="mt-2 text-red-600 text-xs">エラー: {status.error}</p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 操作ボタン */}
        <div className="flex gap-3 mb-6">
          <Button
            onClick={fetchNow}
            disabled={fetching || !status?.ok}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {fetching ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />取り込み中...</>
            ) : (
              <><Mail className="w-4 h-4 mr-2" />今すぐ取り込む</>
            )}
          </Button>
          <Button variant="outline" onClick={loadJobs} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            更新
          </Button>
        </div>

        {/* 自動実行の説明 */}
        {status?.ok && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6 text-sm text-blue-700">
            <strong>自動実行：</strong>5分ごとにGmailを自動確認し、PDF添付メールを処理します。
            処理済みメールには「nyuko-processed」ラベルが付きます。
          </div>
        )}

        {/* ジョブ一覧 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">処理済みジョブ一覧</CardTitle>
            <CardDescription>自動処理されたPDFの結果CSVをダウンロードできます</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8 text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                読み込み中...
              </div>
            ) : jobs.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Mail className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p>まだ処理されたジョブはありません</p>
                <p className="text-sm mt-1">複合機からPDFをスキャンして送信すると自動処理されます</p>
              </div>
            ) : (
              <div className="space-y-3">
                {jobs.map((job) => {
                  const isNew = !job.downloadedAt;
                  return (
                  <div
                    key={job.id}
                    className={`flex items-center justify-between p-3 border rounded-lg ${
                      isNew ? "bg-red-50 border-red-300" : "bg-white border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      {/* ファイル名 + 仕入れ元名 + ステータス */}
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {isNew && (
                          <Badge className="text-xs shrink-0 bg-red-500 text-white border-0">未ダウンロード</Badge>
                        )}
                        <span className="font-medium text-sm text-gray-800 truncate max-w-xs">
                          {job.filename}
                        </span>
                        {job.supplier && (
                          <Badge variant="secondary" className="text-xs shrink-0 bg-blue-100 text-blue-700 border-blue-200">
                            {job.supplier}
                          </Badge>
                        )}
                        <Badge
                          variant={job.status === "done" ? "default" : "destructive"}
                          className="text-xs shrink-0"
                        >
                          {job.status === "done" ? "完了" : job.status}
                        </Badge>
                      </div>
                      {/* 処理日時・件数 */}
                      <div className="text-xs text-gray-500 mt-1">
                        処理日時: {new Date(job.processedAt).toLocaleString("ja-JP")}
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-lg font-black text-green-600">{job.rowCount}<span className="text-sm font-bold">件変換</span></span>
                        {job.notFoundCount > 0 && (
                          <span className="text-lg font-black text-amber-600">{job.notFoundCount}<span className="text-sm font-bold">件未登録</span></span>
                        )}
                      </div>
                    </div>
                    {/* ボタン群 */}
                    <div className="flex items-center gap-2 ml-3 shrink-0">
                      {job.notFoundCount > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setNotFoundModal({ open: true, job })}
                          className="border-amber-400 text-amber-600 hover:bg-amber-50"
                        >
                          <AlertTriangle className="w-4 h-4 mr-1" />
                          未登録 {job.notFoundCount}件
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => downloadCsv(job)}
                        disabled={!job.csvContent}
                      >
                        <Download className="w-4 h-4 mr-1" />
                        CSV
                      </Button>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 未登録商品詳細モーダル */}
      {notFoundModal.open && notFoundModal.job && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setNotFoundModal({ open: false, job: null })}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* モーダルヘッダー */}
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h2 className="font-bold text-gray-800 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  未登録商品の詳細
                </h2>
                <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">
                  {notFoundModal.job.supplier && (
                    <span className="text-blue-600 font-medium mr-1">[{notFoundModal.job.supplier}]</span>
                  )}
                  {notFoundModal.job.filename}
                </p>
              </div>
              <button
                onClick={() => setNotFoundModal({ open: false, job: null })}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            {/* 未登録リスト */}
            <div className="overflow-y-auto flex-1 p-4">
              {(() => {
                const items = parseNotFound(notFoundModal.job);
                if (items.length === 0) {
                  return (
                    <p className="text-sm text-gray-400 text-center py-4">
                      詳細データがありません（旧バージョンで処理されたジョブ）
                    </p>
                  );
                }
                return (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500 mb-3">
                      以下の商品は照合できませんでした。スプレッドシートのD列にキーワードを登録すると次回から自動照合されます。
                    </p>
                    {items.map((item, i) => (
                      <div key={i} className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-100 rounded">
                        <span className="w-5 h-5 bg-amber-400 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 break-all">{item.label}</p>
                          {item.quantity > 0 && (
                            <p className="text-xs text-gray-500">数量: {item.quantity}</p>
                          )}
                        </div>
                        {registeredIdxs.has(i) ? (
                          <span className="text-xs text-green-600 font-bold shrink-0">登録済</span>
                        ) : (
                          <button
                            className="text-xs bg-amber-500 text-white px-2 py-1 rounded hover:bg-amber-600 disabled:opacity-50 shrink-0"
                            disabled={registeringIdx === i}
                            onClick={() => registerKeyword(item, i)}
                          >
                            {registeringIdx === i ? "登録中..." : "D列に登録"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* モーダルフッター */}
            <div className="p-4 border-t">
              <Button
                className="w-full"
                variant="outline"
                onClick={() => setNotFoundModal({ open: false, job: null })}
              >
                閉じる
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
