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

## ログイン方式（2 通り・併存）

`/pro` ページでは 2 通りのログインが使えます。

1. **OAuth（Firebase）**: Google アカウント等。Firebase を設定している環境で有効。
   ヘッダ上部のログインパネルから。
2. **ネイティブ（メール / パスワード）**: Firebase 不要。Pro ワークスペースの
   ログイン欄から新規登録・ログイン。`KASAN_SESSION_SECRET` が設定されていれば有効。

ネイティブ認証の仕組み:

- パスワードは **scrypt でハッシュ化**して保存（平文は保持しない）
- ログイン成功で **AES-256-GCM で封入したセッション Cookie**（`kasan_session`, HttpOnly）を発行
- `/api/auth/register`・`/api/auth/login`・`/api/auth/logout`
- サーバ側 `authMiddleware` は「Firebase ID トークン → ネイティブセッション Cookie」の順で
  `req.user` を解決するため、両方式が同じ権限・プラン判定で扱われます

## ログインしたら何が増える？

ログインすると、

1. プロフィール表示（自分の email）
2. アクセスコード入力欄
3. **Pro ワークスペース**: 書類取込（フォルダ / ドラッグ&ドロップ / 少しずつ追加）→ 加算チェック
4. **施設プロフィール・従業員名簿の保存と流用**（次回以降に再利用・編集）

**ログインしただけでは有料機能（履歴保存・レビュー）は使えません。** プラン = `free` のままなので、

- 解析履歴は保存されません（解析の実行自体はできます）
- レビュー機能（承認・差戻し）も使えません

## 保存データはサーバ側で匿名化・要約

プロモードで保存されるデータは、**サーバ側でも必ず匿名化・要約**してから永続化します
（情報漏洩リスク低減・多層防御）。

- 氏名・カナ・被保険者番号・住所・電話・生年月日などを含むキーは**丸ごと破棄**
- 文字列値は被保険者番号 / 電話 / メール等を**伏字化**（`anonymize.js`）
- **従業員名簿は氏名を保存しません**。職種別人数・常勤換算へ要約し、行は「職種#連番」ラベルで保持
- 解析結果も保存前に匿名化し、最終チェック（`assertStorageSafe`）で PII 残存があれば保存中止
- 「少しずつ取込」のドラフトに保存されるのも匿名集計値のみ

## 施設・従業員名簿の保存／ドラフト（少しずつ取込）

ログインユーザーごとに以下を保存・流用・編集できます（`/api/profiles/*`, `/api/drafts/*`）。

- **施設プロフィール**: 事業所名・事業所番号・サービス種別・地域区分。次回の解析で選ぶだけ
- **従業員名簿**: 匿名化された職種別集計として保存。一覧から流用・編集
- **解析ドラフト**: 1 度に全書類が揃わなくても、匿名集計を複数回に分けて合算（merge）し、
  後から続きを実行できる

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

## 管理者: 有料ユーザー管理

`KASAN_ADMIN_EMAILS` の管理者は、Pro ワークスペース下部の「有料ユーザー管理」UI から、
ユーザー一覧の確認とプランの手動付与・取消ができます。

API:
- `GET /api/admin/users` → ユーザー一覧（email / 認証方式 / プラン / 登録日）
- `POST /api/admin/users/:uid/plan { action, days }`
  - `action: "grant"`（または `"extend"`）— `days` 日付与（既存期限が未来なら延長）
  - `action: "revoke"` — 即時 `free` に戻す

アクセスコード方式（ユーザー自身が入力）と、この直接付与方式（管理者が操作）は併用できます。

## 設定が必要な環境変数

`.env.example` の「Firebase Authentication」セクションを参照。

主なもの:

- `FIREBASE_WEB_API_KEY` / `FIREBASE_AUTH_DOMAIN` / `FIREBASE_PROJECT_ID` / `FIREBASE_APP_ID` — クライアント Firebase SDK 用（public 値・OAuth ログイン用）
- `GCP_PROJECT_ID` — Firestore のプロジェクト ID
- `KASAN_GCS_BUCKET` — レポートを置く GCS バケット（任意。未設定なら Firestore + ローカルストアに保存）
- `KASAN_ADMIN_EMAILS` — 管理者 email のカンマ区切り
- `FIREBASE_SERVICE_ACCOUNT_JSON` — Cloud Run 上は ADC で OK、ローカルは JSON 文字列
- `KASAN_SESSION_SECRET` — **ネイティブ（メール/パスワード）ログインに必須**（32 文字以上）。
  セッション Cookie・CPOS Cookie の暗号鍵に使用
- `KASAN_LOCAL_STORE_DIR` — Firestore 未設定環境での保存先ディレクトリ（既定 `app/.localstore`）。
  `:memory:` でプロセス内のみ（テスト）、`off` でローカル保存を無効化

### Firebase なしでも動く（ローカルストア・フォールバック）

Firebase / Firestore を設定していない環境（ローカル開発・自前ホスティング・CI）では、
`getDb()` が **Firestore 互換のローカルストア**（`KASAN_LOCAL_STORE_DIR`）に自動フォールバックします。
ネイティブ認証・プロフィール・ドラフト・履歴保存はローカルストアだけで一通り動作します。

- `KASAN_SESSION_SECRET` を設定すればネイティブログインが有効
- `/api/health` の `persistence.backend` が `firestore` / `local_store` / `none` を返します
- 単一プロセス前提の簡易実装です。複数インスタンスでスケールする本番では Firestore を設定してください

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
