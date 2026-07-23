# 入庫変換アプリ TODO

## 認証
- [x] パスワード認証ログインページ（シンプルセッション管理）
- [x] セッションCookie管理・保護ルート（sessionStorage管理）

## フロントエンド UI
- [x] スイス様式デザイン（純白・赤アクセント・黒サンセリフ）のグローバルスタイル設定
- [x] ログインページ（左赤パネル＋右フォーム）
- [x] メインダッシュボード（ファイルアップロード + モード選択）
- [x] 処理モード選択UI（8モード）
  - [x] JAN読み取りJPG
  - [x] JAN読み取りPDF
  - [x] 商品名読み取りJPG
  - [x] 前原
  - [x] イシダ
  - [x] コレド
  - [x] 十二堂（CSV）
  - [x] 三陽（Excel）
- [x] JPG/PDFファイルアップロードUI（複数ファイル対応・ドラッグ&ドロップ）
- [x] 処理進捗表示（スピナー）
- [x] 結果表示（変換成功件数・未登録商品一覧・エラー一覧）
- [x] CSVダウンロードボタン（BOM付きUTF-8）
- [x] 処理ログ・エラー詳細表示（折りたたみ式）

## バックエンド API
- [x] パスワード認証エンドポイント（POST /api/auth/login）
- [x] ファイルアップロードエンドポイント（multer memoryStorage）
- [x] 処理エンドポイント（POST /api/process）
  - [x] Document AI OCR処理（JPG/PDF）
  - [x] Gemini API構造化処理（JANコード・商品名・数量・日付抽出）
  - [x] Googleスプレッドシート商品マスター照合
    - [x] JANコード完全一致
    - [x] 商品名あいまいマッチング（スペース除去・部分一致・数字優先）
  - [x] 助ネコCSV生成（自社商品コード／在庫指定／在庫数／入庫日／入庫時間／備考）
- [x] モード別処理ロジック
  - [x] JAN読み取りJPG/PDF
  - [x] 商品名読み取りJPG（productname_jpg）
  - [x] 前原（maehara）
  - [x] イシダ（ishida）
  - [x] コレド（cored）
  - [x] 十二堂CSV（junidou）
  - [x] 三陽Excel（sanyo）
- [x] Expressルーター登録（/api/auth/login, /api/process）

## 環境変数・外部連携
- [x] GOOGLE_SERVICE_ACCOUNT_JSON（Document AI + Sheets認証）→ 設定済み
- [x] DOCUMENT_AI_PROCESSOR_ID（Document AIプロセッサID）→ 設定済み
- [x] SPREADSHEET_ID（全商品取り扱いリスト）→ 設定済み
- [x] APP_PASSWORD（ログインパスワード）→ デフォルト: nyuko2024

## テスト
- [x] 認証テスト（vitest）
- [x] CSV生成テスト（vitest）
- [x] あいまいマッチングテスト（vitest）

## ハイブリッド商品マスター機能
- [x] DBスキーマ追加（productsテーブル: jan, code, nameKeywords, syncedAt）
- [x] マイグレーションSQL実行
- [x] sheets.tsをDB優先・スプレッドシートフォールバックに変更
- [x] 同期APIエンドポイント（POST /api/sync-products）
- [x] 同期状況確認APIエンドポイント（GET /api/sync-status）
- [x] フロントエンド管理画面に「商品マスター同期」ボタン追加
- [x] 同期件数・最終同期日時の表示

## フェーズ1: JANコード照合アプリの完成
- [x] productsテーブルDBスキーマ追加・マイグレーション実行
- [x] sheets.tsをDB優先・スプレッドシートフォールバックに変更
- [x] syncRouter.ts（同期API）作成・登録
- [x] 環境変数設定（GOOGLE_SERVICE_ACCOUNT_JSON, DOCUMENT_AI_PROCESSOR_ID, SPREADSHEET_ID）
- [x] Main.tsxにDB同期ボタン（件数・最終同期日時表示）追加
- [x] 動作確認（JANコード照合で変換できることを確認）

## 数量合算対応
- [x] 同一自社コードの行を数量合算してCSVに1行で出力（全モード共通）

