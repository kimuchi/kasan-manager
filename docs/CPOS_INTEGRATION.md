# CPOS 連携ガイド（加算マネージャ側）

> 関連: 上位指示書「CPOS・加算マネージャ連携／給付管理・請求・記録転記拡充 改修指示書」

加算マネージャは、CPOS（介護記録・請求基盤）と接続して、CPOS が保持する事業所・利用者・職員・請求データを加算分析の入力に使えます。CPOS 連携は **任意の追加機能** で、`.env` に `CPOS_BASE_URL` を設定しない限り従来の手動入力フローはそのまま動きます。

---

## 1. 連携の前提

- CPOS 側で `/api/kasan/v1/bootstrap` と `/api/kasan/v1/analysis-source` が稼働していること
- 加算マネージャから CPOS にアクセスできるネットワーク経路があること
- CPOS 側でこのアプリ用の API トークン（または Cookie セッション）が発行できること

CPOS API の仕様は CPOS リポジトリの `docs/KASAN_MANAGER_INTEGRATION.md` および `docs/API.md` を参照してください。

---

## 2. 設定

`.env` に下記を追加します（`.env.example` 参照）。

```ini
# CPOS のベース URL（末尾スラッシュなし）
CPOS_BASE_URL=https://cpos.example.jp

# CPOS が発行する Bearer トークン
CPOS_API_TOKEN=eyJhbGciOi...

# 任意
CPOS_TIMEOUT_MS=30000
CPOS_APP_ID=kasan-manager
```

設定後、`npm run deploy:cloudrun -- --skip-build` で再デプロイすれば反映されます（ビルド不要）。

---

## 3. CLI で確認する

### 3-1. 接続確認 — `npm run cpos:bootstrap`

CPOS の `/api/kasan/v1/bootstrap` を叩き、ログイン中ユーザ・組織・アクセス可能事業所を表示します。

```bash
npm run cpos:bootstrap
# 出力例:
# ✅ 接続: OK
#    ユーザ: user@example.com (role=manager)
#    組織: 株式会社サンプルケア
#    アクセス可能事業所: 3 件
#      - facility-a: デイほっと（serviceTypeCodes=15）
#      - facility-b: 訪問介護SUN（serviceTypeCodes=11）
```

`.env` を使わず引数で指定したい場合:

```bash
npm run cpos:bootstrap -- --base-url=https://cpos.example.jp --token=$CPOS_API_TOKEN
```

### 3-2. 分析実行 — `npm run cpos:analyze`

CPOS から analysis-source を取得 → 既存判定エンジンで分析 → Markdown レポートを出します。

```bash
# Live: 実 CPOS API から取得
npm run cpos:analyze -- \
  --facility=facility-a \
  --month=2026-04 \
  --report-md=out/cpos_facility-a_2026-04.md \
  --json=out/cpos_facility-a_2026-04.json

# Fixture: オフライン検証（CPOS 未稼働でも動く）
npm run cpos:analyze -- \
  --source=app/tests/fixtures/cpos_analysis_source.sample.json \
  --report-md=/tmp/cpos_test.md
```

### 3-3. CLI オプション

| オプション | 用途 |
|---|---|
| `--facility=<id>` | 対象事業所 ID |
| `--month=YYYY-MM` | 対象月 |
| `--source=<path>` | analysis-source の JSON ファイル（live API の代わり） |
| `--include-pii` | （manager+ 用）PII 含むデータを取得 |
| `--report-md=<path>` | Markdown レポートの保存先 |
| `--json=<path>` | 判定結果の JSON 保存先 |
| `--dry-run` | 取得のみ、判定はスキップ |
| `--base-url=<url>` | `.env` を上書き |
| `--token=<token>` | `.env` を上書き |

---

## 4. Web UI で使う

`CPOS_BASE_URL` が設定されているとき、トップ画面の冒頭に **「🔗 CPOS データで分析する」** パネルが自動的に表示されます。

1. CPOS から取得した事業所一覧から事業所を選択
2. 対象月を選ぶ
3. 「CPOS データで判定する」ボタンを押す
4. CPOS から analysis-source を取得 → サーバ側で判定 → 結果を表示

CPOS のトークンは **サーバの `.env` でのみ管理** され、ブラウザには渡しません。

---

## 5. データ変換の流れ

```
CPOS analysis-source        加算マネージャ判定エンジン入力
─────────────────────       ──────────────────────────────
userSummary             →   user_summary.json 互換
staffSummary            →   staff.json 互換（合成 staff[]）
claimSummary            →   inline evidence（receipt PDF 互換）
dataCompleteness        →   tenant_status.inquiry
warnings                →   tenant_status.inquiry
```

実装は `app/src/services/cpos/transform.js` を参照。

### 加算キーマッピング

CPOS の `addOnKey`（例: `nyuyoku_kaijo_ii`）と加算マネージャの `kasan_key`（例: `nyuyoku_II`）は別系統です。マッピングは `regulatory_master/mapping/cpos_addon_mapping.json` で管理しています。新しい加算を追加する際はこのファイルにエントリを追加してください。

