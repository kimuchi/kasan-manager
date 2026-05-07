# CPOS 連携（開発者向け）

加算マネージャと CPOS（介護記録・請求基盤）の接続仕様を、開発者向けにまとめたものです。利用者向けの操作手順は [CPOS_TOKEN.md](./CPOS_TOKEN.md) を参照してください。

---

## 1. アーキテクチャ

```
┌────────────────────────────────────────────────────────────┐
│ Browser                                                    │
│  - PAT 入力 → POST /api/cpos-token                          │
│  - 以後、HTTP-only Cookie が認証トークン                       │
│  - localStorage / sessionStorage は使わない                   │
└─────────────┬──────────────────────────────────────────────┘
              │  Cookie: kasan_cpos_session=<sealed>
              ▼
┌────────────────────────────────────────────────────────────┐
│ 加算マネージャ サーバ (Express)                              │
│  - sealed cookie を AES-256-GCM で復号                       │
│  - リクエストごとにメモリ上で PAT を取り出して CPOS API を叩く  │
│  - PAT を DB / ファイル / 環境変数 / ログに永続保存しない      │
└─────────────┬──────────────────────────────────────────────┘
              │  Authorization: Bearer <PAT>
              ▼
┌────────────────────────────────────────────────────────────┐
│ CPOS API                                                    │
│  - /api/platform/me                                         │
│  - /api/platform/facilities                                 │
│  - /api/platform/kasan/export                               │
│  - /api/kasan/v1/analysis-source（旧経路、互換）              │
└────────────────────────────────────────────────────────────┘
```

---

## 2. サーバ環境変数

| 変数 | 必須 | 用途 |
|---|---|---|
| `KASAN_SESSION_SECRET` | **必須**（CPOS 機能を有効化するなら） | Cookie 暗号化鍵。32 文字以上のランダム値 |
| `KASAN_DEFAULT_CPOS_BASE_URL` | 任意 | フロントの CPOS URL 入力欄に初期表示する URL |
| `KASAN_CPOS_ALLOWLIST` | 任意 | 許可する CPOS ホストの allowlist（カンマ区切り） |
| `KASAN_ALLOW_APP_TOKEN` | 任意 | true で App Token も許容（既定: PAT のみ） |
| `KASAN_COOKIE_SECURE` | 任意 | 本番では `true` 必須 |
| `KASAN_COOKIE_SAMESITE` | 任意 | `Lax` / `Strict` / `None` |
| `CPOS_TIMEOUT_MS` | 任意 | CPOS への HTTP タイムアウト（既定 30000） |

`KASAN_SESSION_SECRET` 未設定の場合、`POST /api/cpos-token` は 503 を返し、UI のパネルは表示されません。

`openssl rand -hex 32` で生成して `.env` に書いてください。

---

## 3. Cookie 仕様

### 名前

- `kasan_cpos_session`

### 属性

| 属性 | 値 | 理由 |
|---|---|---|
| `HttpOnly` | 必須 | JavaScript から読めなくする |
| `Secure` | 本番必須 | HTTPS のみで送信 |
| `SameSite` | `Lax` 推奨 | CSRF 対策の基本 |
| `Path` | `/` | アプリ全体で有効 |
| `Max-Age` | CPOS PAT の `expiresAt` 以下、最大 90 日 | PAT 失効と同期 |

### ペイロード（暗号化前）

```json
{
  "v": 1,
  "cposBaseUrl": "https://cpos.example.com",
  "token": "cpos_pat_xxx",
  "tokenPreview": "cpos_pat_abcd...wxyz",
  "subjectUserId": "user_xxx",
  "subjectUserEmail": "yamada@example.com",
  "subjectUserName": "山田 太郎",
  "subjectUserRole": "staff",
  "scopes": ["facilities:read", "master-users:read"],
  "allowedFacilityIds": ["facility-a"],
  "authMethod": "personal_access_token",
  "expiresAtFromCpos": "2026-08-05T00:00:00.000Z",
  "createdAt": "2026-05-07T12:00:00.000Z",
  "exp": 1762300800000
}
```

### 暗号化

AES-256-GCM、IV 12B、認証タグ 16B、`IV(12B) || ciphertext || tag(16B)` を base64url。実装は `app/src/utils/cookie-seal.js`。

---

## 4. CSRF 対策

加算マネージャは double-submit cookie パターンで CSRF 対策しています。

| | 値 |
|---|---|
| Cookie 名 | `kasan_csrf` |
| Header 名 | `X-CSRF-Token` |
| 適用 | `POST` / `PUT` / `PATCH` / `DELETE` の `/api/*` 全部 |
| 取得方法 | `GET /api/health` の `csrf.token` フィールド |

フロントは `/api/health` を初期化時に叩き、`csrf.token` を保持して以降の mutating リクエストに `X-CSRF-Token` を付けます。

---

## 5. API リファレンス

### `POST /api/cpos-token`

