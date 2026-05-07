# データ取扱方針

加算マネージャがどのデータをどう扱うか、利用者と運用担当向けに明文化します。

---

## 1. 大原則

1. **加算分析は支援であり、法的保証ではありません。** 算定可否の最終判断は所管自治体・社労士・行政書士に確認してください。
2. **個人情報を最小化します。** 既定では氏名・被保険者番号などを取り扱いません。
3. **PAT その他の認証情報を永続保存しません。** ブラウザの暗号化 Cookie だけが保存場所です。
4. **アップロードファイルはサーバに保存しません。** メモリ上で展開・分析するのみで、終了後は破棄されます。

---

## 2. 取り扱うデータの分類

| 種別 | 例 | 扱い |
|---|---|---|
| 加算マスタ | サービス別の要件・単位数 | リポジトリ同梱・公開可 |
| 集計値 | 利用者数・要介護度分布・職種別人数 | 加算判定に使用・PII 非含有 |
| 個別利用者情報 | 氏名・被保険者番号・住所・電話番号 | **取得しない / 保存しない** |
| PAT（CPOS API トークン） | `cpos_pat_...` | サーバには保存せず、暗号化 Cookie として返す |
| アップロード PDF | レセプトPDF・職員一覧 | メモリ処理のみ・保存なし |
| 分析結果 | 判定 JSON・Markdown レポート | レスポンスとして返却・履歴は残さない |

---

## 3. PAT（CPOS API トークン）の扱い

### サーバ側の挙動

| | 動作 |
|---|---|
| 受信 | POST /api/cpos-token で受け取る（HTTPS 必須） |
| 検証 | CPOS の `/api/platform/me` を叩いて妥当性確認 |
| 暗号化 | AES-256-GCM で sealed cookie に変換 |
| 返却 | `Set-Cookie: kasan_cpos_session=...; HttpOnly; Secure; SameSite=Lax` で返却 |
| ログ | 平文トークン非出力。先頭 14 文字 + `...REDACTED` のみ |
| DB | **保存しない**（リポジトリ全体にトークン保存ロジックなし） |
| ファイル | **保存しない** |
| 環境変数 | **保存しない** |

### ブラウザ側の挙動

| | 動作 |
|---|---|
| localStorage | **使わない** |
| sessionStorage | **使わない** |
| Cookie | `HttpOnly` のため JavaScript から読めない |
| 表示 | 入力後は即時クリア。PAT 平文を画面に残さない |

### 暗号化方式

- アルゴリズム: AES-256-GCM
- 鍵導出: `KASAN_SESSION_SECRET`（32 文字以上）から SHA-256
- IV: ランダム 12 バイト
- 認証タグ: 16 バイト（改ざん検知）
- 形式: `IV(12B) || ciphertext || tag(16B)` を base64url

サーバ側で `KASAN_SESSION_SECRET` が漏洩すると、Cookie 値から PAT を復号できてしまいます。本番では Secret Manager 等で厳重に管理してください。

---

## 4. CPOS から取得するデータ

CPOS の `/api/kasan/v1/analysis-source` および `/api/platform/kasan/export` から取得する値は、**CPOS 側で集計済み・PII 非含有** です。

| フィールド | 内容 |
|---|---|
| `userSummary.activeUserCount` | 利用者数（個人特定情報なし） |
| `userSummary.careLevelDistribution` | 要介護度分布（人数のみ） |
| `staffSummary.qualifiedPersonCountByProfession` | 職種別人数（氏名なし） |
| `claimSummary.currentAddOnCounts` | 加算別件数（誰のかは含まない） |

CPOS 側で `includePii=true` を指定し、かつ十分な権限（`kasan:read:pii` 等）がある場合のみ、個人を特定できる項目を返します。本アプリは既定で `includePii=false` を使います。

---

## 5. アップロードファイルの扱い

JSON / PDF / CSV / TXT すべて、サーバ側の挙動は同じです。

- `multer.memoryStorage()` でメモリ上で受信
- 必要な抽出処理（JSON parse / PDF テキスト化 / CSV 解析）を実施
- 判定エンジンへ入力
- レスポンス返却後、ガベージコレクションで自動破棄

ディスクへの書き込み・ログ出力なし。

---

## 6. 分析結果の扱い

判定 JSON / Markdown レポートは HTTP レスポンスとして返却するだけで、サーバには記録しません。

- 履歴を残したい場合は、ブラウザで「ページを保存」または「Markdown レポートを表示」からコピー
- 自動保存は行わない

---

## 7. 監査ログ

サーバは以下のイベントだけログに残します（個人情報は含めない）。

- CPOS PAT の検証成功 / 失敗（subjectUserEmail と tokenPreview のみ）
- CPOS API 呼び出し時のステータスコード
- レート制限の発動
- reCAPTCHA の検証失敗

CPOS 側は別途、`kasan.bootstrap` / `kasan.analysis_source.read` 等を CPOS 監査ログに記録します。

---

## 8. ネットワーク経路

```
ブラウザ ─[HTTPS]─► 加算マネージャ ─[HTTPS]─► CPOS API
            ↑
       Cookie のみ
       （ボディに PAT を含まない通信）
```

- ブラウザは PAT を保持しません（Cookie は HttpOnly のため JavaScript から読み取り不可）
- ブラウザから CPOS へ直接通信はしません（CORS / OPTIONS リクエストも発生しない）
- すべての通信は HTTPS（本番）

---

## 9. 個人情報を含むファイルをアップロードしてはいけない理由

加算マネージャの分析機能は、Gemini API（Google AI）に判定結果のサマリと事業所情報のテキストを送信します。
そのため、**アップロード前に個人情報をマスキング**してください。

マスキング対象例:
- 利用者の氏名・カナ氏名
- 被保険者番号
- 住所・電話番号
- 生年月日

CPOS 経由で取得するデータは集計済みなので、この心配はありません。

---

## 10. 退職者・端末紛失時の対応

| 状況 | 対応 |
|---|---|
| 退職者の PC | CPOS 側で当該 PAT を revoke。加算マネージャ側は何もしなくてよい |
| 端末紛失・盗難 | 同上。Cookie 自体も持ち出されるが、CPOS 側で PAT を revoke すれば即時無効化 |
| Cookie 自動失効 | 既定 90 日。CPOS PAT の有効期限が短ければそれに合わせて短縮 |
| サーバ側 secret 漏洩 | `KASAN_SESSION_SECRET` を新しい値で更新 → 全ユーザの Cookie が一斉無効化 |

---

## 11. 関連ドキュメント

- [CPOS_TOKEN.md](./CPOS_TOKEN.md) — PAT 接続の操作手順
- [USER_GUIDE.md](./USER_GUIDE.md) — UI 全体の使い方
- [TECHNICAL.md](./TECHNICAL.md) — アーキテクチャと内部実装
- [DEPLOYMENT.md](./DEPLOYMENT.md) — 運用と環境変数

> ご不明点は運用担当者にご相談ください。本アプリは支援ツールであり、法的判断を代替するものではありません。
