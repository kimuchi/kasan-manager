# CPOS 連携（開発者・管理者向け）

加算マネージャは CPOS の **App Platform アプリ（appId=`kasan`）** として動作します。
ログイン・ユーザー管理・データ保存はすべて CPOS 側に集約され、加算マネージャ独自の保存はありません。
利用者向けの手順は [CPOS_TOKEN.md](./CPOS_TOKEN.md)、追加が必要な CPOS API は
[`ref/KASAN_APP_API_ADDITIONS.md`](../ref/KASAN_APP_API_ADDITIONS.md) を参照してください。

---

## 1. アーキテクチャ

```
Browser (/pro)
  └─ 「CPOS でログイン」→ /api/auth/cpos/start → CPOS 同意 → /api/auth/cpos/callback
       → 加算マネージャが kasan_session cookie(AES-GCM, HttpOnly) を発行
  └─ 以降の API は kasan_session で認証（req.user に organizationId/role/allowedFacilityIds）
        │
        ▼
加算マネージャ サーバ (Express)
  └─ s2s は CPOS の App Token（KASAN_CPOS_APP_TOKEN）で CPOS API を呼ぶ
  └─ 保存は CPOS app-data:kasan/*（organizationId で隔離）。保存前に匿名化
        │  Authorization: Bearer <App Token>
        ▼
CPOS API
  - /api/app-data/kasan/{analyses,reviews,facility-profiles,staff-rosters,drafts,entitlements,...}
  - /api/platform/facilities, /api/platform/users
  - /api/kasan/v1/analysis-source（CPOS 請求/体制データの集計）
  - [PROPOSED] /api/apps/kasan/session/exchange, /api/platform/organizations …
```

---

## 2. 設定（サーバ環境変数）

| 変数 | 必須 | 用途 |
|---|---|---|
| `KASAN_SESSION_SECRET` | **必須** | ログインセッション cookie の暗号鍵（32 文字以上）。`openssl rand -hex 32` |
| `KASAN_DEFAULT_CPOS_BASE_URL` | **必須** | CPOS のベース URL（例 `https://cpos.example.jp`） |
| `KASAN_CPOS_APP_TOKEN` | **必須** | CPOS `/app-tokens` で発行したアプリ用 App Token |
| `KASAN_CPOS_APP_CLIENT_ID` | 任意 | ログ突合用のアプリ識別（既定 `kasan`） |
| `KASAN_PUBLIC_BASE_URL` | 任意 | OAuth コールバックの公開 URL（未指定は host 推定） |
| `KASAN_ADMIN_EMAILS` | 任意 | 管理者 email（CPOS `role=admin` への override） |
| `KASAN_CPOS_FAKE` | 任意 | `1` で開発用 Fake CPOS（本番は未設定） |
| `KASAN_COOKIE_SECURE` / `KASAN_COOKIE_SAMESITE` | 任意 | 本番は `true` / `Lax` |
| `CPOS_TIMEOUT_MS` | 任意 | CPOS への HTTP タイムアウト（既定 30000） |

App Token の推奨 scope: `app-data:kasan:read` `app-data:kasan:write` `users:read` `facilities:read`
（CPOS 実データ活用なら `master-users:read` / `facility-staff:read` / `care-*:read` も）。

---

## 3. App 登録手順（CPOS 側）

1. CPOS 管理コンソールで加算マネージャをアプリ（`appId=kasan`）として登録。
2. `/app-tokens` で上記 scope を持つ App Token を発行 → `KASAN_CPOS_APP_TOKEN` に設定。
3. （ユーザーログインを使う場合）CPOS 側に外部アプリ用の受け渡し API を実装
   （`ref/KASAN_APP_API_ADDITIONS.md` B1）。未実装の間は `KASAN_CPOS_FAKE=1` で動作確認できます。

---

## 4. 主なエンドポイント（加算マネージャ側）

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/auth/cpos/start` | CPOS 同意画面へ 302 |
| GET | `/api/auth/cpos/callback` | code 交換 → セッション cookie 発行 → `/pro` |
| POST | `/api/auth/logout` | セッション破棄 |
| GET | `/api/me` | ログイン状態（uid/organizationId/role/plan） |
| GET/POST/PUT/DELETE | `/api/profiles/facilities`・`/api/profiles/staff-rosters` | 施設・名簿（CPOS app-data） |
| GET/POST/DELETE | `/api/drafts`（`/:id/merge`・`/:id/analyze`） | ドラフト |
| GET | `/api/analyses`・`/api/analyses/:id` | 履歴（有料） |
| POST | `/api/analyses/:id/review` | レビュー記録（有料） |
| POST | `/api/analyze/from-cpos` | App Token で CPOS 集計を取得 → 判定（要ログイン） |
| GET | `/api/cpos/facilities` | App Token で事業所一覧（allowedFacilityIds で絞込） |
| GET/POST | `/api/admin/users`・`/api/admin/stats`・`/api/admin/users/:uid`・`/api/admin/users/:uid/plan` | 管理（管理者のみ） |

CSRF: 変更系 `/api/*` は `X-CSRF-Token`（`/api/health` の `csrf.token`）が必要。

---

## 5. ログとセキュリティ

- ログ禁止: App Token 平文 / Authorization ヘッダ / Cookie 本文 / 個人情報。
- 保存禁止: 氏名・被保険者番号等。保存前に `anonymize.js` で除去・要約し、`assertStorageSafe` で最終チェック。
- 組織隔離: すべての保存は `organizationId` 名前空間。

---

## 6. ローカル/結合テスト

```bash
# 純ロジック + 匿名化 + CPOS store（Fake）
npm run test:smoke

# サーバ起動 + Fake CPOS でルートを実 HTTP 検証
npm run test:integration

# 手動: Fake CPOS でサーバ起動
KASAN_CPOS_FAKE=1 KASAN_SESSION_SECRET=$(openssl rand -hex 32) \
  KASAN_DEFAULT_CPOS_BASE_URL=https://cpos.example.jp npm start
```

---

## 7. 関連ドキュメント

- [CPOS_TOKEN.md](./CPOS_TOKEN.md) — 利用者向けログイン手順
- [AUTH_AND_PLANS.md](./AUTH_AND_PLANS.md) — ログイン・プラン
- [DATA_SAFETY.md](./DATA_SAFETY.md) — データ取扱方針
- [`ref/KASAN_APP_API_ADDITIONS.md`](../ref/KASAN_APP_API_ADDITIONS.md) — CPOS に追加すべき API（提案）
