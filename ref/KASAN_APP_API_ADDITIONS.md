# CPOS API 追加仕様 — 加算マネージャの「CPOS アプリ連携」化

> **位置づけ / 読み方**
> 加算マネージャ（CareLinker 加算チェッカー）を **CPOS の App Platform アプリとして登録**し、
> 認証・ユーザー管理・データ保存を **CPOS 側へ集約**するための設計。
> `ref/API.md`（仕様書）・`ref/API_REFERENCE.md`（リファレンス）の**実在の規約に合わせて**記述し、
> CPOS 側で**未実装の API のみ** `[PROPOSED]` として追記提案する。
>
> ステータス: **[EXISTING]**=既存をそのまま利用 / **[PROPOSED]**=CPOS に新規追加が必要 / **[CHANGED]**=既存の小変更
>
> 既存規約（`API.md`）に準拠: Bearer **App Token**（`cpos_pat_…`, `/app-tokens` で発行・`scopes[]`・
> `allowedFacilityIds`・`expiresAt`・SHA-256 ハッシュ保存・失効可）/ Cookie セッション（Google OAuth, `cpos_session`）/
> 全 API は `organizationId` で隔離 / エラー `{ "error": "...", "code": "..." }` / 501 未実装 / 503 依存未設定。

---

## 0. 方針（PAT 個人トークン → アプリ登録）

| 項目 | 現状（加算マネージャ） | 移行後 | 根拠（CPOS 既存） |
|---|---|---|---|
| CPOS 認証 | 利用者個人の PAT を貼付 | **App 登録 + App Token**（s2s）＋ ユーザーは CPOS ログイン | `/app-tokens`・`AppRegistration`・`/api/auth/google` |
| データ保存 | 加算マネージャ独自(Firestore/local) | **CPOS App Platform の `app-data`** に集約 | `/api/app-data/:appId/:resource` |
| ユーザー管理 | 加算マネージャ内 | **CPOS 側**（組織・ユーザー・ロール） | `organizationId`・`/api/auth/me`・master-users |
| 課金/プラン | アクセスコード | **`app-data` のエンタイトルメント**（または CPOS サブスク） | app-data |
| CPOS 非利用会社 | （対象外） | **加算マネージャ専用の CPOS 組織を払い出し** | 組織隔離 + `[PROPOSED]` provisioning |

加算マネージャの **appId = `kasan`**（CPOS の `AppRegistration` に登録）。以後 scope は `app-data:kasan:read` /
`app-data:kasan:write` 等を使う。前提として、運用に必要な範囲で **admin 相当**の操作（組織払い出し・ユーザー一覧）が許可される。

---

# PART A — 仕様（`API.md` に追記する想定）

## A1. アプリ登録と認証 [EXISTING + 一部 PROPOSED]

### A1.1 アプリ登録・App Token（s2s）— [EXISTING]
- CPOS 管理コンソール `/app-tokens` で加算マネージャ（`appId=kasan`）に **App Token** を発行。
- スコープ（最小集合）:
  ```text
  app-data:kasan:read
  app-data:kasan:write
  master-users:read        # 利用者集計の取得（任意・CPOS 利用会社）
  facilities:read          # 事業所一覧
  facility-staff:read      # 職種別人数の取得（任意）
  ```
  CPOS の請求/実績連携も使うなら（任意）: `care-claim-candidates:read` / `care-service-actuals:read` /
  `service-code-master:read`（加算マネージャの判定根拠を CPOS 実データで強化）。
- `allowedFacilityIds` 未設定＝組織内全事業所、指定＝その事業所のみ。
- 加算マネージャはこの App Token を **サーバ側 Secret Manager** に保持（DB/ログ/フロントに出さない。現行の PAT 非保存方針を踏襲）。

### A1.2 ユーザーログイン（誰の操作か）— 2 案

**案 X（推奨・kasan を CPOS App Platform 内アプリとして動かす）— [EXISTING]**
加算マネージャを CPOS の app-runtime 上のアプリとして配信すれば、ユーザー認証は CPOS の
`cpos_session`（Google OAuth）をそのまま使い、`app-data:kasan:*` で保存できる。**新規 API 不要**。

**案 Y（加算マネージャを別ドメインの Web アプリとして残す）— [PROPOSED]**
別ドメイン運用を続ける場合、外部アプリが CPOS ログイン中ユーザーの同意を得て
「誰が操作しているか」を受け取る最小の受け渡しが必要（CPOS は現状ファーストパーティの
Google セッションのみ）。PART B の `GET /api/apps/:appId/connect` /
`POST /api/apps/:appId/session/exchange` を追加提案。App Token（s2s）は CPOS 接続に、
受け渡しで得たユーザー情報は監査・所有者記録に使う。

> どちらでも保存先・データモデルは同一（`app-data:kasan`）。まず案 Y を実装し、CPOS 側が
> app-runtime 配信に対応したら案 X へ寄せる移行が可能。

## A2. データモデル（保存はすべて CPOS `app-data` へ）[EXISTING を利用]

