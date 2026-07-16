import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Mail, RefreshCw, Download, CheckCircle, AlertCircle, Loader2, ExternalLink } from "lucide-react";

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
  status: string;
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

  function downloadCsv(job: GmailJob) {
    if (!job.csvContent) {
      toast.error("CSVデータがありません");
      return;
    }
    const bom = "\uFEFF";
    const blob = new Blob([bom + job.csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date(job.processedAt).toLocaleDateString("ja-JP").replace(/\//g, "");
    a.href = url;
    a.download = `nyuko_${date}_${job.filename.replace(".pdf", "")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between p-3 bg-white border rounded-lg hover:bg-gray-50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm text-gray-800 truncate">
                          {job.filename}
                        </span>
                        <Badge
                          variant={job.status === "done" ? "default" : "destructive"}
                          className="text-xs shrink-0"
                        >
                          {job.status === "done" ? "完了" : job.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-gray-500 space-y-0.5">
                        <div>差出人: {job.fromEmail}</div>
                        <div>
                          処理日時: {new Date(job.processedAt).toLocaleString("ja-JP")}
                          &nbsp;｜&nbsp;
                          変換成功: <span className="text-green-600 font-medium">{job.rowCount}件</span>
                          {job.notFoundCount > 0 && (
                            <>&nbsp;｜&nbsp;未登録: <span className="text-amber-600 font-medium">{job.notFoundCount}件</span></>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => downloadCsv(job)}
                      disabled={!job.csvContent}
                      className="ml-3 shrink-0"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      CSV
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
