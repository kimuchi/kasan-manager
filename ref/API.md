# CPOS API 仕様書

CPOS は 2 経路の認証・API を提供します:

- **セッション API** (`/api/...`) — 管理コンソール UI / ブラウザアプリ用。Google OAuth Cookie
- **端末 API** (`/api/device/...`) — Android アプリ / サードパーティ連携用。Bearer トークン

両 API は同じ URL 空間で共存しますが、認証方式とアクセス可能なスコープが異なります。

---

## 目次

1. [認証](#認証)
2. [共通](#共通)
3. [セッション API](#セッション-api)
   - 認証 / 利用者 / 記録 / 事業所設定 / 記録パイプライン / 書類整理 / 利用者詳細 / Apps / トークン管理 / テスト / トリガー
4. [端末 API (Android)](#端末-api-android)
5. [スコープ一覧](#スコープ一覧)
6. [エラー形式](#エラー形式)
7. [レート制限・ログ](#レート制限ログ)

---

## 認証

### セッション API (Cookie)

1. `GET /api/auth/google` にアクセス → Google OAuth に遷移
2. Google 認証後 `GET /api/auth/google/callback` に戻り、CPOS サーバが Cookie を発行
3. 以降のブラウザリクエストは `cpos_session` Cookie で認証

関連エンドポイント:
| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/auth/google` | OAuth 認可 URL へリダイレクト |
| GET | `/api/auth/google/callback` | コード交換 + セッション発行 |
| POST | `/api/auth/logout` | セッション破棄 |
| GET | `/api/auth/me` | 現在のセッション情報 |
| GET | `/api/auth/config` | OAuth 設定状況（未ログインでも呼べる） |

### 端末 API (Bearer トークン)

Android アプリは以下の手順でアクセス:

1. 管理者が管理コンソール `/app-tokens` で対象アプリを選んで **API トークンを発行**
2. 発行時に 1 度だけ表示される平文トークン（`cpos_pat_XXXX...`）を Android アプリに安全に保管
3. 各 API リクエストに `Authorization: Bearer cpos_pat_XXXX...` ヘッダを付ける

トークンは:
- `tokenHash` (SHA-256) のみサーバに保存（平文は保存しない）
- `scopes[]` で権限を制御（`users:read` / `records:write` / `*` など）
- `allowedFacilityIds` で対象事業所を制限可能
- `expiresAt` で期限設定可能
- 失効 (`revokedAt`) されたトークンは即座に 401 になる

---

## 共通

### 環境

- ベース URL: `https://<your-domain>/api/`
- Content-Type: `application/json`
- 文字コード: UTF-8
- 日付形式: ISO 8601 (`2026-04-24T10:30:00.000Z`) または `yyyy-MM-dd` / `yyyy/MM/dd`

### 組織スコープ

すべての API は **組織 (organizationId)** で隔離されます。セッションとトークンは組織に紐づきます。

### テストモード

`/api/test/...` 配下はフィクスチャ応答 + 書込偽装で、本番データには触れません。開発・デモ用。

---

## セッション API

### 利用者マスタ (MasterUsers)

被保険者番号 (10 桁または `tmp-*` 仮 ID) を一次キーとする利用者管理。
全利用者は `MasterUser` (`packages/records/src/master-user.ts`) で統一管理する。

| メソッド | パス | 必要ロール | 説明 |
|---------|------|-----------|------|
| GET | `/api/master-users?query=&facilityId=&activeOnly=&onlyTemp=` | staff+ | 一覧 (氏名・フリガナ・被保険者番号で検索可、仮 ID 絞込可) |
| GET | `/api/master-users/:insuredNumber` | staff+ | 1 件取得 (10 桁 / tmp-* どちらも) |
| POST | `/api/master-users` | manager+ | 新規 (insuredNumber 未入力時は `tmp-<random>` 自動発行) |
| PUT | `/api/master-users/:insuredNumber` | manager+ | 更新 |
| DELETE | `/api/master-users/:insuredNumber` | manager+ | 削除 (関連 assignment も削除) |
| POST | `/api/master-users/bulk-delete` | manager+ | 一括削除 (`{ insuredNumbers: string[] }`) |
| POST | `/api/master-users/:tmpInsuredNumber/promote` | manager+ | 仮 ID → 正規 10 桁番号への昇格 (assignment も付け替え) |
| POST | `/api/master-users/:insuredNumber/change-insured-number/preview` | manager+ | 番号変更の影響件数を返す (DB 変更なし) |
| POST | `/api/master-users/:insuredNumber/change-insured-number/apply` | manager+ | 番号変更を実行 (assignments / extras / care records / care plans / appData を cascade 移行)。詳細は [`docs/MASTER_USER_RENAME.md`](./MASTER_USER_RENAME.md) |
| POST | `/api/master-users/normalize-strings` | manager+ | 既存マスタの全角数字 / 全角空白を半角に一括正規化 (`{ dryRun? }`) |
| GET / PUT | `/api/master-users/:insuredNumber/important-matters?facilityId=` | staff+ | 重要事項抽象 API (Google Doc / DB 自動切替)。詳細は [`docs/IMPORTANT_MATTERS.md`](./IMPORTANT_MATTERS.md) |
| GET | `/api/master-users/:insuredNumber/facilities` | staff+ | 利用者の事業所アサイン一覧 |
| POST | `/api/master-users/:insuredNumber/facilities` | manager+ | アサイン追加 |
| PUT | `/api/master-users/assignments/:id` | manager+ | アサイン更新 |
| DELETE | `/api/master-users/assignments/:id` | manager+ | アサイン削除 |
| GET | `/api/master-users/by-facility/:facilityId` | staff+ | 特定事業所の利用者一覧 (assignment 経由) |
| POST | `/api/master-users/import-csv` | manager+ | 標準 CSV 取込 (`{ csv, dryRun? }`) |
| POST | `/api/master-users/import-trikea-csv` | manager+ | トリケアトプス形式 CSV 取込 (`{ csv, dryRun? }`)。同一利用者ID の複数行は中止日が最新の行を採用、被保険者番号欠落時は `tmp-trikea-<id>` 発行、既存 トリケアトプス ID と一致すれば `insuredNumber` と extras を引継 |
| GET | `/api/master-users/export.csv?facilityId=` | manager+ | CSV エクスポート (UTF-8 BOM、Excel 互換) |
| POST | `/api/master-users/sync-from-folders` | manager+ | Drive 利用者フォルダから利用者マスタへ同期。`{ mode: 'dry-run'/'apply', deepPreview?, async? }`、`async: true` で `jobId` 即返却 → ポーリング |
| GET | `/api/master-users/sync-jobs/:jobId` | manager+ | 同期ジョブ進捗 (phase / current / total / folderName) |
| GET | `/api/master-users/:insuredNumber/care-plans?all=true` | staff+ | 利用者フォルダ内のファイル一覧 (`all=true` で全種別、デフォルトはケアプラン関連のみ) |
| GET | `/api/master-users/:insuredNumber/care-plans/preview?fileId=` | staff+ | ファイルプレビュー (CSV/JSON/Excel/Sheets/PDF)。ケアプラン JSON は `kind: 'care-plan-json'` + `shape` を返す |
| POST | `/api/master-users/:insuredNumber/careplan/convert` | staff+ | 任意ファイル → V4 CSV 生成 + 利用者基本情報をマスタに反映 |
| GET | `/api/master-users/:insuredNumber/careplan/view` | staff+ | 利用者フォルダ配下の V4 CSV を読み取って構造化 `CarePlanBundle` を返す (帳票表示用) |

### ケアプラン (CarePlans)

構造化ケアプラン (`StoredCarePlan`) の CRUD + AI 生成 + 承認 + 共有 + Sheets 出力。

| メソッド | パス | 必要ロール | 説明 |
|---------|------|-----------|------|
| GET | `/api/care-plans?insuredNumber=&status=&proposalGroupId=&createdBy=&sharedWith=&limit=` | staff+ | 一覧。`?createdBy=me` は session.userId に置換 |
| GET | `/api/care-plans/:id` | staff+ | 1 件取得 |
| POST | `/api/care-plans` | staff+ | 新規 / 更新 (id 指定時は upsert) |
| POST | `/api/care-plans/bulk` | staff+ | 複数件を 1 リクエストで upsert (`{ plans: [...] }`) |
| POST | `/api/care-plans/generate` | staff+ | AI で複数案生成 (`{ insuredNumber, sourceFileIds, businessMode, numProposals? }`)。各案を `proposalGroupId` 共通で個別保存 |
| POST | `/api/care-plans/import-from-file` | staff+ | Drive 上のファイル → `StoredCarePlan` に取込 (`{ insuredNumber, fileId, fileName?, mimeType? }`)。Excel は `@cpos/excel-import` で構造化、JSON は既知形式直接変換 + AI fallback、PDF は AI 抽出 |
| POST | `/api/care-plans/:id/approve` | manager+ | 承認 (status='approved') |
| PUT | `/api/care-plans/:id/share` | staff+ | 共有先メール一覧設定 (`{ sharedWith: string[] }`) |
| POST | `/api/care-plans/:id/export-sheet` | staff+ | 承認済プランを Sheets テンプレに出力。`SystemSettings.carePlan.exportTemplateSpreadsheetId{Kyotaku,Shoki}` を業務モードで選択 |
| DELETE | `/api/care-plans/:id` | manager+ | 削除 |

### ファイル自動配置 (旧称 ケアプラン取込) — Excel 取込 + PDF AutoFiler

メニュー上は「ファイル自動配置」。旧 GAS AutoFiler V3.0 と同等の PDF AI
自動整理 + Excel 取込みを 1 メニューに統合 (UI: `/auto-filing`、旧 URL
`/care-plan-import` も互換維持)。

**Excel 取込み API** (構造化 + マスタ補完):

Excel ケアプラン (.xlsx) / アセスメント (.xlsx) の一括取込。`@cpos/excel-import` を使用。

| メソッド | パス | 必要ロール | 説明 |
|---------|------|-----------|------|
| POST | `/api/care-plan-import/preview` | staff+ | multipart で複数 Excel (最大 50 / 30MB ea) → パース + 利用者マッチ。30 分キャッシュ後に commit |
| POST | `/api/care-plan-import/commit` | staff+ | プレビュー結果に基づき MasterUser 紐付け or 新規作成 + Drive 配置 + StoredCarePlan ドラフト化 + **事業所自動紐付け** |
| POST | `/api/care-plan-import/cleanup` | admin | キャッシュ強制クリア (開発用) |

**事業所自動紐付け** (`commit`):
- ケアプランの `居宅介護支援事業者` (`table1.supportOfficeAndAddress`) または
  フェイスシートのヘッダ事業所名 (`facilityHeader`) から事業所名を抽出
- `FacilityConfig.name` と完全一致 → 双方向包含で 1 事業所に絞り込めた場合のみ
  `UserFacilityAssignment` を upsert (重複作成は防止)

**PDF AI 自動整理 API** (旧 GAS AutoFiler V3.0 相当):

任意 PDF を Gemini AI で書類種別・利用者・日付判別 → 利用者×期間フォルダ
を Drive に自動生成 → ファイル名規則 `YYYYMMDD_書類名_氏名.pdf` で配置。
ケアプラン以外の各種帳票・指示書も対象 (`@cpos/filing` を使用)。
詳細は §書類整理 (Filing) も参照。

| メソッド | パス | 必要ロール | 説明 |
|---------|------|-----------|------|
| POST | `/api/filing/analyze-batch` | staff+ | 複数 PDF を base64 で受け取り、Gemini AI で解析 + 配置 plans 生成 (最大 100MB) |
| POST | `/api/filing/apply-batch` | staff+ | analyze-batch の plans を Drive へ実適用 (利用者×期間フォルダ作成 + ファイル配置 + 必要に応じて PDF 注釈追記) |
| POST | `/api/filing/analyze` | staff+ | 単発版 (50MB) |
| POST | `/api/filing/apply` | staff+ | 単発版 (50MB) |
- 結果は `messages[]` に `事業所「○○」に自動紐付けしました` 等で返る
- `commit` でフェイスシート/アセスメント Excel を取り込んだ場合、
  CareDocument (documentType=face-assessment / source=excel-import) の
  draft も作成し `artifacts.careDocumentId` を返す

### 業務ドキュメント (Care Documents)

アセスメント・フェイスシート・ケアプランを横断管理する共通基盤。
詳細: [`CARE_DOCUMENTS.md`](./CARE_DOCUMENTS.md) /
[`CARE_DOCUMENTS_API.md`](./CARE_DOCUMENTS_API.md) /
[`CARE_DOCUMENTS_AI.md`](./CARE_DOCUMENTS_AI.md) /
[`MHLW_VISIT_NURSING_DOCUMENTS.md`](./MHLW_VISIT_NURSING_DOCUMENTS.md)
(厚労省 訪問看護 標準/参考様式準拠の 8 サブタイプ)。
Base `/api/care-documents/v1`、scope `care-documents:<read|write|approve|
delete|ai>`。Cookie / Bearer 両対応。

> 認可の実体 (`platform/authz.ts`):
> - **Cookie session 経路** (管理画面): `admin` ロールは無条件許可。
>   `manager/staff/nurse` 等は `fallbackRoles` で許可されるため、
>   ブラウザ操作にスコープ付与 GUI は不要。
> - **Bearer (App / PAT) 経路** (cpos-record / VNS 等): トークンの
>   `scopes` に `care-documents:read` 等が必要。`設定 → API トークン`
>   (`/app-tokens`) のスコープ一覧から付与できる (`care-documents:*`
>   ワイルドカード / `*` 全権も可)。スコープ不足時の 403 は付与先
>   (`/app-tokens`) を案内する。

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/care-documents/v1/templates[/:id]` | テンプレート (標準 `small-scale-face-assessment` を seed) |
| GET/POST | `/api/care-documents/v1` | 一覧 (既存 StoredCarePlan も統合) / 作成 |
| GET/PUT/DELETE | `/api/care-documents/v1/:id` | 取得 / 更新 / 削除 |
| POST | `/api/care-documents/v1/:id/{submit-review,mark-canonical,archive,void}` | 状態遷移 (mark-canonical は同一 group の旧 canonical を superseded 化) |
| POST | `/api/care-documents/v1/import` | 外部一括流し込み (idempotencyKey で冪等) |
| POST | `/api/care-documents/v1/:id/ai-fill` | AI 補完候補 (draft/review のみ、人が採用) |
| POST | `/api/care-documents/v1/draft-from-context` | 既存情報から AI 下書き生成 |
| POST | `/api/care-documents/v1/:id/write-back-master-user` | フェイスシート→利用者マスタ反映 |
| POST | `/api/care-documents/v1/:id/export.json` | JSON ダウンロード |

### サービス予定 (Care Schedules)

「利用者 × 曜日/日付 × 時間 × 担当 × 保険区分」の繰り返し予定を CPOS
中立基盤として横断管理。VNS の visit-schedules や訪問介護の訪問予定など
業務アプリごとに分散していた予定リソースをここに集約します。詳細:
[`CARE_SCHEDULES.md`](./CARE_SCHEDULES.md) /
[`CARE_SCHEDULES_API.md`](./CARE_SCHEDULES_API.md) /
[`VNS_MIGRATION_FROM_APPDATA_SCHEDULES.md`](./VNS_MIGRATION_FROM_APPDATA_SCHEDULES.md)。
Base `/api/care-schedules`、scope `care-schedules:<read|write|delete>`、
admin / manager / staff / nurse / PT / OT / ST が fallbackRoles で読取可。

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/care-schedules` | 一覧 (`facilityId/insuredNumber/serviceDomain/serviceType/status/activeOn/limit`) |
| GET | `/api/care-schedules/today` | 指定日に有効な予定 (`date,facilityId,serviceDomain,insuredNumber`) |
| GET | `/api/care-schedules/occurrences` | recurrence を `dateFrom..dateTo` (最大90日) に展開 + 例外適用した発生日一覧。VNS グリッド/担当者負荷の SoT。`status`/`recurrenceKind`/`original*` を返す。詳細: [`CARE_SCHEDULES_API.md`](./CARE_SCHEDULES_API.md) |
| POST | `/api/care-schedules/batch` | 週複数回の一括作成 (`items[]` 最大50、同一 facilityId、`mode=all-or-nothing\|partial`)。staff 正準化・conflict は item 毎 |
| GET | `/api/care-schedules/reconciliation` | 予定 × 実績照合 (`date,facilityId,serviceDomain,appId,resource`)。±60min ですり合わせ、`unscheduledActuals` も返す |
| GET/POST | `/api/care-schedules[/:id]` | 取得 / 作成 / 更新 |
| DELETE | `/api/care-schedules/:id` | 物理削除 (admin/manager) |
| POST | `/api/care-schedules/:id/cancel` | `status='cancelled'` |
| POST | `/api/care-schedules/:id/create-actual` | 実績作成用 prefill 返却 (実体は呼び出し側で `POST /api/app-data/...`) |
| POST | `/api/care-schedules/migrate-from-app-data` | AppData → CareSchedule 昇格 (冪等、`dryRun` 可) |

予定・実績照合は **CPOS 本体** で行います (画面側で各業務アプリが計算する
のではなく、`/reconciliation` を呼ぶ)。

### 事業所スタッフ (Facility Staff)

事業所スタッフ SoT。表記揺れ ("奥野史也" vs "奥野 史也") を吸収して
スケジュール衝突検出・実績照合の精度を上げる横断基盤。詳細:
[`FACILITY_STAFF.md`](./FACILITY_STAFF.md) /
[`FACILITY_STAFF_API.md`](./FACILITY_STAFF_API.md) /
[`CARE_SCHEDULE_STAFF_VIEW.md`](./CARE_SCHEDULE_STAFF_VIEW.md)。
Base `/api/facilities/:facilityId/staff` (admin CRUD) +
`/api/platform/facility-staff` (read facade)、scope
`facility-staff:<read|write|delete>`。

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/facilities/:facilityId/staff?activeOnly=&q=&profession=&limit=` | 一覧 (`{items, staff}` 両方を返却) |
| GET | `/api/facilities/:facilityId/staff/:id` | 1 件取得 |
| POST | `/api/facilities/:facilityId/staff` | 新規 (`name` 必須、同名 active には `duplicate-staff-name` warning) |
| PUT | `/api/facilities/:facilityId/staff/:id` | 部分更新 (`name` 変更時は `normalizedNameKey` 自動再計算) |
| POST | `/api/facilities/:facilityId/staff/:id/deactivate` | active → inactive |
| POST | `/api/facilities/:facilityId/staff/:id/reactivate` | inactive/retired → active |
| DELETE | `/api/facilities/:facilityId/staff/:id` | 物理削除 (admin のみ、誤投入クリーンアップ用) |
| POST | `/api/qualified-persons/v1/sync-from-employees` | CPOS の従業員 (AuthUserRecord) を有資格者名簿に upsert。突合は `employeeId === userId`。professions は licenseType / careManagerLicense / careQualifications / role から派生。新規組織の初期立ち上げ導線 |
| POST | `/api/facilities/:facilityId/staff/sync-from-qualified-persons` | 有資格者名簿 (QualifiedPerson) のうち `facilityIds` に対象事業所が含まれる active な人を一括 upsert。突合は qualifiedPersonId → employeeId → 正準氏名。新規事業所の推奨開始導線 |
| POST | `/api/facilities/:facilityId/staff/migrate-from-care-schedules` | 既存 CareSchedule の手入力担当者名から FacilityStaff 候補を抽出 / 一括作成 (dryRun 既定 true、`canonicalizeSchedules=true` で既存予定の assignedStaffId も反映) |
| POST | `/api/facilities/:facilityId/staff/migrate-from-app-data-records` | 既存 AppData (例 `vns/visit-records`) の手入力担当者名 (`data.visitedByName` 等) から FacilityStaff 候補を抽出 + (任意で) AppData / CareServiceActual も正準化。本文・バイタル・submitted 状態は変更しない (担当者メタのみ)。詳細: [`VNS_STAFF_RECORD_MIGRATION.md`](./VNS_STAFF_RECORD_MIGRATION.md) |
| GET | `/api/platform/facility-staff?facilityId=...` | VNS など業務アプリ向け read facade |

すべての admin CRUD / migrate ルートは path の `facilityId` が actor
所属組織の事業所マスタに存在するか確認する (404 `reasonCode:
'facility-not-found'`)。誤投入で別組織の facility にスタッフが入る
事故を防ぐ。

CareSchedule の create/update/check-conflicts は内部で
`canonicalizeAssignedStaff()` を呼び、`assignedStaff{Id,Name}` を SoT
で正準化する。詳細は [`CARE_SCHEDULE_CONFLICTS.md`](./CARE_SCHEDULE_CONFLICTS.md) の
「facility-staff SoT との連携」セクション。

### 外部関係先マスタ (External Partners)

医療機関・主治医、居宅介護支援事業所・ケアマネ等の CPOS 共通マスタ (SoT)。
詳細: [`EXTERNAL_PARTNERS.md`](./EXTERNAL_PARTNERS.md) /
[`EXTERNAL_PARTNERS_API.md`](./EXTERNAL_PARTNERS_API.md) /
[`VNS_EXTERNAL_PARTNER_MIGRATION.md`](./VNS_EXTERNAL_PARTNER_MIGRATION.md)。

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET/POST | `/api/external-partners/organizations` | 外部組織 一覧 / 作成 (read=staff〜、write=admin/manager) |
| GET/PUT/DELETE | `/api/external-partners/organizations/:id` | 取得 / 更新 / 削除 (配下担当者も削除) |
| GET/POST | `/api/external-partners/contacts` | 担当者 一覧 / 作成 |
| GET/PUT/DELETE | `/api/external-partners/contacts/:id` | 取得 / 更新 / 削除 |
| GET | `/api/external-partners/template.csv`, `/export.csv` | CSV テンプレート / 書出 |
| POST | `/api/external-partners/import-csv/{preview,apply}` | CSV 取込 (`{ csv }`) |
| POST | `/api/external-partners/migrate-from-app-data` | VNS AppData (medical-providers/care-managers) から移行 |
| GET | `/api/platform/external-partners/search` | Platform 検索 (Bearer, `external-partners:read`) |
| GET/POST | `/api/platform/external-partners/medical-providers` | 医療機関・主治医 一覧 / 登録 (VNS 互換) |
| GET/POST | `/api/platform/external-partners/care-managers` | 居宅介護支援・ケアマネ 一覧 / 登録 (VNS 互換) |

Platform facade は VNS / cpos-record が Bearer/PAT で参照・登録する。read =
`external-partners:read`、write = `external-partners:write`。POST は組織を名寄せして
find-or-create し、`vnsCompat` 付きの Option を返す。

### AppData レコード ライフサイクル (submit / reopen / void)

`/api/app-data/:appId/:resource/:id/{submit,reopen,void}` で状態遷移を
行います。**`PUT /...` で `status` を直接書き換えてはいけません** (監査・
revision・確定者が残らないため)。詳細: [`APP_DATA_LIFECYCLE.md`](./APP_DATA_LIFECYCLE.md)。

| メソッド | パス | 動作 / 409 |
|---|---|---|
| POST | `/api/app-data/:appId/:resource/:id/submit` | `draft → submitted` (`already-submitted` で 409) |
| POST | `/api/app-data/:appId/:resource/:id/reopen` | `submitted → draft` (`not-submitted` で 409) |
| POST | `/api/app-data/:appId/:resource/:id/void` | `* → voided` (`already-voided` で 409) |

CPOS が `submittedAt/By/ByName` / `reopenedAt/By/ByName` /
`voidedAt/By/ByName` / `revision` を stamp。監査イベント
`app-data.{submit,reopen,void}` と webhook
`{appId}.{resource}.{submitted|reopened|voided}` を発行。

### AppData 添付ファイル (画像 / PDF)

訪問記録・なんでもボックスなどに画像・PDF を添付するための共通基盤。
詳細: [`APP_DATA_ATTACHMENTS.md`](./APP_DATA_ATTACHMENTS.md)。

| メソッド | パス | scope | 説明 |
|---|---|---|---|
| GET | `/api/app-data/attachments/config` | (read) | クライアント向け上限/推奨設定 (`maxBinaryBytes`/`recommendedClientMaxBytes`/`jsonBodyLimit`/`allowedMimeTypes`/`signedUploadSupported`) |
| POST | `/api/app-data/:appId/:resource/:id/attachments` | `app-data:<appId>:write` | `{fileName, mimeType, role?, bodyBase64}` でアップロード。201。専用 JSON limit (`APP_DATA_ATTACHMENT_JSON_LIMIT`) で 413 を回避 |
| POST | `/api/app-data/:appId/:resource/:id/attachments/upload-session` | `app-data:<appId>:write` | signed upload (直接 PUT) の session 発行。未対応 store は 501 `signed-upload-not-enabled` |
| POST | `/api/app-data/:appId/:resource/:id/attachments/complete-upload` | `app-data:<appId>:write` | signed upload 完了 (metadata 確定)。GCS 配線後に有効 |
| GET | `/api/app-data/:appId/:resource/:id/attachments` | `app-data:<appId>:read` | 一覧 |
| GET | `/api/app-data/:appId/:resource/:id/attachments/:fileId` | `app-data:<appId>:read` | バイナリ取得 (Content-Type は保存時 mime) |
| DELETE | `/api/app-data/:appId/:resource/:id/attachments/:fileId` | `app-data:<appId>:write` | 削除 |

許可 mime は `image/jpeg|png|webp|heic|heif` / `application/pdf`。
既定上限: 1 ファイル 10MB / record 1 件あたり 20 件
(`APP_DATA_MAX_ATTACHMENT_BYTES` / `APP_DATA_MAX_ATTACHMENTS_PER_RECORD`)。
監査: `app-data.attachment.upload` / `app-data.attachment.delete`。

**アップロード方式**: JSON body + base64 のみ。**multipart/form-data は
非対応** (誤って送ると 400 `invalid-body` + JSON/base64 で送るべき旨の
案内が返る)。POST/GET-list response は VNS wrapper 互換のため
`id` / `name` / `size` / `url` / `downloadUrl` の alias を含む。
caption (任意の説明テキスト) を保持。

**production 永続化**: `APP_DATA_FILE_STORE=gcs` + `APP_DATA_GCS_BUCKET`
を設定。`memory` のままだと起動 hard-fail (override:
`ALLOW_EPHEMERAL_APP_DATA_FILES=true`)。

### AppData 自由文一括分析 (バイタル / 要約 バックフィル)

既存 AppData の自由文 (specialNotes / notes / body 等) からバイタル
(体温・血圧・脈拍・SpO2・呼吸数・疼痛) や要約をルールベースで一括抽出し、
構造化フィールド (`data.vitals.*` / `data.summary`) に補完する管理者用
API。詳細: [`APP_DATA_FREE_TEXT_ANALYSIS.md`](./APP_DATA_FREE_TEXT_ANALYSIS.md)。

| メソッド | パス | scope | 説明 |
|---|---|---|---|
| POST | `/api/app-data/:appId/:resource/analyze-free-text` | `app-data:<appId>:read` + `record-extractors:read` (+ apply 時 `app-data:<appId>:write`) | dryRun でプレビュー、`apply=true` で実反映。`overwriteExisting=false` (既定) で既存値は維持。本文・status は変更しない |

監査: `app-data.analyze-free-text` (リクエストごと) /
`app-data.apply-extracted-vitals` (vitals 反映 record ごと) /
`app-data.apply-extracted-rehab` (rehab 反映 record ごと) /
`app-data.apply-summary` (summary 反映 record ごと)。

### オンボーディング (利用者 + 初期予定 1 ステップ)

新規利用者の登録と訪問予定の登録を 1 リクエストにまとめる薄いラッパー。

| メソッド | パス | scope | 説明 |
|---|---|---|---|
| POST | `/api/onboarding/visit-nursing-user` | admin / manager | `{facilityId, user:{name, insuredNumber?, ...}, visitNursing:{initialSchedules:[{pattern, dayOfWeek?, startTime, endTime, serviceType, assignedStaffId?, validFrom}]}}` → `{user, schedules, warnings}` |

部分失敗は warnings に出して続行 (user 作成失敗のみ全体失敗)。
patterns: `weekly` / `biweekly` / `monthly` (dayOfMonth or nthWeekday) /
`interval-months` / `one-time`。

### リマインダー (Care Reminders)

指示書期限・計画書更新月・低頻度訪問の事前通知を統一する基盤。詳細:
[`CARE_REMINDERS.md`](./CARE_REMINDERS.md)。

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/care-reminders` | event 一覧 |
| GET | `/api/care-reminders/rules` | rule 一覧 |
| POST | `/api/care-reminders/rules` | rule 作成 (admin/manager) |
| PUT | `/api/care-reminders/rules/:id` | rule 更新 |
| POST | `/api/care-reminders/rules/:id/disable` | active → inactive |
| POST | `/api/care-reminders/events/rebuild` | 元データから event を再生成 (冪等) |
| POST | `/api/care-reminders/events/:id/dismiss` | event を既読化 |
| POST | `/api/care-reminders/events/:id/snooze` | `{snoozedUntil}` を指定して延期 |

監査: `care-reminder.rule.{create,update}` / `care-reminder.events.rebuild`。

### 記録抽出器 (Record Extractors)

本文 (記録メモ) からバイタル等を抽出する共通 API。実装は `@cpos/record-
extractors` package。詳細: [`RECORD_EXTRACTORS.md`](./RECORD_EXTRACTORS.md)。
Base `/api/record-extractors`、scope `record-extractors:read`。

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/api/record-extractors/vitals` | `{text}` → `fields: {temperature?, bpSystolic?, bpDiastolic?, pulseRate?, spo2?, respiratoryRate?, painScale?}`。BT/KT/BP/SBP/DBP/PR/HR/S 等の現場略記に対応 (`BT36.8,BP150/72,PR55,S96` 形式 OK)。詳細: [`RECORD_EXTRACTORS_REHAB.md`](./RECORD_EXTRACTORS_REHAB.md) |
| POST | `/api/record-extractors/rehab` | `{text}` → `fields: ExtractedRehabFields` (ROM / MMT / FSTS / 歩行 / コミュニケーション / 睡眠 等)。訪問リハ記録の評価項目抽出。詳細: [`RECORD_EXTRACTORS_REHAB.md`](./RECORD_EXTRACTORS_REHAB.md) |
| POST | `/api/record-extractors/summary` | `{text, mode?, style?, maxLength?, serviceType?, includeStructuredFindings?, model?, promptVersion?, facilityId?}` → `{summary, bullets, warnings, model, promptVersion?, sections?, structured?}`。SOAP セクション + structured.vitals/rehab 同梱対応、provider 差替え可 (local / gemini)。優先順位: request > facility > organization > env。詳細: [`RECORD_SUMMARY_AI_PROMPTS.md`](./RECORD_SUMMARY_AI_PROMPTS.md) |
| GET | `/api/record-extractors/summary/config?facilityId=...` | `{provider, appliedProvider, defaultModel, allowedModels[{value,label,tier,stability,recommended}], promptVersions, defaultPromptVersion, diagnostics{apiKeyPresent, providerFrom, defaultModelInAllowedModels, deprecatedModels, usingFallback}}` — UI が利用可能なモデル / プロンプトを取得。`facilityId` を渡すと事業所別 override merge 済の effective を返す。`appliedProvider` は実際に使われている provider (key 不在で local fallback された場合は `local` + `reason`) |
| GET | `/api/record-extractors/summary/health` | `{ok, provider, appliedProvider, apiKeyPresent, defaultModel, allowedModels[], defaultPromptVersion, reason?, deprecatedModels[], warnings[]}` — 「Gemini が本当に使われているか」を確認する軽量ヘルスチェック。API key の値は一切返さない (boolean のみ) |
| POST | `/api/record-extractors/summary/smoke-test` | admin/manager。`{fixture, model?, promptVersion?}` で固定 fixture (関口様等) を実 provider で要約。本番の configuration 確認用 |
| POST | `/api/record-extractors/summary/feedback` | `{rating, reason?, comment?, promptVersion?, model?, sampleInputText?, sampleSummary?}` → 保存された feedback。rating は `'good' \| 'bad' \| 'mixed'` (それ以外は 400 `invalid-rating`)。comment は 2000 字、sample 系は 4000 字で自動切り詰め。詳細: [`RECORD_SUMMARY_AI_PROMPTS.md`](./RECORD_SUMMARY_AI_PROMPTS.md#フィードバック-api-summaryfeedback) |
| GET | `/api/record-extractors/summary/feedback` | admin/manager のみ。保存された feedback 一覧 (新しい順) |
| GET | `/api/record-extractors/rules` | サーバが既知のフィールド/ラベル一覧 |

CPOS / cpos-record / VNS で同じ実装を共有 (in-process は `@cpos/record-
extractors` を直接 import、外部は HTTP 経由)。カスタム regex の HTTP 投入
は ReDoS リスクのため受け付けません。

### 介護保険資格確認等WEBサービス連携 — `/api/ltc-web/*`

外部 API は CPOS が一元管理。VNS/cpos-record は直接呼ばない。暫定仕様のため
mock provider でも動作 (`authMode='mock'`)。本番は Firestore + Secret Manager
必須、`:facilityId` route は facility-scoped token を検証、閲覧 API は別紙4
(サービス種別×職種×同意/閲覧期限) で制御 (閲覧不可は 403 `ltc-web-access-denied`)。
詳細: [`LTC_WEB_INTEGRATION.md`](./LTC_WEB_INTEGRATION.md)。

| メソッド | パス | スコープ | 説明 |
|---|---|---|---|
| GET/PUT | `/api/ltc-web/settings[/:facilityId]` | `ltc-web:settings:read`/`:write` | 事業所別接続設定。secret 実値・ref は応答に含めない (configured boolean のみ) |
| POST | `/api/ltc-web/settings/:facilityId/test-connection` | `ltc-web:settings:write` | 疎通確認 |
| GET | `/api/ltc-web/settings/:facilityId/health` | `ltc-web:settings:read` | 接続 health |
| POST | `/api/ltc-web/facilities/:facilityId/user-list/sync` | `ltc-web:eligibility:sync` | 利用者一覧 (WEB_IF_KST_01) を snapshot 保存。MasterUser は上書きしない |
| GET | `/api/ltc-web/facilities/:facilityId/user-list` | `ltc-web:eligibility:read` | 一覧 snapshot items |
| POST | `/api/ltc-web/facilities/:facilityId/users/:insured/:kind` | `ltc-web:eligibility:read` | 資格情報取得 (summary/certificate/burden-ratio/care-certification/review-progress 等) → LtcExternalRecord 保存 |
| GET | `/api/ltc-web/facilities/:facilityId/users/:insured/snapshots` | `ltc-web:eligibility:read` | 取得履歴 |
| POST | `/api/ltc-web/facilities/:facilityId/users/:insured/diff-master-user` | `ltc-web:eligibility:read` | 外部情報と MasterUser の差分候補生成 (反映はしない) |
| POST | `/api/ltc-web/facilities/:facilityId/users/:insured/apply-diff` | `ltc-web:eligibility:sync` | `{proposalId, acceptedFields?}` で差分を MasterUser へ反映 |
| POST/GET | `/api/ltc-web/careplan/envelopes` | `ltc-web:careplan:send`/`:read` | ケアプラン交換 envelope 作成/一覧 |
| POST | `/api/ltc-web/careplan/envelopes/:id/validate` | `ltc-web:careplan:send` | バリデーション + 正確性確認 (保険者番号・被保番・生年月日・性別) |
| POST | `/api/ltc-web/careplan/envelopes/:id/send` | `ltc-web:careplan:send` | 送信 (mock で externalDataId 発番) |
| GET | `/api/ltc-web/careplan/send-list` / `receive-list` | `ltc-web:careplan:read`/`:receive` | 送信/受信一覧 |
| POST | `/api/ltc-web/careplan/delivery-register` / `consent-register` | `ltc-web:careplan:send` | 交付用 / 同意確認用登録 |
| POST | `/api/ltc-web/careplan/receive/:externalDataId/{fetch,import-preview,import}` | `ltc-web:careplan:receive`/`:import` | 受信 → 様式別 adapter で CPOS 中間形式へ変換。import は **CareDocument draft を実作成** (`status='draft'`/`needs-review`、externalId で冪等)。`createdDocumentIds` を返す |
| GET/POST | `/api/ltc-web/access-policies[/seed]` | `ltc-web:settings:read`/`:write` | 別紙4 閲覧 policy の一覧 / 初期 seed (冪等) |
| GET | `/api/ltc-web/request-logs` | `ltc-web:audit:read` | 外部 API 呼出履歴 (個人番号・証明書・Password は記録しない) |

VNS/cpos-record 向け read facade (`/api/platform/ltc-web/*`, scope `ltc-web:eligibility:read`、facilityId query 必須):

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/platform/ltc-web/users/:insured/eligibility-summary` | 要介護度/認定有効期限/負担割合/閲覧期限を集約 |
| GET | `/api/platform/ltc-web/users/:insured/care-certification` | 認定情報 snapshot (normalized) |
| GET | `/api/platform/ltc-web/users/:insured/burden-ratio` | 負担割合 snapshot |
| GET | `/api/platform/ltc-web/users/:insured/access-grant` | 同意/閲覧期限/accessLevel |

### 旧 利用者 API (deprecated)

旧 timecare 系 `/api/patients` ルートはレガシー互換のため残置していますが、
**Drive 取込・新機能はすべて MasterUser 経由**です。新規実装では使わないでください。

### 従業員 (Employees)
`/api/employees` 同様の CRUD。

### 記録 (Records) — CRUD
| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/records?patientId=...` | 利用者別 |
| GET | `/api/records/:id` | 1 件 |
| POST | `/api/records` | 新規 |
| GET | `/api/records/:id/audit-log` | 監査ログ |

### 記録パイプライン (AI 解析・連携自動化)

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/records-pipeline/process` | 入力テキスト → AI 解析 → 利用者マッチ → Sheet 書込 + Doc 連携 |
| POST | `/api/records-pipeline/handover/preview` | 申し送り Markdown プレビュー |
| POST | `/api/records-pipeline/handover/write` | 申し送り Doc に書込 |
| POST | `/api/records-pipeline/ask` | AI 質問 (利用者/事業所) |

**`POST /process` リクエスト:**
```json
{
  "facilityId": "facility-a",
  "rawText": "山田さん昼食完食",
  "specifiedUserName": "山田 太郎",     // 省略可 (AI 解析で特定)
  "recordTypes": { "gyomu": true },   // 記録タイプフラグ
  "skipAi": false,                    // 原文モード
  "visitData": { "temp": "36.5" }     // 訪問記録データ
}
```

**レスポンス:**
```json
{
  "success": true,
  "savedCount": 1,
  "unresolvedCount": 0,
  "rawMode": false,
  "entries": [
    {
      "matchedName": "山田 太郎",
      "content": "昼食完食",
      "importance": 1,
      "saved": true,
      "location": { "sheetName": "20260424", "rowIndex": -1 },
      "message": "記録追記: 20260424 | 📄 個人記録 Doc に追記"
    }
  ],
  "meta": { "adapter": "sheets", "aiProvider": "gemini" }
}
```

**`POST /ask` リクエスト:**
```json
{ "facilityId": "facility-a", "question": "田中さんの今週の体調は？", "userName": "田中 太郎" }
```

### 事業所設定 (Facilities)

事業所マスタは下記の項目を持つ:

- `id` (CPOS 内部 ID, 一次キー)、`name` (事業所名)、`nameKana` (事業所名カナ)
- `businessNumber` (事業所番号 10 桁)、`insurerNumber` (保険者番号 6 桁)
- `postalCode` / `address` / `phone` / `fax` — 事業所連絡先
- `facilityCategoryCode` (事業所施設区分コード、CPOS 内部分類 2 桁、単一)
- `serviceTypeCodes[]` (V4 介護保険サービス種類コード、複数可)
- `users` / `records` / `handover` / `userFolders` 等の UI/連携設定

`facilityCategoryCode` と `serviceTypeCodes` のコード一覧は
`@cpos/v4-csv` の `FACILITY_CATEGORY_CODE` / `SERVICE_TYPE_CODE` を参照。
UI で `lookupFacilityCategoryName(code)` / `lookupServiceTypeName(code)`
で名称表示。1 事業所が複数サービスを提供できるため `serviceTypeCodes` は配列。

> `corporationName` (法人名) は `SystemSettings.corporation.name` に
> 移行済 (`@deprecated`)。`destinationProviderNumber` (送信先事業所番号) は
> 国保連送信ワークフローで使われていないため撤去予定。


| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/facilities` | 組織の事業所一覧 |
| GET | `/api/facilities/export.json` | 組織配下の全事業所を JSON Export 形式でダウンロード |
| POST | `/api/facilities/import.json?dryRun=true` | JSON ファイルを検証 (保存しない) |
| POST | `/api/facilities/import.json` | JSON ファイルから事業所を新規作成 / 更新 |
| GET | `/api/facilities/:id` | 1 件取得 |
| POST | `/api/facilities` | 新規 |
| PUT | `/api/facilities/:id` | 更新 |
| DELETE | `/api/facilities/:id` | 削除 |
| GET | `/api/facilities/:id/diagnose` | 列マッピング解決状況 |
| POST | `/api/facilities/:id/import-pdf?apply=false` | 利用者一覧 PDF 取込（解析のみ） |
| POST | `/api/facilities/:id/import-pdf?apply=true` | 解析 + シート書込 |

#### 事業所マスタ JSON Export 形式 (formatVersion: '1')

`GET /api/facilities/export.json` は下記構造の JSON ファイルを返す
(`Content-Disposition: attachment` 付き):

```json
{
  "formatVersion": "1",
  "exportedAt": "2026-05-03T12:00:00.000Z",
  "organizationId": "default",
  "facilities": [
    {
      "id": "facility-a",
      "name": "サンサンほーむあらかわ",
      "nameKana": "サンサンホームアラカワ",
      "businessNumber": "1234567890",
      "insurerNumber": "131140",
      "postalCode": "1140002",
      "address": "東京都北区王子3-23-7",
      "phone": "03-1234-5678",
      "fax": "03-1234-5679",
      "facilityCategoryCode": "25",
      "facilityCategoryName": "小規模多機能型居宅介護事業所",
      "serviceTypeCodes": ["73", "68"],
      "serviceTypeNames": ["小規模多機能", "小規模多機能(短期)"],
      "timeZone": "Asia/Tokyo",
      "facilityNamePrefix": null,
      "isActive": true
    }
  ]
}
```

- `formatVersion` … スキーマバージョン (現行 `'1'`)。Import 側は完全一致を要求
- `facilityCategoryName` / `serviceTypeNames` … **派生フィールド** (Export
  時のみ補助情報として埋まる、Import 時は無視される)
- 入力する場合は `id` / `name` のみ必須。他は省略可

`POST /api/facilities/import.json` は上記構造の本文を受け、`id` をキーに
既存事業所を更新 / 無ければ新規作成。`users` / `records` / `handover` 等の
UI 設定は **Export に含めていないため既存値が保持される** (誤って空に
ならない)。`?dryRun=true` で検証のみ。

レスポンス:
```json
{
  "total": 5, "created": 2, "updated": 3,
  "errors": [], "warnings": [], "dryRun": false
}
```

詳細は `@cpos/records/src/facility-import-export.ts` のスキーマと
`API_REFERENCE.md` の `FacilityExportFile` 型を参照。

詳細: [RECORDS.md](./RECORDS.md), [CONNECTORS.md](./CONNECTORS.md)

### ケアプラン書類自動整理 (Filing)

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/filing/analyze` | 1 PDF を AI 解析してプラン返却 |
| POST | `/api/filing/apply` | 1 PDF のプランを Drive に適用 |
| POST | `/api/filing/analyze-batch` | 複数 PDF をまとめて解析 |
| POST | `/api/filing/apply-batch` | 複数 PDF をまとめて適用 |

詳細: [FILING.md](./FILING.md)

### システム設定 (SystemSettings)

組織共通設定 (Firestore `cpos_system_settings/global`)。

| メソッド | パス | 必要ロール | 説明 |
|---------|------|-----------|------|
| GET | `/api/system-settings` | manager+ | 全件 |
| GET/PUT | `/api/system-settings/filing` | manager+ | AutoFiler 設定 |
| GET/PUT | `/api/system-settings/user-folders` | manager+ | 利用者フォルダルート (システム共通) |
| GET/PUT | `/api/system-settings/personal-doc` | manager+ | 個人記録 Doc 設定 |
| GET/PUT | `/api/system-settings/important-matters-doc` | manager+ | 重要事項 Doc 設定 |
| GET/PUT | `/api/system-settings/care-plan` | manager+ | ケアプラン作成支援設定 (defaultMode / aiModel / numProposals / generationPrompt / modePrompts / knowledgeBase / exportTemplateSpreadsheetIdKyotaku/Shoki) |
| GET/PUT | `/api/system-settings/corporation` | manager+ | 法人 (= 事業者) 設定 (name / corporationNumber 13桁 / representativeName / headOfficeAddress / representativePhone)。本システムは 1 法人運営前提のためシステム共通。事業所番号やサービス種別コードは事業所ごとなので含まない |
| GET/PUT | `/api/system-settings/record-summary` | manager+ | 記録要約 (AI) provider/モデル既定。`{provider, defaultModel, allowedModels, temperature, maxOutputTokens, defaultPromptVersion}`。空フィールドは env 既定を使う。PUT は provider をその場で再構築 (再起動不要)。GEMINI_API_KEY 不在なら local fallback (`applied/reason` を返す)。GET は `diagnostics` (apiKeyPresent / appliedProvider / deprecatedModels / usingFallback) と `recommendedPreset` (Gemini 3 系の推奨デフォルト) も返す。詳細: [`RECORD_SUMMARY_AI_PROMPTS.md`](./RECORD_SUMMARY_AI_PROMPTS.md#組織既定-systemsettingsrecordsummary) |
| GET | `/api/system-settings/secrets-status` | manager+ | シークレット (環境変数) の設定状況 |

### プロンプト (Prompts)

| メソッド | パス | 必要ロール | 説明 |
|---------|------|-----------|------|
| GET | `/api/prompts?category=&activeOnly=&facilityId=` | staff+ | プロンプト一覧。`facilityId` 指定時は事業所固有 + 上書きされてない全社共通 + built-in を統合表示 |
| GET | `/api/prompts/:id` | staff+ | 1 件取得 (リポジトリ優先、無ければ built-in) |
| PUT | `/api/prompts/:id` | manager+ | 内容更新 (version 自動インクリメント) |
| POST | `/api/prompts` | manager+ | 新規プロンプト作成 |
| DELETE | `/api/prompts/:id` | manager+ | 削除 (built-in 不可) |
| POST | `/api/prompts/:id/preview` | staff+ | 変数展開プレビュー (`{ variables }`) |
| POST | `/api/prompts/:id/override-for-facility` | manager+ | 全社共通プロンプトを事業所固有にコピー上書き (`{ facilityId, content }`)。新レコード id=`<id>__<facilityId>`、`baseTemplateId=<id>`、`facilityId=<facilityId>` で保存 |

### 利用者詳細 (統合ビュー)

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/user-detail?facilityId=&userName=` | マスタ + 記録 + 重要事項 + ケアプラン JSON を集約 |

### Platform read facade (`/api/platform/*`、Cookie / Bearer 両対応)

VNS など外部アプリから Bearer s2s で利用者マスタ・事業所設定を引くための
read-only ファサード。既存 `/api/master-users` `/api/facilities` は管理 UI
専用 (Cookie session 必須) のまま。

| メソッド | パス | session permission | API scope | 説明 |
|---------|------|---|---|---|
| GET | `/api/platform/master-users?facilityId=&query=&activeOnly=&limit=` | `master-users:read` | `master-users:read` | 利用者マスタ検索 (facilityId 指定で事業所スコープ) |
| GET | `/api/platform/master-users/:insuredNumber?facilityId=` | `master-users:read` | `master-users:read` | 利用者マスタ単一 (facilityId 指定で assignment 確認) |
| GET | `/api/platform/facilities` | `facilities:read` | `facilities:read` | 事業所一覧 (token の allowedFacilityIds で自動絞込) |
| GET | `/api/platform/facilities/:id` | `facilities:read` | `facilities:read` | 事業所単一 |
| GET | `/api/platform/facility-staff?facilityId=&activeOnly=&q=&profession=&limit=` | `facility-staff:read` | `facility-staff:read` | 事業所スタッフ SoT (read facade)。詳細: [`FACILITY_STAFF.md`](./FACILITY_STAFF.md) / [`FACILITY_STAFF_API.md`](./FACILITY_STAFF_API.md) |

API token の `allowedFacilityIds` 制限と `organizationId` 一致は
`authorizePlatformRequest()` で自動検証。

### 事業所別 利用者データ (Cookie / Bearer 両対応)

詳細は [`docs/FACILITY_USERS.md`](./FACILITY_USERS.md) 参照。
API token 経路では `allowedFacilityIds` による事業所スコープ制限あり。

| メソッド | パス | session permission | API scope | 説明 |
|---------|------|---|---|---|
| GET | `/api/facilities/:facilityId/users` | `facility-users:read` | `facility-users:read` | 利用者一覧 (master + assignment + extras merge) |
| GET | `/api/facilities/:facilityId/users/extras-schema` | `facility-users:read` | `facility-users:schema:read` | 事業所固有項目スキーマ |
| PUT | `/api/facilities/:facilityId/users/extras-schema` | `facility-users:write` | `facility-users:schema:write` | スキーマ更新 |
| GET | `/api/facilities/:facilityId/users/:insuredNumber/extras` | `facility-users:read` | `facility-users:read` | 利用者の追加項目 |
| PUT | `/api/facilities/:facilityId/users/:insuredNumber/extras` | `facility-users:write` | `facility-users:write` | 追加項目更新 |
| POST | `/api/facilities/:facilityId/users/import-csv` | `facility-users:write` | `facility-users:import` | CSV 取込 (マスタ吸い上げ + extras 振り分け) |
| POST | `/api/facilities/:facilityId/users` | `facility-users:write` | `facility-users:write` | 既存マスタ追加 / 新規 (tmp) 作成 |
| GET | `/api/facilities/:facilityId/users/export.csv` | `facility-users:read` | `facility-users:export` | CSV エクスポート (BOM 付き) |

### 受付フォーム (Cookie / Bearer 両対応)

紙帳票型の受付シートで新規利用者を受付。詳細は
[`docs/INTAKE_FORMS.md`](./INTAKE_FORMS.md) 参照。

| メソッド | パス | session permission | API scope | 説明 |
|---------|------|---|---|---|
| GET | `/api/form-templates?purpose=intake&facilityId=&isActive=true` | `form-templates:read` | `form-templates:read` | テンプレ一覧 |
| GET | `/api/form-templates/:id` | `form-templates:read` | `form-templates:read` | テンプレ詳細 |
| POST | `/api/form-templates` | `form-templates:write` | `form-templates:write` | テンプレ新規 |
| PUT | `/api/form-templates/:id` | `form-templates:write` | `form-templates:write` | テンプレ更新 |
| DELETE | `/api/form-templates/:id` | `form-templates:delete` | `form-templates:delete` | テンプレ削除 |
| POST | `/api/form-templates/:id/clone` | `form-templates:write` | `form-templates:write` | テンプレ複製 |
| GET | `/api/facilities/:facilityId/intakes/prefill?templateId=&insuredNumber=` | `facility-intakes:read` | `facility-intakes:read` | 既存利用者から取込み: MasterUser + FacilityUserExtras を template.fields[*].target に従って `values` に反映 (intake target は対象外) |
| GET | `/api/facilities/:facilityId/intakes?status=&from=&to=&query=` | `facility-intakes:read` | `facility-intakes:read` | 受付一覧 |
| GET | `/api/facilities/:facilityId/intakes/:id` | `facility-intakes:read` | `facility-intakes:read` | 受付詳細 |
| POST | `/api/facilities/:facilityId/intakes` | `facility-intakes:write` | `facility-intakes:write` | 新規受付 |
| PUT | `/api/facilities/:facilityId/intakes/:id` | `facility-intakes:write` | `facility-intakes:write` | 受付更新 |
| POST | `/api/facilities/:facilityId/intakes/:id/submit` | `facility-intakes:write` | `facility-intakes:write` | draft → received |
| POST | `/api/facilities/:facilityId/intakes/:id/reject` | `facility-intakes:write` | `facility-intakes:write` | 見送り |
| POST | `/api/facilities/:facilityId/intakes/:id/convert-to-master-user` | `facility-intakes:write` | `facility-intakes:write` | 利用者化 (新規 tmp or 既存 merge) |
| POST | `/api/facilities/:facilityId/intakes/:id/transfer` | `facility-intakes:write` (admin/manager) | 同左 | 受付移管 (誤事業所修正)。body `{toFacilityId, reason?}`。converted/rejected は 409、サービス種別不一致は 403 |
| POST | `/api/facilities/:facilityId/intakes/transfer-bulk` | `facility-intakes:write` (admin/manager) | 同左 | 一括移管 `{toFacilityId, ids[], reason?}`。部分成功は 207 |
| POST | `/api/facilities/:facilityId/intakes/:id/transfer-converted` | `facility-intakes:write` (admin) | 同左 | converted 受付の移管 (assignment 無効化/再作成 + extras マージ) |
| DELETE | `/api/facilities/:facilityId/intakes/:id` | `facility-intakes:delete` | `facility-intakes:delete` | 受付削除 |

受付移管の詳細 (request/response/エラー) は
[`docs/INTAKE_FORMS.md`](./INTAKE_FORMS.md) §2.4 を参照。
`FormTemplate.allowedServiceTypeCodes` を設定すると、組織共通テンプレ
でも指定サービス種別 (例 `['13']` = 訪問看護) の事業所でのみ利用可。

### アプリ公開ワークフロー

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/apps` | 閲覧可能なアプリ一覧 (privileged は全件、それ以外は published のみ) |
| GET | `/api/apps/launcher` | **ログインユーザーが利用可能な公開済アプリ** (`evaluateAppAccess` ベースで判定。Dashboard 「利用可能なアプリ」で使用) |
| GET | `/api/apps/:id` | 1 件 |
| POST | `/api/apps` | 下書き作成 (app-publisher capability) |
| PUT | `/api/apps/:id` | 編集 (name / description / type / `url` / `manifestPath` / `isPublic` / `requiredPermissions` / `resources`)。draft/rejected は申請者本人 or admin、それ以外は admin / app-publisher |
| POST | `/api/apps/:id/submit` | レビュー申請 |
| POST | `/api/apps/:id/approve` | 承認 (admin) |
| POST | `/api/apps/:id/reject` | 差戻し (admin) |
| POST | `/api/apps/:id/publish` | 公開 (admin) |
| POST | `/api/apps/:id/unpublish` | 公開停止 |
| POST | `/api/apps/:id/archive` | アーカイブ |
| GET | `/api/apps/:id/actions` | 現在 actor が実行可能なアクション |
| DELETE | `/api/apps/:id` | draft 削除 |
| GET | `/api/apps/:id/scopes` | `requiredPermissions` から API token scope を生成 (`'resource:action'[]`、AppsPage / AppTokens UI でコピー用) |
| POST | `/api/apps/:id/import-manifest?dryRun=true\|false` | Manifest URL を fetch → 検証 → 反映 (本番 https のみ、`${VNS_PUBLIC_URL}` 等を origin で解決、dryRun=true で diff preview のみ)。body: `{ manifestUrl }` (省略時は `app.manifestPath` または `app.url + /cpos.manifest.json` を使用) |
| GET | `/api/apps/:id/access` | アプリ利用権限 (AppAccessGrant) 一覧 + isPublic フラグ |
| POST | `/api/apps/:id/access` | grant 追加 (admin / app-publisher、重複 409)。body: `{ subjectType: 'user'\|'role'\|'group'\|'facility', subjectId, note? }` |
| DELETE | `/api/apps/:id/access/:grantId` | grant 削除 (admin / app-publisher) |

> `subjectType='group'` の grant は launcher では当面評価しない (User.groupIds が
> AuthSession に載っていないため)。AppsPage 上で表示・管理は可能。
> 評価ロジックの詳細は `docs/ARCHITECTURE.md` の「アプリ登録機構」を参照。

### Sheets 連携 (VNS 互換 / sheet-sync)

SheetMapping CRUD と双方向 sync。canonical は `/api/apps/:appId/*`、VNS
互換層は `/api/integrations/google-sheets/*`。詳細は
[`SHEETS_SYNC.md`](./SHEETS_SYNC.md)。

> CPOS 実装注: `/api/apps/:appId/sheet-*` は appsWorkflowRouter
> (`/api/apps`) より前に mount すること。後だと
> `Unknown action: sheet-mappings` になる (route order bug)。

| メソッド | パス | 説明 |
|---------|------|------|
| GET/POST | `/api/apps/:appId/sheet-mappings` | mapping 一覧 / 作成。作成時、同一キー (org/appId/facilityId/spreadsheetId/sheetName/direction/target) は 409 `duplicate_mapping` (`existingId` 付き) |
| PUT/DELETE | `/api/apps/:appId/sheet-mappings/:id` | 更新 (更新後内容が他と重複なら 409 `duplicate_mapping`、自己再保存は許可) / 削除 |
| POST | `/api/apps/:appId/sheet-sync/run` | 同期実行 (下記) |
| GET | `/api/apps/:appId/sheet-sync/jobs[/:id]` | job 一覧 / 1 件 |
| GET | `/api/integrations/google-sheets/status?appId=&facilityId=&probe=true[&probeMode=all]` | 接続診断 (下記)。`probeMode=all` で全 mapping を probe し `probeResults[]` を返す |
| POST | `/api/integrations/google-sheets/{export,import}` | run への薄い互換転送 (`dryRun`=`preview`) |

`GET /status` response:

```jsonc
{
  "connected": false,
  "spreadsheetId": "...|null",
  "lastSyncedAt": "...|null",
  "mappingsCount": 3,
  "importMappingsCount": 1,   // direction が import または both
  "exportMappingsCount": 2,   // direction が export または both
  "hasAccessToken": true,
  "connectorAvailable": true,
  "spreadsheetReachable": true,  // probe=true 時のみ。未probe は null
  "spreadsheetError": null,
  "probed": true,
  "notImplemented": false,
  "reason": "...|null",
  "reasonCode": "no_mappings | no_direction_mappings | duplicate_mapping | connector_unavailable | null"
}
```

`POST .../sheet-sync/run` (body `{ direction:'import'|'export', preview?,
facilityId? }`) response envelope:

```jsonc
{
  "ok": true,                  // job.status === 'succeeded'
  "jobId": "sj_...",
  "status": "succeeded|failed|running|queued",
  "imported": 0,
  "exported": 0,
  "errors": [],
  "warnings": [],              // source_hub skip 等 (job は failed にしない)
  "preview": false,
  "job": { /* SheetSyncJob 全体 */ }
}
```

- direction に合う mapping だけ実行 (`import`→import/both,
  `export`→export/both)。合うものが 0 件なら 409
  `reasonCode=no_direction_mappings` (`mappingsCount` 付き)。
- mapping が 1 件も無ければ 409 `reasonCode=no_mappings`。
- `source_hub` target は実行対象外。skip して `warnings[]` に明示。
- connector 不在 (accessToken なし等) の apply は 503
  `reasonCode=connector_unavailable`。

### API トークン管理 (admin / manager のみ)

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/api-tokens?appId=&includeRevoked=` | トークン一覧 |
| POST | `/api/api-tokens` | 新規発行 (平文は 1 度だけ返却) |
| POST | `/api/api-tokens/:id/revoke` | 失効 |
| DELETE | `/api/api-tokens/:id` | 削除 |
| GET | `/api/api-tokens/:id/usage` | トークンの日次・パス別使用量 |
| GET | `/api/api-tokens/usage-summary` | 全トークンの使用量サマリ |
| GET | `/api/api-tokens/releases/:appId` | Android リリース一覧 |
| POST | `/api/api-tokens/releases` | リリース登録 |
| DELETE | `/api/api-tokens/releases/:appId/:versionCode` | 削除 |

**発行リクエスト:**
```json
{
  "appId": "app-tanaka-android",
  "name": "田中さん Android (Pixel 8)",
  "scopes": ["users:read", "patients:read", "records:write", "ask-ai"],
  "allowedFacilityIds": ["facility-a"],
  "expiresAt": "2027-04-24T00:00:00.000Z"
}
```

**発行レスポンス:**
```json
{
  "record": {
    "id": "tok_abc...",
    "appId": "app-tanaka-android",
    "tokenPreview": "cpos_pat_abcdef…wxyz",
    "scopes": ["..."],
    ...
  },
  "plaintext": "cpos_pat_<64-chars-base64url>"  // ★ 1 度だけ返却
}
```

### トリガー (Cloud Scheduler 用)

| メソッド | パス | 認証 | 説明 |
|---------|------|------|------|
| POST | `/api/triggers/handover` | `X-Cpos-Trigger-Secret` ヘッダ | 申し送り自動生成 |

### 監査ログ (admin / manager)

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/audit-logs?eventType=&actorId=&since=&limit=` | 監査イベント取得 (組織スコープ) |

監査されるイベント種別:
- `session.login` / `session.logout`
- `api-tokens.issue` / `api-tokens.revoke` / `api-tokens.delete`
- `records.pipeline.process` / `records.handover.write` / `records.handover.trigger`
- `filing.analyze` / `filing.apply`
- `facilities.save` / `facilities.delete` / `facilities.import-pdf`
- `app.workflow.transition` / `user.provisioned`
- `device.records.write` / `device.ask`

`AUDIT_STORE=firestore` で `cpos_audit_logs` コレクションへ永続化、
`memory` (既定) ならプロセス内 1000 件保持。

### テスト (開発用、認証不要)

`/api/test/...` は `/api/...` と同じ構造のフィクスチャエンドポイントを提供。
詳細はテストダッシュボード `/test` で確認。

---

## 端末 API (Android)

すべて `Authorization: Bearer cpos_pat_...` が必要。

### 共通ヘッダ

```
Authorization: Bearer cpos_pat_<token>
Content-Type: application/json
Accept: application/json
```

### 疎通・起動時情報

| メソッド | パス | 必要スコープ | 説明 |
|---------|------|------------|------|
| GET | `/api/device/ping` | （任意の有効トークン） | 疎通確認 + トークン情報 |
| GET | `/api/device/bootstrap` | `*` | 事業所一覧 + トークン情報 + サーバ時刻 |
| GET | `/api/device/facilities` | `*` | アクセス可能な事業所一覧 |
| GET | `/api/device/users` | `users:read` | 利用者マスタ一覧（FacilityAdapter 経由） |
| GET | `/api/device/releases/latest?appId=&currentVersionCode=` | - | 最新 Android リリース + 更新要否判定 |
| GET | `/api/device/releases?appId=` | - | リリース履歴 (最大 20 件) |

### 記録操作 (Bearer トークン + スコープ)

| メソッド | パス | 必要スコープ | 説明 |
|---------|------|------------|------|
| GET | `/api/device/records?facilityId=&userName=&since=&until=` | `records:read` | 利用者別 or 当日記録 |
| POST | `/api/device/records` | `records:write` | 記録を直接追記 (AI を使わない) |
| POST | `/api/device/records/process` | `records:write` | AI 解析付き記録パイプライン |
| GET | `/api/device/records/updates?since=&limit=` | `records:read` | 差分同期。指定時刻以降の記録を返す |
| POST | `/api/device/ask` | `ask-ai` | AI 質問 (利用者/事業所) |

### CPOS ネイティブ介護記録 (CareRecord) — `/api/device/records/*`

旧 Small-scale GAS リプレースのネイティブ実装。記録の正は CPOS DB
(`cpos_care_records`)。Spreadsheet ミラー出力は副次的で、CPOS 経由の記録は
records sink 設定に関係なく必ず CareRecord に保存される
(`apps/admin/src/server/care-records/native-adapter.test.ts` で保証)。

| メソッド | パス | 必要スコープ | 説明 |
|---------|------|------------|------|
| GET | `/api/device/records/bootstrap` | `care-records:read` | 利用者 + recordTypes + visitTemplate + configVersion |
| GET | `/api/device/records?facilityId=&insuredNumber=&filter=today\|yesterday\|week&since=` | `care-records:read` | 一覧 |
| GET | `/api/device/records/all?filter=` | `care-records:read` | 全件 (期間フィルタ可) |
| GET | `/api/device/records/updates?since=ISO` | `care-records:read` | 差分同期 |
| POST | `/api/device/records` | `care-records:write` | 新規 (clientOpId 冪等性) |
| POST | `/api/device/records/process` | `care-records:write` | AI 解析パイプライン (NativeFacilityAdapter 経由)、AI 不可時は raw fallback |
| **PUT** | `/api/device/records/:id` | `care-records:write` | **フル編集** (content / importance / recordTypes / recorderName)。`propagateToTimeline=true` (default) かつ insuredNumber あり → 利用者 Doc に「[編集 ...]」追記 (失敗時は `timelineWarning`) |
| PATCH | `/api/device/records/:id/flags` | `care-records:write` | recordType フラグ更新 |
| PATCH | `/api/device/records/:id/importance` | `care-records:write` | 重要度 0-5 |
| POST | `/api/device/records/batch-sync` | `care-records:sync` | オフライン蓄積 op をまとめて送信 |
| POST | `/api/device/records/import-from-app-data` | `care-records:write` | VNS 等の AppData 訪問記録を CareRecord に一括取り込む (backfill)。`{submittedOnly?}`。冪等。新規 submit は listener で自動ミラーされるが、既存データはこれで取り込む。詳細: [`CARE_RECORDS.md`](./CARE_RECORDS.md#vns-訪問記録--carerecord-ミラー-app-data-mirror) |
| POST | `/api/device/records/migrate-from-app-data` | `care-records:write` | 訪問記録を CareRecord に一本化する安全マイグレーション。`{dryRun?}` (既定 true)。非破壊 (AppData 保持)・冪等・native 記録保護。lifecycle (recordStatus/submittedAt/voidedAt) も反映。詳細: [`CARE_RECORDS.md`](./CARE_RECORDS.md#単一ソース化へのマイグレーション-進行中) |
| GET | `/api/device/records/migrate-from-app-data/verify` | `care-records:read` | AppData 訪問記録と CareRecord ミラーの一致を検証 (非破壊)。`{appDataCount, presentInCareRecord, missing[], statusMismatch[]}` |
| GET | `/api/device/records/record-types` | `care-records:read` | 記録タイプ一覧 |
| GET | `/api/device/records/visit-record-fields` | `care-records:read` | 訪問記録テンプレート |
| GET | `/api/device/records/users` | `care-records:read` | 利用者一覧 (master + assignment) |
| GET | `/api/device/records/users/:insured/info` | `care-records:read` | 利用者情報 |
| PUT | `/api/device/records/users/:insured/info` | `care-records:write` | 利用者情報更新 |
| GET | `/api/device/records/users/info/all` | `care-records:read` | 全利用者情報 |
| GET | `/api/device/records/users/:insured/important-matters` | `care-records:important:read` | 重要事項一覧 |
| POST | `/api/device/records/users/:insured/important-matters` | `care-records:important:write` | 重要事項追記 |
| POST | `/api/device/records/photos` | `care-records:photo:write` | 写真添付 (GCS upload + signed URL) |
| POST | `/api/device/records/ask` | `care-records:ask-ai` | AI 質問 (利用者/事業所) |
| POST | `/api/device/records/gas-compatible/run` | `care-records:write` | GAS 互換 dispatch (`{ functionName, parameters[] }` を REST handler へ案内) |
| GET | `/api/device/records/ping` | (任意) | 疎通 |

### 利用者ごとの記録タイムライン (UserRecordTimelineProvider 経由)

利用者情報ページ右側の「利用者ごとの記録」は env `USER_RECORD_TIMELINE_SOURCE`
で provider を切替え (`google-docs` default / `care-records` / `hybrid`)。
詳細: `docs/CARE_RECORDS.md`、`docs/DEPLOY.md`「利用者ごとの記録タイムライン」。

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/user-detail/:insuredNumber/record-timeline?facilityId=&limit=&cursor=` | タイムライン取得。Soft エラー (api-disabled / unconfigured / permission-error / not-found) は HTTP 200 + `sourceStatus` で返却し、UI に `help.command` (gcloud) と詳細エラー折りたたみを表示 |
| POST | `/api/user-detail/:insuredNumber/record-timeline` | 追記。`google-docs` primary 中は Doc 追記失敗を成功扱いにしない (sourceStatus に応じて 503/403/404/502) |
| GET | `/api/connectors/google/status` | Drive/Docs/Sheets API の有効化状態を実呼出で診断 (運用者向け self-check) |

### 事業所モジュール (業務日誌・週間予定表・入浴予定表)

CPOS native ネイティブモジュール。`FacilityConfig.modules` で ON/OFF。
詳細: `docs/CARE_RECORDS.md`、`CHANGELOG.md` Phase 4 エントリ。

| メソッド | パス | 必要スコープ | 説明 |
|---------|------|------------|------|
| GET | `/api/facilities/:facilityId/modules` | `facility-modules:read` | モジュール ON/OFF + 設定 |
| PUT | `/api/facilities/:facilityId/modules` | `facility-modules:write` | モジュール設定更新 (admin / manager) |
| GET | `/api/facilities/:facilityId/business-diary?from=&to=` | `facility-modules:read` | 業務日誌一覧 |
| GET | `/api/facilities/:facilityId/business-diary/:date` | `facility-modules:read` | 単日 (YYYY-MM-DD)。未作成は空テンプレ + `exists:false` |
| PUT | `/api/facilities/:facilityId/business-diary/:date` | `facility-modules:write` | upsert (確定済 finalizedAt は 409) |
| POST | `/api/facilities/:facilityId/business-diary/:date/finalize` | `facility-modules:write` | 確定 |
| DELETE | `/api/facilities/:facilityId/business-diary/:date` | `facility-modules:write` | 論理削除 |
| GET/PUT/POST/DELETE | `/api/facilities/:facilityId/weekly-schedule/:weekStart` | `facility-modules:*` | 週間予定表 (月曜 YYYY-MM-DD) |
| GET/PUT/DELETE | `/api/facilities/:facilityId/bath-schedule/:weekStart` | `facility-modules:*` | 入浴予定表 |

### 旧 Spreadsheet → CPOS 一括取込

| メソッド | パス | 必要スコープ | 説明 |
|---------|------|------------|------|
| POST | `/api/facilities/:facilityId/spreadsheet-import` | `spreadsheet-import:write` | xlsx (base64) を取込み master-users + CareRecord 化。`legacySource.rowHash` で重複検出する差分インポート (再取込で skipped にカウント、二重作成しない)。body: `{ fileBase64, dryRun?, targets?: ('users'\|'care-records')[] }` |

### 旧 GAS Spreadsheet 段階移行 (`/api/legacy-records/v1/*`)

旧 GAS 記録から CPOS DB への段階移行 API (admin / manager セッション、Google
OAuth トークン経由)。詳細は
[`CARE_RECORDS_MIGRATION_FROM_GAS.md`](./CARE_RECORDS_MIGRATION_FROM_GAS.md)。

| メソッド | パス | 用途 |
|---------|------|------|
| GET / PUT | `/api/legacy-records/v1/facilities/:facilityId/config` | 事業所単位の `FacilityRecordMigrationConfig` (mode / spreadsheetId / sheets / mirror / cutover / safety) |
| POST | `/api/legacy-records/v1/facilities/:facilityId/diagnose` | 試行 1 シート読込で列マッピング検証 |
| POST | `/api/legacy-records/v1/facilities/:facilityId/sync` | `dry-run` / `apply` で範囲同期。body: `{ from, to, mode, targets? }` |
| GET | `/api/legacy-records/v1/facilities/:facilityId/runs` | 同期実行履歴 |
| GET | `/api/legacy-records/v1/facilities/:facilityId/diff?from=&to=` | Sheets vs DB 差分集計 (`canCutover` / `blockers` 含む) |
| POST | `/api/legacy-records/v1/facilities/:facilityId/cutover/check` | cutover 可否判定 |
| POST | `/api/legacy-records/v1/facilities/:facilityId/cutover/final-sync` | apply で完全 mirror |
| POST | `/api/legacy-records/v1/facilities/:facilityId/cutover/complete` | mode = `care-records-primary`、`canCutover` 必須 (force でスキップ可) |
| POST | `/api/legacy-records/v1/facilities/:facilityId/cutover/rollback` | mode = `sheets-primary` に戻す |
| POST | `/api/legacy-records/v1/facilities/:facilityId/cutover/archive` | mode = `archive-readonly` |
| POST | `/api/legacy-records/v1/facilities/:facilityId/write` | 移行モードに沿った 1 件記録作成 (Sheets append / DB mirror) |
| GET | `/api/legacy-records/v1/facilities/:facilityId/records?from=&to=&forceDb=` | merged read facade (Sheets ⊕ DB) |
| GET | `/api/legacy-records/v1/facilities/:facilityId/warnings?status=&kind=` | 同期 / 書込 warning |
| POST | `/api/legacy-records/v1/facilities/:facilityId/warnings/:id/resolve` | warning を resolve |

### 動作モード (端末 API)

端末 API は OAuth セッションを持たないため、Google Sheets / Drive / Docs の実書込は
**サービスアカウント or bot refresh token** に依存します。現状は以下の挙動:

- **`GEMINI_API_KEY` あり**: AI 解析は動作
- **OAuth アクセストークン なし**: `MemoryFacilityAdapter` にフォールバック
  → 書込内容はインメモリで保持されるが永続化されない
- 永続化を行うには `HANDOVER_BOT_REFRESH_TOKEN` 等の仕組みを拡張する必要あり（今後対応）

### 差分同期の仕様

```
GET /api/device/records/updates?facilityId=f1&since=2026-04-24T00:00:00Z&limit=200
→ {
  ok: true,
  records: [...],   // since 以降の記録
  asOf: "...",      // 次回 since に渡すタイムスタンプ
  meta: { adapter: "sheets" | "memory" }
}
```

クライアントは `asOf` を次回呼出しの `since` に使うことで増分同期できます。
現在の実装は当日〜過去 7 日分のシートを走査する簡易版。

**`GET /bootstrap` レスポンス:**
```json
{
  "ok": true,
  "token": {
    "id": "tok_abc...",
    "appId": "app-tanaka-android",
    "name": "田中さん Android",
    "scopes": ["users:read", "records:write"],
    "organizationId": "careplanning-473201",
    "allowedFacilityIds": ["facility-a"],
    "expiresAt": null
  },
  "facilities": [
    { "id": "facility-a", "name": "ケアハウス A", "timeZone": "Asia/Tokyo" }
  ],
  "serverTime": "2026-04-24T10:30:00.000Z"
}
```

### Kotlin クライアントのサンプル

```kotlin
val token = "cpos_pat_..."
val client = OkHttpClient()
val req = Request.Builder()
  .url("https://os.care-planning.co.jp/api/device/bootstrap")
  .header("Authorization", "Bearer $token")
  .build()
val resp = client.newCall(req).execute()
```

---

## スコープ一覧

| スコープ | 説明 |
|---------|------|
| `*` | 全権 (管理者トークン相当) |
| `users:read` | 利用者マスタ読取 |
| `patients:read` / `patients:write` | 利用者 CRUD |
| `records:read` / `records:write` | 記録 CRUD + パイプライン |
| `careplans:read` | ケアプラン JSON 読取 |
| `vitals:read` / `vitals:write` | バイタル |
| `handover:read` / `handover:write` | 申し送り |
| `ask-ai` | AI 質問 |
| `filing:read` / `filing:write` | ケアプラン書類整理 |
| `care-records:read` / `:write` / `:sync` | CPOS native 介護記録 (CareRecord) |
| `care-records:important:read` / `:write` | 重要事項 |
| `care-records:photo:write` | 写真添付 |
| `care-records:ask-ai` | 介護記録 AI 質問 |
| `facility-modules:read` / `:write` | 業務日誌・週間予定表・入浴予定表 (FacilityConfig.modules) |
| `spreadsheet-import:write` | 旧 Spreadsheet → CPOS 一括取込 |
| `facility-intakes:read` / `:write` / `:delete` | 受付フォーム (FacilityIntakeRecord) |
| `form-templates:read` / `:write` / `:delete` | 受付シート (FormTemplate) |
| `app-data:<appId>:read` / `:write` | 汎用 App Platform 業務データ |
| `apps:<appId>:ai:run` | App Platform AI 呼出 |
| `pdf:render:write` | PDF 描画 |
| `alerts:read` / `:write` | App Platform アラート |
| `master-users:read` | 利用者マスタ (Platform read facade) |
| `facilities:read` | 事業所一覧 (Platform read facade) |
| `facility-staff:read` / `:write` / `:delete` | 事業所スタッフ SoT。`:read` で `/api/platform/facility-staff` 取得 |
| `care-documents:read` / `:write` / `:approve` / `:delete` / `:ai` | 業務ドキュメント |
| `care-schedules:read` / `:write` / `:delete` | サービス予定 (横断)。`:write` で create/update/cancel/reactivate/migrate。`:read` で check-conflicts プレビュー |
| `care-schedule-exceptions:read` / `:write` / `:delete` | サービス予定の例外日 (cancel/skip/reschedule/time-change/staff-change/extra/note) |
| `care-service-actuals:read` / `:write` / `:approve` / `:delete` | サービス実績 (中間層、請求候補の根拠) |
| `care-claim-candidates:read` / `:write` / `:delete` | 請求候補 (実績+マスタ→月次ドラフト) |
| `service-code-master:read` / `:write` / `:delete` | サービスコードマスタ (時点版) |
| `record-extractors:read` | 記録抽出器 (本文→バイタル等) |

> アプリ単位の **必要 scope** は `AppRegistration.requiredPermissions` から
> `permissionToScopes()` で `'resource:action'` 形式に展開されます。AppsPage の
> 「📋 コピー」または `GET /api/apps/:id/scopes` で取得可能。
>
> **VNS 本番デプロイ前に必要な App Token スコープ束** (`/app-tokens` GUI で
> 付与。s2s で訪問予定 / 記録 / 業務ドキュメント / 請求候補 連携を行う
> 場合の最小集合):
>
> ```text
> care-schedules:read
> care-schedules:write
> care-schedule-exceptions:read
> care-schedule-exceptions:write
> app-data:vns:read
> app-data:vns:write
> care-service-actuals:read
> care-claim-candidates:read
> record-extractors:read
> care-documents:read
> care-documents:write
> facility-staff:read
> ```
>
> 加えて連携用途に応じて: `apps:vns:ai:run` (AI フォーマット呼出) /
> `pdf:render:write` (PDF 描画) / `alerts:read,alerts:write` /
> `master-users:read,facilities:read`。
>
> **以下は通常運用では不要** — バックオフィス専用なので業務アプリの
> App Token に付与しないでください:
>
> - `care-schedules:delete` (取消は `/:id/cancel`、復活は `/:id/reactivate`)
> - `care-schedule-exceptions:delete` (例外は `POST /:id/void` で履歴を残す)
> - `care-service-actuals:delete` / `care-service-actuals:approve`
>   (承認はバックオフィス権限、`void` は `:write` で可)
> - `care-claim-candidates:write` / `:delete` (生成・確定は管理者作業)
> - `service-code-master:write` / `:delete` (改定対応は管理者作業)
> - `facility-staff:write` / `facility-staff:delete` (スタッフ CRUD は
>   CPOS 管理者作業、業務アプリは read のみ)
>
> 事業所横断アクセスを許可するなら `allowedFacilityIds` を未設定/空に、
> 特定事業所に絞るなら `allowedFacilityIds: ['fac1', ...]` を指定する。
> 後者の場合 care-schedules の各エンドポイントは `facilityId` 必須
> (未指定は 400 `facility-id-required`、ミスマッチは 403)。

トークンは複数スコープを同時に持てます。`*` は全権なので単体で付与するだけで足ります。

---

## エラー形式

標準レスポンス:
```json
{
  "error": "メッセージ",
  "code": "FORBIDDEN"  // 任意
}
```

### HTTP ステータス

| コード | 意味 |
|--------|------|
| 200 | OK |
| 201 | 作成成功 |
| 204 | 削除成功 (body なし) |
| 400 | リクエスト不正 |
| 401 | 認証なし |
| 403 | 権限なし / スコープ不足 |
| 404 | 対象が見つからない |
| 409 | 状態の競合 (既存と衝突・ワークフロー違反) |
| 501 | 未実装 |
| 503 | 依存リソース未設定 (DB / Firestore / Gemini キー等) |

---

## レート制限・ログ

### レート制限

プロセス内メモリ方式のスライディングウィンドウで実装:

| 対象 | ウィンドウ | 既定上限 | 環境変数 |
|------|-----------|---------|---------|
| `/api/records-pipeline/*` / `/api/filing/*` (AI 系) | 60 秒 | 20 回 | `RATE_LIMIT_AI_MAX` |
| `/api/device/*` (端末向け) | 60 秒 | 300 回 | `RATE_LIMIT_DEVICE_MAX` |
| `/api/api-tokens` / `/api/audit-logs` (管理系) | 60 秒 | 600 回 | `RATE_LIMIT_SESSION_MAX` |

- `RATE_LIMIT_ENABLED=false` で無効化
- 超過時は HTTP 429 + `Retry-After` ヘッダと `retryAfterSec` JSON フィールド
- 成功時にも `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Window-Ms` ヘッダを返却
- Cloud Run 複数インスタンス運用ではインスタンス間で共有されない

### ログ

- すべての `/api/*` リクエストは `apiLog` ミドルウェアで直近 200 件の
  ring buffer にメタ情報を記録（テストダッシュボード `/test` で確認可能）
- API トークンは `lastUsedAt` / `lastUsedIp` が更新され、`GET /api/api-tokens` で
  使用状況を確認可能
- 機微な操作 (トークン発行/失効/削除、申し送り自動実行等) は
  `AUDIT_STORE=firestore` 時に `cpos_audit_logs` に永続化

---

## バージョニング

現状 v0.1 (不安定)。API は事前告知なく変更される可能性があります。
破壊的変更は CHANGELOG.md に記載していきます（今後作成予定）。

---

## 関連ドキュメント

- [DEPLOY.md](./DEPLOY.md) — デプロイ手順・環境変数
- [RECORDS.md](./RECORDS.md) — 記録システム・FacilityConfig
- [CONNECTORS.md](./CONNECTORS.md) — Google Drive/Docs/Sheets 連携
- [FILING.md](./FILING.md) — ケアプラン書類自動整理 (AutoFiler)
- [ARCHITECTURE.md](./ARCHITECTURE.md) — 全体アーキテクチャ