`/api/app-data/kasan/:resource` を名前空間として利用する（`organizationId` で隔離・`status` ライフサイクル・
監査・webhook を CPOS が付与）。加算マネージャの独自保存は廃止し、以下の resource にマップする。

| resource | 旧（加算マネージャ独自） | 内容（**保存前にサーバ側で匿名化・要約**） |
|---|---|---|
| `analyses` | `analysis_jobs`(Firestore) | 解析結果の集計サマリ＋レポート（PII 無し） |
| `reviews` | `review_decisions` | 加算ごとの承認/差戻し判断 |
| `facility-profiles` | `facility_profiles` | 施設プロフィール（流用用） |
| `staff-rosters` | `staff_rosters` | 従業員名簿（**氏名なし**・職種別集計） |
| `drafts` | `analysis_drafts` | 「少しずつ取込」の作業セット |
| `entitlements` | `users.planTier` / access_codes | プラン状態（A4） |
| `user-prefs` | （新規） | 表示設定 |

- レコード本体は `data` に格納（CPOS 共通形 `{ id, appId, resource, organizationId, status, data, createdAt, updatedAt, createdBy, ... }`）。
- **匿名化（重要・維持）**: 氏名・被保険者番号等は加算マネージャの `anonymize.js` で除去・要約してから送信。
  `app-data` には集計値・フラグのみ。
- 一覧の絞り込み（`organizationId`/`facilityId`/期間）に必要なクエリ引数が `app-data` に無い場合は A5 / PART B で拡張提案。

## A3. CPOS 既存データの最大活用（CPOS 利用会社）[EXISTING を利用]

加算判定の入力を、可能な限り CPOS の実データから取得する。

- 利用者集計: 既存 `/api/kasan/v1/analysis-source` または `master-users` / `ltc-web` eligibility facade。
- 事業所: `facilities:read`（`/api/platform/facilities`）。
- 職員（職種別人数）: `facility-staff:read`（`/api/platform/facility-staff`）。
- 請求実績（任意・判定強化）: `care-service-actuals:read` / `care-claim-candidates:read`。

> マッピング外の値は勝手に推測せず警告に出す既存方針を維持（`cpos_addon_mapping.json`）。

## A4. 課金・エンタイトルメント [PROPOSED（軽量）/ 代替は app-data]

加算マネージャ「有料プラン」は CPOS の**エンタイトルメント**で表す。実装容易な順に 2 案:

- **案 1（新規 API 不要）**: `app-data:kasan/entitlements` に `{ product: "kasan-manager", status, expiresAt, grantedBy }` を保存。
  付与/取消は admin ユーザーのみ書込可（加算マネージャ側で role を確認）。
- **案 2（CPOS ネイティブ・[PROPOSED]）**: 組織サブスクリプション API（PART B `…/entitlements`）。
  CPOS が課金を一元管理するならこちら。

## A5. 加算マネージャ専用アカウント（CPOS 非利用会社）[PROPOSED]

CPOS を使っていない会社向けに、加算マネージャから CPOS 上に**専用組織**を払い出す。

1. App Token（admin 相当）で `POST /api/platform/organizations`（`type=app`）→ `organizationId` 取得。
2. `POST /api/platform/organizations/:id/users` で管理ユーザーを作成（メール招待 or 仮パスワード）。
3. 以後その会社のデータは **この `organizationId` の `app-data:kasan` 名前空間にのみ**保存（CPOS の組織隔離で他組織から不可視）。

> これで「専用アカウントのときは、そのアカウント専用のところに保存される」を、CPOS のネイティブな
> 組織隔離で満たす。請求等の CPOS 機能は持たないが、保存・ユーザー管理・プランは同一機構で動く。

## A6. 移行・互換 [CHANGED]

- 既存 PAT 経路（`POST /api/cpos-token` 等の加算マネージャ側エンドポイント）は **非推奨 → 廃止**。
- 加算マネージャ独自保存（`local-store.js` / `auth-local.js` / Firestore `persistence.js` /
  `profiles.js` / `drafts.js` / `admin-stats.js` / `access-codes.js`）は **CPOS `app-data` クライアントへ置換**。
- `GET /api/auth/me` を「ユーザー＋organization＋付与 scope」取得に使用（PART B）。

---

# PART B — リファレンス（`API_REFERENCE.md` に追記する想定）

> 既存の `/api/app-data/*`・`/api/auth/*`・`/app-tokens`・`master-users`・`facilities` 等は再掲しない
> （`API.md` 参照）。ここでは **追記が必要な PROPOSED のみ**を記す。エラーは `{error, code}`。

## B1. 外部アプリのユーザーログイン受け渡し（案 Y）[PROPOSED]

### `GET /api/apps/:appId/connect`
CPOS ログイン中（`cpos_session`）の状態で、外部アプリへのユーザー連携の**同意**を取る。

Query: `redirect_uri`(アプリ登録済の許可リスト内), `state`。
→ 同意後 `redirect_uri?code=<one_time_code>&state=...` へ 302。未ログインなら `/api/auth/google` へ誘導後に復帰。

