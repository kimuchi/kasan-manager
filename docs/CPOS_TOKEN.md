# CPOS PAT を使った接続手順

加算マネージャは、あなた個人の **CPOS API トークン（PAT: Personal Access Token）** を使って、CPOS から事業所・利用者・職員・請求などの集計データを取得し、加算分析に使うことができます。

このページは利用者向けの操作ガイドです。

> ℹ️ CPOS 連携は **任意機能** です。CPOS と連携しなくても、JSON / PDF / デモデータでの分析はそのまま使えます。

---

## このページの概要（2 段階フロー）

> 💡 **大事な点**: PAT そのものに認証情報が入っているので、加算マネージャ側で Google ログインは不要です。ただし PAT を **発行** するためには CPOS 上で Google ログインが必要です。

```
ステップ 1（CPOS で 1 回だけ）       ステップ 2（加算マネージャ）
──────────────────                ──────────────────
  CPOS にアクセス                    PAT 入力欄に貼り付け
       ↓                                ↓
  Google でログイン                  「保存して接続確認」
       ↓                                ↓
  「設定 → API トークン」            HTTP-only Cookie に保存
       ↓                                ↓
  PAT を発行 → cpos_pat_... をコピー  接続済み！分析可能
```

所要時間は合計 1〜2 分です。

---

## 1. CPOS で PAT を発行する

### 1-1. CPOS にログイン

ブラウザで CPOS の URL（例: `https://cpos.care-planning.co.jp`）を開き、Google アカウントでログインしてください。

### 1-2. PAT を発行

ログイン後、**「設定 → API トークン」**（または同等の画面）から **「個人 API トークン (PAT) を発行」** を選びます。

加算マネージャの UI 上に表示される「CPOS URL」を入力すると、画面のステップ 1 にある **「PAT 発行ページ」** リンクが有効化され、CPOS の発行画面（`<CPOS_URL>/settings/api-tokens`）が新しいタブで開きます。

> CPOS 側で UI が異なる場合は、CPOS 管理者に「個人 API トークンの発行画面」を確認してください。

発行されると、`cpos_pat_xxxxxxxxxxxxxxxxxxxxxxxx` という文字列が画面に **1 度だけ** 表示されます。**今すぐコピー** してください（一度ページを離れると CPOS は再表示しません）。

PAT には以下の属性があります:

- 先頭が `cpos_pat_` で始まる
- 有効期限（例: 90 日）
- 権限（scopes）と事業所範囲（allowedFacilityIds）

これは**パスワードと同等の重要情報**です。Slack・メール・チャットに貼らないでください。

---

## 2. 加算マネージャに入力する

1. 加算マネージャをブラウザで開く
2. ページ最上部の **「🔐 CPOS と連携して分析する（任意）」** パネル（CPOS 機能が有効な環境でのみ表示）
3. 入力欄を埋める

| 項目 | 内容 |
|---|---|
| CPOS URL | `https://cpos.example.jp` （CPOS 管理者から指定された URL） |
| CPOS API トークン | `cpos_pat_...` をそのまま貼り付け |

4. **「保存して接続確認」** ボタンを押す

サーバが CPOS の `/api/platform/me` を叩いて検証 → 成功したら接続済みになります。

> ⚠️ 入力後、PAT 入力欄は自動的にクリアされます。これは画面に PAT を残さないための仕様です。
> 同じトークンを使い回す場合も、再度貼り付けてください。

---

## 3. 接続済みの状態

接続が成功すると、画面が次の表示に切り替わります。

```
接続中: 山田 太郎 / yamada@care-planning.co.jp （https://cpos.example.jp）
トークン: cpos_pat_abcd...wxyz
権限: facilities:read, master-users:read
事業所範囲: facility-a, facility-b
有効期限: 2026-08-05T00:00:00.000Z
```

このとき、**事業所セレクト**と**対象月**が選べる状態になり、「CPOS データで判定する」ボタンが押せるようになります。

---

## 4. 分析を実行する

1. 事業所を選ぶ（あなたの権限内のみ表示されます）
2. 対象月を選ぶ（既定は当月）
3. **「CPOS データで判定する」** を押す
4. CPOS から取得 → 加算判定エンジン → Markdown レポートが画面に表示される

通常 5〜10 秒で結果が出ます。

---

## 5. 接続を解除する

「接続解除（cookie 削除）」ボタンを押すと、ブラウザの sealed cookie が即時削除されます。

- ブラウザを閉じても、Cookie の有効期限内は接続が維持されます（既定 90 日）
- 自分以外がそのブラウザを使う場合は、退出時に必ず接続解除してください

接続解除しても、CPOS 側の PAT 自体は失効しません（CPOS 管理画面で revoke してください）。

---

## 6. PAT のセキュリティ

加算マネージャ側でやっていること:

| | 内容 |
|---|---|
| ✅ | 受け取った PAT を CPOS で検証 |
| ✅ | 暗号化 + 認証付き署名（AES-256-GCM）した状態で **HTTP-only Cookie** にして返す |
| ❌ | サーバ側のデータベース・ファイル・環境変数には保存しない |
| ❌ | ブラウザの localStorage / sessionStorage には書き込まない |
| ❌ | ログには `cpos_pat_xxx...` の先頭 14 文字以降を出さない |