## フェーズ2: JANなし商品の学習機能
- [x] スプレッドシートD列「納品書キーワード」を新設（sheets.ts: fetchFromSpreadsheetでA:D読み込み実装済み）
- [x] 照合ロジック強化: D列キーワードでの照合を追加（matchByNameでC列+D列結合照合実装済み）
- [x] 照合ロジック強化: 仕入先プレフィックス（sa-, id-等）を使った品番照合（matchBySupplierCode実装済み）
- [x] キーワード登録API（/api/register-keyword: appendDeliveryKeyword→DB再同期実装済み）
- [x] 未登録商品に「登録」ボタンを表示するUI（Main.tsx実装済み）
- [x] キーワード登録モーダル（候補コード選択・キーワード入力・確認）（Main.tsx実装済み）
- [x] 未登録商品が出た場合、商品名と候補コードを表示してキーワード登録できるUI（Main.tsx実装済み）
- [x] 登録済みキーワードをDBに保存してスプレッドシートにも反映（syncProductsToDB実装済み）

## フェーズ3: Gmail連携による複合機PDF自動処理
- [x] Gmail OAuth設定（phezzan.scan@gmail.com 連携完了）
- [x] Gmailを定期監視（5分ごとHeartbeat登録済み: QGiaVyvEDdSJ8xtqyE3p67）
- [x] 添付PDFをJAN読み取りPDFモードで自動処理
- [x] 処理結果CSVをアプリ内に保存（ダウンロード待ち一覧として表示）
- [x] 処理済みメールにラベルを付けて重複処理を防止（nyuko-processedラベル）
- [x] 処理結果一覧ページ（生成済みCSVのダウンロード）
- [x] Gmailアカウント設定手順をユーザーに案内

## モード整理（一新）
- [x] 不要モード削除: 三陽（sanyo）・十二堂（junidou）・コレド（cored）・イシダ（ishida）・前原（maehara）をUIとバックエンドから削除
- [x] 残すモード: JAN読み取りJPG・JAN読み取りPDF・商品名読み取りJPG の3モードに整理
- [x] processRouter.tsからprocessCSV・processExcel関数と対応するモード分岐を削除
- [x] ocr.tsのbuildPromptからmaehara/ishida/cored/junidou/sanyoのプロンプトを削除
- [x] Main.tsxのMODES配列を3モードに整理

## モード整理・照合ロジック改善（2026-07-16）
- [x] 不要モード削除: 三陽・十二堂・コレド・イシダ・前原・商品名読み取りJPGをUIとバックエンドから削除
- [x] 残すモード: JAN読み取りJPG・JAN読み取りPDF・商品名/商品コード読み取りPDF の3モードに整理
- [x] 照合順序修正: 品番照合（ステップ2）→ 商品名/D列照合（ステップ3・4）に変更
- [x] VENDOR_CODE_TO_NAME対応表をベンダーリスト旧シートから正確に更新
- [x] SUPPLIER_PREFIX_MAPのキーワードを正確な仕入先名に修正
- [x] スプレッドシートD1に「納品書キーワード」見出しを追加
- [x] スプレッドシートD列に全商品のキーワードを一括生成・書き込み（品番・ブランド名・型番）
- [x] GmailJob型にsupplierフィールドを追加
- [x] storageProxy.tsのTypeScriptエラー修正
- [x] CSVファイル名を「助ネコ在庫up{仕入先名}{MMDD}.csv」形式に統一（GmailJobs.tsx）
- [x] 全テスト30件パス確認

## GmailジョブUI改善（2026-07-23）
- [x] DBスキーマにnotFoundContent（未登録商品JSON）とsupplier（仕入れ元名）カラムを追加
- [x] gmailScheduler.tsでnotFoundContent・supplierをDBに保存するよう更新
- [x] GmailJobs.tsxにsupplier（仕入れ元名）バッジをファイル名横に表示
- [x] GmailJobs.tsxに未登録商品詳細モーダルを追加（「未登録 N件」ボタンで表示）

## Main画面にGmail自動取り込みCSVダウンロードを大きく表示（2026-07-23）
- [x] Main.tsxの処理モードセクション上部にGmailジョブCSVダウンロードエリアを大きなボタン形式で追加

## GmailジョブCSVダウンロード済みフラグ追加（2026-07-23）
- [x] gmail_jobsテーブルにdownloaded_atカラム追加・マイグレーション実行
- [x] /api/gmail-jobs APIでdownloaded_atを返す
- [x] CSVダウンロード時にdownloaded_atを記録するAPIエンドポイント追加
- [x] Main.tsxで未ダウンロードジョブを強調表示（赤バッジ・NEW表示）
- [x] GmailJobs.tsxでも未ダウンロード状態を表示