### `POST /api/apps/:appId/session/exchange`
認可: App Token（`app-data:kasan:read`）。`code` を検証してユーザー identity を返す。
```json
// req
{ "code": "<one_time_code>" }
// res 200
{ "user": { "id": "user_x", "email": "...", "name": "...", "role": "manager" },
  "organizationId": "org_x",
  "allowedFacilityIds": ["facility-a"],
  "expiresIn": 600 }
```
Errors: `400 invalid_code` / `401`(App Token 不正) / `409 code_consumed`。

> 加算マネージャはこの結果でサーバ側セッションを張り、以後の `app-data` 書込の `createdBy`/監査に user を使う。

## B2. 組織プロビジョニング（加算マネージャ専用アカウント）[PROPOSED]

### `POST /api/platform/organizations`
認可: App Token + scope `organizations:provision`（**新規 scope**）。
```json
// req
{ "displayName": "デイサービスほっと", "type": "app",
  "admin": { "email": "owner@example.com", "name": "山田太郎" }, "locale": "ja-JP" }
// res 201
{ "organizationId": "org_kasan_001", "type": "app",
  "adminUserId": "user_001", "invite": { "method": "email", "status": "sent" } }
```
Errors: `409 organization_exists` / `403 insufficient_scope`。

### `POST /api/platform/organizations/:organizationId/users`
認可: App Token + `users:admin`（**新規 scope**、または既存の管理権限）。
```json
{ "email": "staff@example.com", "name": "佐藤", "role": "staff" }
// → 201 { "userId": "user_002", "invite": {...} }
```

### `GET /api/platform/organizations/:organizationId`
認可: App Token + `users:read`。組織属性＋エンタイトルメント概要。

## B3. ユーザー一覧（管理ダッシュボード）[PROPOSED]

### `GET /api/platform/users?organizationId=&limit=&cursor=`
認可: App Token + `users:read`。
```json
{ "users": [ { "id": "user_x", "email": "...", "name": "...", "role": "admin",
    "createdAt": "...", "lastLoginAt": "...",
    "entitlements": { "kasan-manager": { "status": "active", "expiresAt": "..." } } } ],
  "nextCursor": null }
```
> CPOS にユーザー一覧 API が既にあれば再利用。無ければこの形で追加。

## B4. エンタイトルメント（CPOS ネイティブにする場合のみ）[PROPOSED・任意]

A4 案 1（`app-data` 保存）を採るなら不要。CPOS で課金一元化する場合のみ:

### `PUT /api/platform/organizations/:organizationId/entitlements/:product`
認可: App Token + `users:admin`。
```json
{ "action": "grant", "days": 30 }   // grant/extend
{ "action": "revoke" }
// → 200 { "product": "kasan-manager", "status": "active", "expiresAt": "2026-06-29T..." }
```

## B5. `app-data` 一覧クエリの拡張（必要なら）[PROPOSED]

加算マネージャは履歴・ドラフト一覧で絞り込みが必要。既存 `GET /api/app-data/:appId/:resource` が
下記クエリに未対応なら追加:

`GET /api/app-data/kasan/analyses?facilityId=&serviceMonth=&from=&to=&status=&limit=&cursor=`
→ `{ "items": [ { "id", "data", "status", "createdAt", "createdBy" } ], "nextCursor": null }`

集計（管理ダッシュボード用・任意）:
`GET /api/app-data/kasan/analyses/aggregate?organizationId=&from=&to=`
→ `{ "total": n, "last30Days": n, "byService": { ... }, "byMonth": { ... } }`
（無ければ一覧の列挙でアプリ側集計にフォールバック）

## B6. `GET /api/auth/me` の利用 [EXISTING/CHANGED]
既存。レスポンスに `organizationId`・ユーザー `role`・（あれば）`entitlements` を含めると
加算マネージャのプラン判定が 1 リクエストで完結（無ければ B3/B4 で補完）。

---

## 付録: 加算マネージャ側（このリポジトリ）の対応計画

| 現状（独自保存・廃止対象） | 置換後 |
|---|---|
| `services/local-store.js` | 削除（CPOS `app-data` が保存先） |
| `services/auth-local.js`（メール/パスワード） | 削除（CPOS ログイン＝案 X/Y） |
| `services/persistence.js`（Firestore analyses） | `cpos/store.js`: `POST/GET /api/app-data/kasan/analyses`,`/reviews` |
| `services/profiles.js` | `cpos/store.js`: `app-data/kasan/facility-profiles`,`staff-rosters` |
| `services/drafts.js` | `cpos/store.js`: `app-data/kasan/drafts` |
| `services/admin-stats.js` | `app-data` 列挙 + `…/aggregate`（B5）/ `users`（B3） |
| `services/access-codes.js` / `users.js` プラン | `entitlements`（A4） |
| `cpos/auth.js`（PAT sealed cookie） | App Token(Secret Manager) + ユーザー受渡し(B1) のサーバ側セッション |

新規追加: `app/src/services/cpos/store.js`（app-data クライアント）, `app/src/services/cpos/app-auth.js`
（App Token + B1 受け渡し）, ルートの差し替え。**保存前の `anonymize.js` は維持**（多層防御）。