ブラウザ JavaScript からは Cookie が読めない（`HttpOnly`）ため、XSS が万が一発生しても PAT は奪われません。

CPOS との通信:

- CPOS への HTTPS 通信は **加算マネージャのサーバ** で行う
- ブラウザが直接 CPOS にトークンを送ることはない（CORS の必要なし）

詳しくは [DATA_SAFETY.md](./DATA_SAFETY.md) を参照してください。

---

## 7. よくあるエラー

| メッセージ | 原因 | 対処 |
|---|---|---|
| 「CPOS PAT の形式が不正です」 | `cpos_pat_` で始まらないトークンを貼り付けた | 正しい PAT を確認 |
| 「invalid_base_url」 | http:// を本番で指定した | https:// で指定 |
| 「not_pat」 | App Token など別種のトークンを貼った | CPOS で個人 PAT を発行 |
| 「認証が必要です」「Unauthorized」「HTTP 401」 | CPOS が PAT を受け付けていない（後述） | [§7-1](#7-1-cpos-が-pat-を受け付けない場合) を確認 |
| 「cpos_api_error (HTTP 403)」 | 権限不足 / 事業所アクセス権なし | CPOS 管理者に scope と allowedFacilityIds を確認 |
| 「セッションが切れました」 | Cookie の有効期限切れ | 再接続 |
| 「forbidden_facility」 | 自分の権限外の事業所を選択 | 自分にアクセス権のある事業所を選ぶ |

### 7-1. CPOS が PAT を受け付けない場合

PAT を発行済みなのに「認証が必要です」が出る場合は、以下を順番に確認してください。

#### A. PAT 自体の確認（ユーザ側）

1. PAT を **コピー漏れ** していないか（先頭 `cpos_pat_` から末尾まで完全に貼られているか、空白・改行が入っていないか）
2. PAT が **期限切れ** していないか（CPOS の「設定 → API トークン」で確認）
3. PAT が **revoke（取り消し）** されていないか

#### B. CPOS 側の実装確認（CPOS 管理者・開発者向け）

加算マネージャは下記の HTTP 仕様を CPOS に期待しています。CPOS 側で未実装だとここで詰まります。

| 項目 | 仕様 |
|---|---|
| エンドポイント | `GET <CPOS_BASE_URL>/api/platform/me` |
| 認証 | `Authorization: Bearer <PAT>` ヘッダで判定する（Cookie session 任意） |
| 成功時 | `200 OK` + `{ user: { id, email, name, role }, token: { authMethod, scopes, allowedFacilityIds, expiresAt } }` |
| 失敗時 | `401 Unauthorized` を返す（401 でも JSON で `{ message }` を返してもらえると UI に伝わりやすい） |

**よくある CPOS 側の落とし穴:**

- `/api/platform/me` が **Cookie session のみ** をチェックしていて、`Authorization: Bearer ...` ヘッダを無視している
  → CPOS の認証ミドルウェアで Bearer ヘッダの検証を追加してください
- `Authorization` ヘッダがリバースプロキシ（Nginx 等）で剥がされている
  → `proxy_set_header Authorization $http_authorization;` を追加
- PAT のテーブルがあるが `authMethod === 'personal_access_token'` を返していない
  → 加算マネージャは authMethod が `personal_access_token` であることを検証している
- 期限管理が UTC/JST で食い違っていて即時失効

#### C. UI から CPOS の応答を確認

接続失敗時、UI には `「CPOS の応答（管理者へ伝える診断情報）」` という展開可能なボックスが表示されます。
そこに以下が出ているはずです:

- リクエスト先 URL
- HTTP ステータス
- 応答ヘッダ（`www-authenticate`, `content-type` 等）
- 応答ボディ

これを CPOS 管理者にそのまま渡すと、原因特定が速くなります。

#### D. それでも解決しない場合

1. `npm run cpos:bootstrap -- --base-url=<URL> --token=<PAT>` をローカルで実行
2. 加算マネージャの Cloud Run ログ（`npm run logs`）で `[cpos] verify failure` を検索
3. CPOS の `/api/platform/me` ログを確認

---

## 8. PAT を失効させたい / 紛失した

1. CPOS 管理画面で対象 PAT を **revoke**（取消）してください
2. 加算マネージャ側はそのまま放置で OK（CPOS 側で revoke すれば 401 になり、自動的に再接続を促されます）
3. 必要なら新しい PAT を発行して再接続

---

## 9. まとめ

- CPOS PAT は **パスワード相当**。共有・メール添付しない
- 加算マネージャは PAT を **DB 保存しない**。Cookie だけが保存場所
- 接続解除はワンクリック。ブラウザを離れる前に必ず解除
- 一切設定しなくても、JSON / PDF / デモデータでの分析はそのまま使える

---

## 関連ドキュメント

- [DATA_SAFETY.md](./DATA_SAFETY.md) — データ取扱方針・PII の扱い
- [USER_GUIDE.md](./USER_GUIDE.md) — UI 全体の使い方
- [CPOS_INTEGRATION.md](./CPOS_INTEGRATION.md) — 開発者向け技術詳細