PAT を受け取って CPOS で検証し、sealed cookie を返す。

**Request:**
```json
{ "cposBaseUrl": "https://cpos.example.jp", "token": "cpos_pat_..." }
```

**Response (200):**
```json
{
  "ok": true,
  "connected": true,
  "cposBaseUrl": "https://cpos.example.jp",
  "user": { "id": "user_xxx", "email": "...", "name": "...", "role": "..." },
  "token": {
    "tokenPreview": "cpos_pat_abcd...wxyz",
    "scopes": [...],
    "allowedFacilityIds": [...],
    "expiresAt": "...",
    "createdAt": "..."
  }
}
```

**Errors:**
- `400 bad_token_format`: PAT が `cpos_pat_` で始まらない
- `400 invalid_base_url`: 本番で `http://` を指定した、allowlist 外
- `400 not_pat`: App Token 等を指定（`KASAN_ALLOW_APP_TOKEN=true` で許容可）
- `401 cpos_api_error`: PAT が無効・失効
- `403 cpos_api_error`: scope 不足
- `503 session_not_configured`: `KASAN_SESSION_SECRET` 未設定

### `GET /api/cpos-token/status`

Cookie の存在確認。PAT 平文は返さない。

**Response (200):**
```json
{ "connected": false }   // 未接続
{ "connected": true, "cposBaseUrl": "...", "user": {...}, "token": {...} }   // 接続中
```

### `DELETE /api/cpos-token`

Cookie を削除（接続解除）。

### `POST /api/cpos-token/test`

現在の Cookie で CPOS への疎通確認。

### `GET /api/cpos/facilities`

Cookie の PAT で `/api/platform/facilities`（または `/api/kasan/v1/bootstrap`）を叩いて事業所一覧を返す。

### `POST /api/analyze/from-cpos`

Cookie の PAT で CPOS export を取得 → 既存判定エンジンで判定 → Markdown レポートを返す。

**Request:**
```json
{ "facilityId": "facility-a", "serviceMonth": "2026-04", "serviceKey": "tsusho_kaigo" }
```

**Response (200):**
```json
{
  "ok": true,
  "reportMarkdown": "# CareLinker 加算チェッカー 判定レポート\n...",
  "resultJson": { "service": "...", "judgements": {...}, "cpos_metadata": {...} },
  "cpos": { "facilityId": "facility-a", "serviceMonth": "2026-04", "schemaVersion": "1.0" }
}
```

`allowedFacilityIds` 外を指定すると 403 `forbidden_facility`。

---

## 6. ログとセキュリティ

### ログ禁止項目

- PAT 平文
- Authorization ヘッダ
- Cookie 本文
- 個人情報（氏名・被保険者番号等）

実装は `app/src/utils/cookie-seal.js#redactSecret()`。

### ログ許可項目

- `subjectUserEmail`
- `tokenPreview`（先頭 14 文字 + ...REDACTED）
- CPOS host
- HTTP ステータス・所要時間

---

## 7. CLI（フィクスチャ検証用）

CPOS API がまだ稼働していない開発時は、`app/tests/fixtures/cpos_analysis_source.sample.json` を使って CLI 検証できます。

```bash
# Live (PAT を引数で渡す。.env への書き込み回避のため)
npm run cpos:analyze -- \
  --facility=facility-a --month=2026-04 \
  --base-url=https://cpos.example.jp \
  --token=cpos_pat_... \
  --report-md=out/cpos-test.md

# Fixture (CPOS 不要)
npm run cpos:analyze -- \
  --source=app/tests/fixtures/cpos_analysis_source.sample.json \
  --report-md=/tmp/cpos.md
```

---

## 8. 既存 JSON への変換

CPOS の analysis-source / kasan export は、既存判定エンジンの 4 種 JSON に変換されます。

| CPOS | → | 加算マネージャ |
|---|---|---|
| `userSummary` | → | `user_summary.json`（[仕様](./json/user_summary.md)） |
| `staffSummary` | → | `staff.json`（合成 staff[]・[仕様](./json/staff.md)） |
| `claimSummary` | → | `evidence.json`（[仕様](./json/evidence.md)） |
| `dataCompleteness` / `warnings` | → | `tenant_status.json` の `inquiry`（[仕様](./json/tenant_status.md)） |

加算キーマッピング: `regulatory_master/mapping/cpos_addon_mapping.json`。マッピング外の `addOnKey` は警告に出ます（勝手に推測しない）。

実装: `app/src/services/cpos/transform.js`。

---

## 9. 関連ドキュメント

- [CPOS_TOKEN.md](./CPOS_TOKEN.md) — 利用者向け PAT 接続手順
- [DATA_SAFETY.md](./DATA_SAFETY.md) — データ取扱方針
- [json/](./json/) — JSON 形式リファレンス
- [TECHNICAL.md](./TECHNICAL.md) — 全体アーキテクチャ
