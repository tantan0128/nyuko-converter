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
- [ ] 認証テスト（vitest）
- [ ] CSV生成テスト（vitest）
- [ ] あいまいマッチングテスト（vitest）

## ハイブリッド商品マスター機能
- [ ] DBスキーマ追加（productsテーブル: jan, code, nameKeywords, syncedAt）
- [ ] マイグレーションSQL実行
- [ ] sheets.tsをDB優先・スプレッドシートフォールバックに変更
- [ ] 同期APIエンドポイント（POST /api/sync-products）
- [ ] 同期状況確認APIエンドポイント（GET /api/sync-status）
- [ ] フロントエンド管理画面に「商品マスター同期」ボタン追加
- [ ] 同期件数・最終同期日時の表示

## フェーズ1: JANコード照合アプリの完成
- [x] productsテーブルDBスキーマ追加・マイグレーション実行
- [x] sheets.tsをDB優先・スプレッドシートフォールバックに変更
- [x] syncRouter.ts（同期API）作成・登録
- [x] 環境変数設定（GOOGLE_SERVICE_ACCOUNT_JSON, DOCUMENT_AI_PROCESSOR_ID, SPREADSHEET_ID）
- [ ] Main.tsxにDB同期ボタン（件数・最終同期日時表示）追加
- [ ] 動作確認（JANコード照合で変換できることを確認）

## フェーズ2: JANなし商品の学習機能
- [ ] 未登録商品一覧に「キーワード登録」ボタンを追加
- [ ] キーワード登録モーダル（商品名→C列キーワード候補を提案）
- [ ] スプレッドシートC列への書き込みAPI（PATCH /api/update-keyword）
- [ ] 登録後にDB再同期して即座に照合に反映