マッピング外の `addOnKey` は `unmapped_cpos_addons` として警告に出力され、勝手に kasan_key を確定しません。

---

## 6. レポートに追加される内容

CPOS 由来データで分析したレポートには **「🔗 CPOS データ整備状況」** セクションが追加されます。

| データ | 状態 | 分析への影響 | 次のアクション |
|---|---|---|---|
| 事業所マスタ | ✅ 完全 | 事業所判定の前提 | （対応不要） |
| 利用者マスタ | 🟡 一部 | 要介護度割合の精度に影響 | CPOS で利用者マスタを更新 |
| 常勤換算 | ❌ 未登録 | 職員配置要件が判定不可 | CPOS で常勤換算を登録 |
| 請求 | 🟡 一部 | 現在算定中加算の検出に一部不足 | CPOS の請求 PDF を取込または手入力 |
| 給付管理 | ❌ 未登録 | 限度額・利用実績との照合不可 | CPOS で給付管理を登録 |
| 記録 | 🟡 一部 | 加算根拠記録の有無を判定不可 | CPOS で記録の整備を進める |

外部 PT/OT/ST が CPOS に登録されている場合は注記を追加します（機能訓練指導員の OR ルートとして検討可）。

---

## 7. API（サーバ側エンドポイント）

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/health` | `cpos.configured` フラグを返す（フロントが UI を出し分ける） |
| GET | `/api/cpos/status` | 設定状況のみ返す |
| GET | `/api/cpos/bootstrap` | CPOS bootstrap を中継 |
| GET | `/api/cpos/facilities` | bootstrap から `facilities` 配列だけ抽出 |
| GET | `/api/cpos/monthly-status` | facilityId+serviceMonth のデータ整備状況 |
| POST | `/api/cpos/analyze` | analysis-source 取得 → 判定エンジン → Markdown を 1 回で返す |

`/api/cpos/analyze` は heavy リミッタと reCAPTCHA（設定時のみ）の対象です。

---

## 8. セキュリティ・個人情報の方針

- CPOS から取得するデータは既定で **PII 非含有**（`includePii=false`）。
- CPOS API トークンは加算マネージャのサーバ側 `.env` でのみ保持。**ブラウザの localStorage には保存しない**。
- ブラウザは `/api/cpos/*` を介してのみ CPOS データに触れる。CPOS の URL/トークンは漏れない。
- CPOS 側の監査ログ（`kasan.bootstrap` / `kasan.analysis_source.read`）に呼び出しが記録される。
- CPOS 連携で取得した analysis-source は **加算マネージャ側では永続化しない**（メモリ処理のみ）。

---

## 9. トラブルシュート

| 症状 | 対処 |
|---|---|
| パネルが表示されない | `.env` の `CPOS_BASE_URL` を確認し、`npm run deploy:cloudrun -- --skip-build` で再反映 |
| `cpos_not_configured` が返る | `.env` に `CPOS_BASE_URL` を追加。サーバの起動ログで `cpos_configured=true` か確認 |
| `HTTP 401` エラー | `CPOS_API_TOKEN` の期限切れ / scope 不足。CPOS 側で再発行 |
| `HTTP 403` エラー | scope 不足、または対象事業所への `allowedFacilityIds` 設定なし |
| `HTTP 404` エラー | 事業所 ID または対象月の指定ミス。`npm run cpos:bootstrap` で事業所一覧を確認 |
| CLI が `CposNotConfiguredError` | `--source=<fixture>` を指定するか `.env` を設定 |
| マッピング未登録警告 | `regulatory_master/mapping/cpos_addon_mapping.json` に `cpos_addon_keys` を追加 |

---

## 10. 制約・既知の限界（MVP 範囲）

- CPOS 側の API（bootstrap / analysis-source）が未稼働の場合、live 分析は不可。CLI の `--source` でフィクスチャ検証は可能
- staff_data は CPOS の集計値（人数 + 常勤換算）から **合成 staff[]** を作るため、個人単位の細かい資格・勤続情報は反映されない
- 給付管理・請求の正規 API は CPOS Phase 5 待ち。本 MVP では PDF 取込結果や addon-summary の集計のみ利用
- 記録転記候補（CPOS Phase 6）はまだ呼んでいない
- マルチテナント対応・別ドメイン Connected App Code Flow は未実装（Phase 1 想定の同一オリジン or サーバサイド Bearer のみ）

---

## 11. 関連ドキュメント

- 上位指示書: `CPOS・加算マネージャ連携／給付管理・請求・記録転記拡充 改修指示書`（社内）
- [DEPLOYMENT.md](./DEPLOYMENT.md) — Cloud Run デプロイ
- [TECHNICAL.md](./TECHNICAL.md) — 加算マネージャの内部アーキテクチャ
- [CLI.md](./CLI.md) — 全 CLI コマンドの引数表
