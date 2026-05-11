# ログイン・プラン・アクセスコード仕様

加算マネージャは「**無料で使える / アクセスコードを入れたら有料プラン**」の二段構成です。

関連ドキュメント:
- [レビュアーガイド](./REVIEWER_GUIDE.md) — 有料プランで使える加算別承認ワークフロー
- [ポートフォリオ最適化](./PORTFOLIO.md) — 「次に取りに行くべき加算」の優先順位付け
- [使い方ガイド](./USER_GUIDE.md) — 全機能の概要
- [データ取扱方針](./DATA_SAFETY.md) — 個人情報・トークンの扱い

## ログインなしで使える機能

ログインしなくても、これまでどおり以下が使えます。

- サービス選択 → 加算マスタ判定（`/api/judge`）
- PDF レセプトアップロード → 抽出 → 判定
- AI 補完分析（`/api/analyze`、Gemini）
- CPOS PAT を入れての CPOS データ判定（`/api/cpos/facility/analyze`）

**個人情報・解析結果はサーバに保存しません。** PAT は暗号化 cookie のみ。

## ログインしたら何が増える？

Firebase Authentication（Google / メールパスワード）でログインすると、

1. プロフィール表示（自分の email）
2. アクセスコード入力欄

**ログインしただけでは有料機能は使えません。** プラン = `free` のままなので、

- 解析履歴は引き続き保存されません
- レビュー機能（承認・差戻し）も使えません

## アクセスコードで「有料プラン」に切り替える

管理者から配布された **アクセスコード**（例: `ABCD-EFGH-JKLM-NPQR`）を入力すると、
そのコードに紐づく「日数」だけ有料プラン期間が延長されます。

- 既存の有効期限がまだ未来なら、それを「加算」（30 + 30 = 60 日）
- 既存の有効期限が過去 or 無いなら、現在からスタート

有料プラン中は、

- `/api/judge` / `/api/cpos/facility/analyze` の結果が Firestore (`analysis_jobs`) と GCS (`analyses/{uid}/{analysis_id}/report.md`) に**自動保存**されます
- `/api/analyses` で過去 50 件まで一覧できます
- `/api/analyses/:id/review` でレビュー判断（`approved` / `returned` / `awaiting_review`）を記録できます

期限切れになると自動で `free` に戻ります（保存済データは消えません。再 redeem で再度参照可能）。

## 管理者: アクセスコード発行

サーバ env の `KASAN_ADMIN_EMAILS` にカンマ区切りで email を登録すると、その email
でログインしたユーザは「アクセスコード発行・一覧・失効」UI が出ます。

API:
- `POST /api/admin/access-codes  { durationDays, note }` → 新規発行
- `GET /api/admin/access-codes` → 一覧
- `DELETE /api/admin/access-codes/:code` → 未使用コードを失効

発行例:

```bash
curl -X POST https://<your-app>/api/admin/access-codes \
  -H "Authorization: Bearer <Firebase ID Token>" \
  -H "X-CSRF-Token: <csrf>" \
  -d '{"durationDays": 30, "note": "山田事業所 5月分"}'
```

返ってきた `code` を相手に配布。

## 設定が必要な環境変数

`.env.example` の「Firebase Authentication」セクションを参照。

主なもの:

- `FIREBASE_WEB_API_KEY` / `FIREBASE_AUTH_DOMAIN` / `FIREBASE_PROJECT_ID` / `FIREBASE_APP_ID` — クライアント Firebase SDK 用（public 値）
- `GCP_PROJECT_ID` — Firestore のプロジェクト ID
- `KASAN_GCS_BUCKET` — レポートを置く GCS バケット（任意。未設定なら Firestore のみ）
- `KASAN_ADMIN_EMAILS` — 管理者 email のカンマ区切り
- `FIREBASE_SERVICE_ACCOUNT_JSON` — Cloud Run 上は ADC で OK、ローカルは JSON 文字列

## Cloud Run でのセットアップ手順

1. Firebase プロジェクトを作成（`gcloud projects` と同じ ID 推奨）
2. Firebase Console > Authentication > Sign-in method で Google と Email/Password を有効化
3. Firebase Console > Project settings > General > マイアプリ で Web アプリを登録、
   `apiKey` / `authDomain` / `appId` を `.env` に転記
4. `gcloud firestore databases create --region=asia-northeast1`
5. GCS バケットを作成: `gsutil mb gs://<bucket-name>`
6. Cloud Run のサービスアカウントに以下を付与:
   - `roles/datastore.user` （Firestore 読み書き）
   - `roles/storage.objectAdmin` （GCS 読み書き）
   - `roles/secretmanager.secretAccessor` （Secret Manager 経由のシークレット利用時）
7. `.env` に値を入れて `npm run deploy:cloudrun`

## データ削除依頼への対応

ユーザから削除依頼があった場合、

```bash
gcloud firestore collections delete users/<uid> --recursive  # Firestore
gsutil -m rm -r gs://<bucket-name>/analyses/<uid>/           # GCS
```

監査ログ（`audit_logs`）は法令保全の観点で 1 年保持し、その後削除する運用を推奨。
