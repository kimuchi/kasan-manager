# ログイン・プラン（CPOS 連携）

加算マネージャは **ログイン・ユーザー管理・データ保存をすべて CPOS 側に集約**しています。
加算マネージャ自身は独自のユーザー DB や保存領域を持ちません。

関連ドキュメント:
- [CPOS 連携（開発者向け）](./CPOS_INTEGRATION.md) — App 登録・App Token・エンドポイント
- [CPOS でログインする手順](./CPOS_TOKEN.md) — 利用者向け
- [CPOS API 追加仕様（提案）](../ref/KASAN_APP_API_ADDITIONS.md) — CPOS 側に追加が必要な API
- [データ取扱方針](./DATA_SAFETY.md) — 個人情報の扱い

## 2 つのモード

| | 公開トップ `/`（ローカルエンジン） | 高精度版 `/pro` |
|---|---|---|
| ログイン | 不要（無料） | **CPOS でログイン**が必要 |
| 保存 | 保存しない | CPOS に保存（履歴・名簿・施設・ドラフト） |
| 解析 | ブラウザ内で集計 → 判定 | 同上 ＋ CPOS の請求/体制データ直接取り込み |

公開トップは従来どおりログイン不要・無保存で使えます。本書は `/pro` の CPOS 連携について述べます。

## 認証 = CPOS アプリ登録 + CPOS ログイン

加算マネージャは CPOS の **App Platform にアプリ（appId=`kasan`）として登録**されます。

1. **App Token（s2s）**: CPOS 管理コンソール `/app-tokens` でアプリ用の API トークンを発行し、
   加算マネージャのサーバに `KASAN_CPOS_APP_TOKEN` として設定します（個人 PAT は廃止）。
   推奨 scope: `app-data:kasan:read` `app-data:kasan:write` `users:read` `facilities:read`。
2. **ユーザーログイン**: 利用者は `/pro` の「CPOS でログイン」から CPOS の同意画面に進み、
   戻ってくると加算マネージャがサーバ側セッション cookie（`kasan_session`, AES-GCM 封入・HttpOnly）を発行します。
   cookie に CPOS トークンは入れません（識別情報のみ）。

ログイン後、`req.user` には CPOS から得た `organizationId` / `role` / `allowedFacilityIds` が入り、
すべての保存は `organizationId` で隔離されます。

> 認可の受け渡し（外部アプリ向け）は CPOS 側に追加 API が必要です（`ref/KASAN_APP_API_ADDITIONS.md` B1）。
> 開発・結合テストでは `KASAN_CPOS_FAKE=1` でプロセス内 Fake CPOS を使えます。

## データ保存 = CPOS `app-data`

`/pro` で保存される情報は、すべて CPOS の App Platform ストア `/api/app-data/kasan/*` に入ります。

| 種類 | resource | 備考 |
|---|---|---|
| 解析履歴（集計サマリ＋レポート） | `analyses` | 保存前にサーバ側で匿名化 |
| レビュー判断 | `reviews` | 加算ごとの承認/差戻し |
| 施設プロフィール | `facility-profiles` | 組織内で流用 |
| 従業員名簿 | `staff-rosters` | **氏名は保存せず**職種別集計 |
| 作業ドラフト | `drafts` | 少しずつ取込 |
| エンタイトルメント | `entitlements` | プラン状態 |

**匿名化（多層防御）**: 氏名・被保険者番号・電話などは加算マネージャのサーバが除去・要約してから CPOS に送ります。

## プラン（有料）= CPOS エンタイトルメント

「有料プラン」は CPOS アカウントの **エンタイトルメント**（製品キー `kasan-manager`）で表します。
加算マネージャのアクセスコードは廃止しました。

- 付与/取消: 管理者（CPOS `role=admin` または `KASAN_ADMIN_EMAILS`）が `/pro` の管理画面、または
  `POST /api/admin/users/:uid/plan { action: 'grant'|'revoke', days }` で操作。
- `active` の間だけ履歴保存・レビュー・ポートフォリオ最適化が有効。期限切れで自動的に無効化。

## CPOS 非利用の事業所向け（専用アカウント）

CPOS を使っていない会社でも、加算マネージャから CPOS 上に**専用アカウント（組織）を払い出し**、
そのアカウントの名前空間にだけデータを保存できます（CPOS のネイティブな組織隔離を利用）。
払い出し API は CPOS 側に追加が必要です（`ref/KASAN_APP_API_ADDITIONS.md` B2）。

## 管理画面（`/pro` 下部・管理者のみ）

- 組織ユーザー一覧（CPOS）
- 利用状況ダッシュボード（総解析数・サービス別・直近30日）
- ユーザー詳細（解析回数・直近履歴・サービス別）
- エンタイトルメント付与/取消

## 設定が必要な環境変数

`.env.example` の「CPOS アプリ連携」セクション参照。主なもの:

| 変数 | 必須 | 用途 |
|---|---|---|
| `KASAN_SESSION_SECRET` | ✅ | ログインセッション cookie の暗号鍵（32 文字以上） |
| `KASAN_DEFAULT_CPOS_BASE_URL` | ✅ | CPOS のベース URL |
| `KASAN_CPOS_APP_TOKEN` | ✅ | `/app-tokens` で発行したアプリ用 App Token |
| `KASAN_PUBLIC_BASE_URL` | 任意 | OAuth コールバックの公開 URL（未指定は host 推定） |
| `KASAN_ADMIN_EMAILS` | 任意 | 管理者 email（CPOS role=admin への override） |
| `KASAN_CPOS_FAKE` | 任意 | `1` で開発用 Fake CPOS |

`/api/health` の `auth.cpos_login_enabled` と `persistence.backend`（`cpos_app_data` であること）で
設定状況を確認できます。

## データ削除依頼

ユーザー・組織のデータは CPOS 側に保存されるため、削除は **CPOS の管理機能**で行います
（加算マネージャ側に保存はありません）。CPOS の `app-data:kasan` を該当 organizationId で削除します。

## テスト

```bash
npm run test:smoke         # 純ロジック + 匿名化 + CPOS store（FakeCpos）
npm run test:integration   # サーバ起動 + Fake CPOS でルートを実 HTTP 検証
```
