# 技術マニュアル

加算マネージャー Web 版のアーキテクチャ・データモデル・API リファレンス・カスタマイズ手順をまとめた開発者向けガイドです。

---

## 1. アーキテクチャ

### 1-1. 全体構成

```
┌────────────────────────────────────────────────────────────┐
│                         Browser                            │
│   public/index.html  +  public/app.js  +  public/styles.css │
│   （フォーム入力 / 4 種類のファイルアップロード / 結果表示） │
└─────────────┬──────────────────────────────────────────────┘
              │  multipart/form-data
              ▼
┌────────────────────────────────────────────────────────────┐
│  Express Server  (app/src/server.js)                       │
│   - GET  /api/health                                       │
│   - GET  /api/services                                     │
│   - POST /api/judge          ─┐                            │
│   - POST /api/analyze        ─┤ 共通の判定パイプライン     │
│   - POST /api/import-receipt ─┘                            │
└─────────────┬──────────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────────┐
│  Core Services  (app/src/services/)                        │
│   - regulator.js       マスタ JSON ローダ                   │
│   - extractor.js       添付（PDF/CSV/TXT）テキスト化        │
│   - receipt-pdf.js     レセプト PDF → evidence JSON         │
│   - dsl.js             要件論理式 DSL 評価器                 │
│   - judge.js           judge_kasan 判定エンジン             │
│   - markdown-report.js Markdown レポートレンダラ            │
│   - analyzer.js        判定結果 → Gemini プロンプト         │
│   - gemini.js          @google/generative-ai クライアント   │
└─────────────┬──────────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────────┐
│  Knowledge Base  (リポジトリ ルート)                         │
│   - regulatory_master/  サービス × 加算マスタ JSON           │
│   - schemas/            JSON Schema 定義                    │
│   - config/             evidence_labels.json 等             │
│   - tenant_data/        DEMO テナントデータ（CLI 検証用）    │
└────────────────────────────────────────────────────────────┘
```

### 1-2. 処理フロー

#### POST /api/analyze の処理シーケンス

```
1. multipart リクエスト解析（multer メモリストレージ）
   ├─ pdf:                介護給付費明細書PDF（任意・1件）
   ├─ tenant_status_json: 事業所ステータス（任意・1件）
   ├─ staff_json:         職員集計（任意・1件）
   ├─ user_summary_json:  利用者集計（任意・1件）
   └─ attachments[]:      参考添付（任意・最大5件）

2. PDF があれば receipt-pdf.runExtraction() で evidence を生成
   （メモリ上で抽出のみ。サーバ側ファイルには書かない）

3. judge.run() を呼び、加算別判定を生成
   ├─ regulatory_master/<service>.json を読み込み
   ├─ 各加算 × tenant_status の req_judgements を計算
   ├─ algorithm_judgement: clear / waiting / not_clear / unknown
   └─ evidence があれば applyEvidenceToJudgements()

4. inline JSON（tenant/staff/user_summary）が来ていれば
   dsl.evaluateRequirementLogic() で要件論理式を再評価
   ├─ buildFactsFromEvidence + mergeDemoTenantFacts
   ├─ buildFactsFromStaffData (service 別)
   ├─ buildFactsFromUserSummary
   └─ mergeRequirementFacts (receipt > tenant > staff > user)

5. dsl.buildEvidenceChecklist() で不足証跡リスト生成

6. markdown-report.renderMarkdown() で Markdown レポート生成

7. （/api/analyze のみ）Gemini に判定結果 + フォーム入力を渡し、
   レコメンドアクションを responseSchema 固定 JSON で取得

8. レスポンス組み立て → JSON で返却
```

### 1-3. データ永続化

**Cloud Run コンテナはステートレス**です。本ツールはユーザがアップロードしたファイル・分析結果を一切永続化しません。

- アップロードされた PDF / JSON はすべてメモリ上で処理（`multer.memoryStorage()`）
- 判定結果はレスポンスとしてのみ返却（Cloud Storage への保存等はなし）
- Gemini API へ送信されるテキストは Google 側のポリシーに準拠（[Gemini API のデータプライバシー](https://ai.google.dev/gemini-api/terms) 参照）

事業所単位で履歴を残したい場合は、別途 Firestore / Cloud SQL / GCS への保存層を追加してください（[8. カスタマイズ](#8-カスタマイズ) 参照）。

---

## 2. ディレクトリ構成

```
kasan-manager/
├── app/                       # Node.js アプリケーション
│   ├── bin/                   # CLI ツール（npm run scripts のターゲット）
│   │   ├── judge-kasan.js          # 加算判定 CLI（旧 judge_kasan.py 互換）
│   │   ├── import-receipt-pdf.js   # PDF→evidence 変換 CLI
│   │   ├── setup-gcp.js            # GCP 初期プロビジョニング
│   │   ├── setup-domain.js         # カスタムドメイン設定
│   │   ├── deploy-cloudrun.js      # Cloud Run デプロイ
│   │   ├── logs.js                 # Cloud Run ログ表示
│   │   └── smoke-test.js           # ポート済みコアロジックの 24 件テスト
│   ├── public/                # フロントエンド静的アセット
│   │   ├── index.html
│   │   ├── styles.css         # 18px ベースの大文字 UI
│   │   └── app.js             # フォーム送信・結果レンダリング
│   ├── src/
│   │   ├── server.js          # Express エントリ
│   │   ├── middleware/
│   │   │   ├── rate-limit.js  # IP 単位のレート制限（一般 / 高コスト の 2 段）
│   │   │   └── recaptcha.js   # Google reCAPTCHA v3 検証
│   │   └── services/
│   │       ├── analyzer.js
│   │       ├── dsl.js
│   │       ├── extractor.js
│   │       ├── gemini.js
│   │       ├── judge.js
│   │       ├── markdown-report.js
│   │       ├── receipt-pdf.js
│   │       └── regulator.js
│   ├── package.json           # アプリ実行 / CLI / デプロイ scripts
│   └── package-lock.json
├── regulatory_master/         # 加算マスタ JSON
│   ├── service_registry.json
│   ├── kaigo/                 # 介護保険 (6 サービス)
│   ├── medical/               # 医療保険 (1 サービス)
│   └── disability/            # 障害福祉 (3 サービス)
├── schemas/                   # JSON Schema 定義（参考用）
├── config/
│   └── evidence_labels.json   # 不足証跡チェックリストのラベル
├── tenant_data/               # DEMO テナントデータ（テスト用）
│   ├── demo_status/           # tenant_status.json サンプル
│   ├── demo_staff/            # staff.json サンプル
│   └── demo_user_summary/     # user_summary.json サンプル
├── docs/                      # 各種マニュアル
│   ├── DEPLOYMENT.md
│   ├── USER_GUIDE.md
│   ├── TECHNICAL.md
│   └── CLI.md
├── Dockerfile                 # Cloud Run 用イメージ
├── cloudbuild.yaml            # Cloud Build パイプライン
├── .dockerignore
├── .env.example
├── .gitignore
├── DESIGN_PHILOSOPHY.md       # 加算マネージャーの設計思想
├── package.json               # ルートのショートカット npm scripts
└── README.md
```

---

## 3. データモデル

### 3-1. 加算マスタ（`regulatory_master/<domain>/<service>.json`）

各サービスごとに加算定義 JSON を持つ。スキーマは `schemas/regulatory_master.schema.json` に定義。

主要フィールド:

```jsonc
{
  "_meta": {
    "service_key": "tsusho_kaigo",
    "display_name": "通所介護",
    "domain": "kaigo",            // kaigo | medical | disability
    "payer": "kaigo_hoken",
    "version": "2026.4",
    "revision_tag": "R6_2024_04",
    "effective_from": "2024-04-01",
    "source": "厚労省告示・通知...",
    "source_status": "implemented" // implemented / draft / source_required
  },
  "kasans": {
    "<kasan_key>": {
      "name": "中重度者ケア体制加算",
      "short_name": "中重度加算",
      "unit_per_day": 45,
      "service_codes": ["156271"],
      "category": "体制加算",
      "priority_hint": "取得価値大・要件ボーダー注意",
      "applicability": "applicable",  // not_applicable のときは判定対象外
      "requirements": { ... },        // 自然言語の要件定義
      "documents_required": [ ... ],
      "tips": [ ... ],
      "hourei_konkyo": "大臣基準告示 / 老企第36号",
      "requirement_logic": {           // alpha.5 で導入された機械評価ロジック
        "logic_status": "checked",     // checked / draft
        "operator": "all",
        "children": [
          { "operator": "any", "children": [
              { "type": "condition", "fact": "user_summary.care_level_3_or_higher_ratio", "op": ">=", "value": 0.30 },
              { "type": "condition", "fact": "tenant_status.kango_kaigo_2nin_kahai.status", "op": "==", "value": "clear" }
          ]},
          { "type": "condition", "fact": "tenant_status.kango_jikantai_haichi.status", "op": "==", "value": "clear" }
        ]
      }
    }
  }
}
```

### 3-2. 事業所ステータス（`tenant_data/demo_status/<office>/tenant_status.json`）

事業所ごとの要件確認進捗を記録するスキーマ:

```jsonc
{
  "office_code": "DEMO-0004",
  "service_key": "tsusho_kaigo",
  "facts": {                                    // DSL fact 形式（dotted key）
    "tenant_status.kango_kaigo_2nin_kahai.status": "clear",
    "tenant_status.kango_jikantai_haichi.status": "missing"
  },
  "evidence_metadata": { ... },
  "requirement_status": {                        // 旧形式（judge_kasan.py 互換）
    "kango_kaigo_2nin_kahai": { "status": "clear" }
  },
  "inquiry": {                                   // 確認待ち項目（オプション）
    "remaining_5_items": [
      { "id": "M1", "item": "看護職員の時間帯配置", "linked_kasan_req": "tsusho_kaigo.chujudosha_care_taisei.staff_continuous" }
    ]
  }
}
```

### 3-3. 職員集計（`tenant_data/demo_staff/<office>/staff.json`）

```jsonc
{
  "office_code": "DEMO-0004",
  "service_key": "tsusho_kaigo",
  "sample_policy": "public_demo_synthetic",   // ← 必須。これ以外は安全側で空 facts
  "staff": [
    {
      "staff_id": "DEMO-STAFF-001",
      "display_label": "架空職員A",
      "role": "kango",                         // kango | kaigo | helper | saseki | cm | shunin_cm | kinou_kunren | rihabilitation
      "qualifications": ["看護師"],
      "fte": 1.0,
      "active": true,
      "is_joukin": true
    }
  ]
}
```

### 3-4. 利用者集計（`tenant_data/demo_user_summary/<office>/user_summary.json`）

個別利用者ではなく**集計値**のみを持つ（PII を意図的に排除）。

```jsonc
{
  "office_code": "DEMO-0004",
  "service_key": "tsusho_kaigo",
  "sample_policy": "public_demo_synthetic",
  "data_source_type": "demo_aggregate",
  "users_total": 40,
  "care_level_3_or_higher_count": 27,
  "care_level_3_or_higher_ratio": 0.675,
  "care_level_distribution": {
    "youkaigo_1": 5, "youkaigo_2": 8, "youkaigo_3": 12, "youkaigo_4": 10, "youkaigo_5": 5
  }
}
```

### 3-5. evidence JSON（receipt-pdf 出力 / `tenant_data/evidence/...`）

```jsonc
{
  "_meta": { "schema": "evidence", "schema_version": "1.2", "office_code": "DEMO-0004", ... },
  "evidence": [{
    "evidence_id": "receipt_pdf_DEMO-0004_20260507103045",
    "service_key": "tsusho_kaigo",
    "extraction_version": "v2026.05.06-alpha.4.4-nodejs",
    "total_users_estimated": 5,
    "yokaigo_3plus_ratio": 0.6,
    "current_kasan_counts": { "nyuyoku_I": 5, "kobetsu_kinou_I_i": 5, ... },
    "extraction_confidence": "high",
    "service_code_mapping_status": "pattern_based_unverified",
    "pii_policy": { ... }
  }]
}
```

---

## 4. API リファレンス

### 4-1. `GET /api/health`

ヘルスチェック。フロントエンドはこのレスポンスを見て reCAPTCHA / レート制限の挙動を切り替えます。

**Response (200):**
```json
{
  "ok": true,
  "gemini_configured": true,
  "model": "gemini-2.5-flash",
  "node_env": "production",
  "timestamp": "2026-05-07T10:30:45.123Z",
  "rate_limit": {
    "enabled": true,
    "general_max": 60,
    "general_window_ms": 600000,
    "heavy_max": 10,
    "heavy_window_ms": 600000
  },
  "recaptcha": {
    "enabled": true,
    "site_key": "6LcXXXXXXXXXXXXXXXX",
    "min_score": 0.5
  }
}
```

### 4-2. `GET /api/services`

対応サービス一覧。

**Response (200):**
```json
{
  "services": [
    {
      "service_key": "tsusho_kaigo",
      "display_name": "通所介護",
      "domain": "kaigo",
      "domain_label": "介護保険",
      "payer": "kaigo_hoken",
      "status": "implemented",
      "status_label": "実装済み・本番判定可",
      "revision_tag": "R6_2024_04",
      "effective_from": "2024-04-01"
    },
    ...
  ]
}
```

### 4-3. `POST /api/judge`

決定的判定エンジンのみを実行（Gemini 不要・高速）。レート制限・reCAPTCHA の対象。

**Request:** `multipart/form-data`

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `service` | string | ✓ | サービスキー |
| `office_code` | string | | 事業所コード |
| `pdf` | file | | レセプト PDF |
| `tenant_status_json` | file | | 事業所ステータス JSON |
| `staff_json` | file | | 職員集計 JSON |
| `user_summary_json` | file | | 利用者集計 JSON |
| `recaptcha_token` | string | reCAPTCHA 有効時 | `grecaptcha.execute(siteKey, { action: 'judge' })` で取得したトークン（または `X-Recaptcha-Token` ヘッダで送信） |

**Response (200):**
```json
{
  "judge": {
    "service": "tsusho_kaigo",
    "service_def": { "display_name": "通所介護", ... },
    "master_meta": { "version": "2026.4", "revision_tag": "R6_2024_04", ... },
    "office_code": "DEMO-0004",
    "kasan_count": 13,
    "summary": {
      "clear": [...], "waiting": [...], "not_clear": [...], "unknown": [...]
    },
    "judgements": {
      "<kasan_key>": {
        "name": "中重度者ケア体制加算",
        "algorithm_judgement": "waiting",
        "requirements_judgement": { ... },
        "documents_required": [...],
        "tips": [...]
      }
    },
    "dsl_results": {
      "<kasan_key>": {
        "status": "blocked_by_missing_evidence",
        "satisfied_route": [...],
        "missing_evidence": [...],
        "notes": [...]
      }
    },
    "evidence_checklist": [
      { "kasan_name": "...", "label": "...", "priority": "高", "next_action": "..." }
    ],
    "executed_at": "2026-05-07T10:30:45"
  },
  "markdown": "# CareLinker 加算チェッカー 判定レポート\n\n..."
}
```

### 4-4. `POST /api/analyze`

判定エンジン + Gemini 補完分析。

**Request:** `multipart/form-data`

`/api/judge` のフィールドに加えて:

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `office_name` | string | | 事業所名 |
| `region` | string | | 所在地・地域単価 |
| `staff_summary` | string | | 自由入力の職員構成 |
| `user_summary` | string | | 自由入力の利用者構成 |
| `current_kasans` | string | | 現在算定中の加算 |
| `concerns` | string | | 気になっている加算 |
| `attachments[]` | file × N | | 参考ファイル（最大 5） |
| `use_gemini` | string | | `0` で Gemini をスキップ |

**Response (200):**
```json
{
  "service": { "key": "...", "display_name": "...", "domain": "kaigo" },
  "judge": { ... },          // /api/judge と同じ
  "markdown": "...",
  "gemini": {
    "model": "gemini-2.5-flash",
    "analysis": {
      "summary": "...",
      "estimated_total_revenue_increase": "月+約30万円 / 年+約360万円",
      "top_actions": [...],
      "candidates": [...],
      "cautions": [...],
      "assumptions": [...]
    }
  }
}
```

### 4-5. エラーレスポンス（共通）

レート制限 / reCAPTCHA / バリデーション失敗時のステータスコードと JSON 形式:

| HTTP | `error` コード | 説明 |
|---|---|---|
| `400` | `recaptcha_missing` | `recaptcha_token` が送信されていない（reCAPTCHA 有効時のみ） |
| `403` | `recaptcha_failed` | siteverify が `success: false` |
| `403` | `recaptcha_action_mismatch` | トークンの `action` が想定と異なる |
| `403` | `recaptcha_low_score` | スコアが `RECAPTCHA_MIN_SCORE` 未満 |
| `413` | （error 文字列） | アップロード ファイル サイズ超過 |
| `429` | `rate_limit_exceeded` | レート上限超過。`retry_after_seconds` を含む |
| `503` | `recaptcha_unavailable` | siteverify への接続失敗 |

**例: 429 レスポンス**
```json
{
  "error": "rate_limit_exceeded",
  "message": "AI 分析レート制限: アクセスが集中しています。しばらく時間をおいてから再度お試しください。",
  "retry_after_seconds": 60
}
```

レスポンスヘッダには `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` （RFC draft-7）が常に付与されます。

### 4-6. `POST /api/import-receipt`

レセプト PDF → evidence JSON 変換のみ。

**Request:** `multipart/form-data`

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `service` | string | ✓ | サービスキー |
| `office_code` | string | | 事業所コード |
| `pdf` | file | ✓ | レセプト PDF |

**Response (200):**
```json
{
  "evidence": {
    "_meta": { ... },
    "evidence": [{ ... }]
  }
}
```

---

## 5. DSL 要件論理式

加算の充足判定ロジックを JSON で表現します。`requirement_logic.logic_status === "checked"` のものだけが機械評価対象です。

### 5-1. ノード型

| `operator` / `type` | 説明 |
|---|---|
| `all` | 全ての子ノードが `clear` のとき `clear`（AND） |
| `any` | 1 つでも子ノードが `clear` なら `clear`（OR） |
| `condition` （または `fact` を直接持つ） | リーフ。`fact` パスから値を取得して `op` で比較 |

### 5-2. 比較演算子（`op`）

| op | 説明 |
|---|---|
| `==` `!=` `>` `>=` `<` `<=` | 数値・文字列比較 |
| `exists` `not_exists` | fact が存在するか |
| `in` `not_in` | 配列メンバ判定 |
| `bool_true` `bool_false` | 真偽値判定 |

### 5-3. fact path の名前空間

```
receipt_pdf.<key>           # PDF 抽出結果
tenant_status.<req>.<field> # 事業所ステータス
staff_summary.<key>         # staff.json から計算
user_summary.<key>          # user_summary.json から計算
```

### 5-4. 評価結果ステータス

| status | 説明 |
|---|---|
| `clear` | 全ての要件を充足 |
| `not_clear` | いずれかの要件で確定的に未達 |
| `partially_clear` | 一部達成・一部証跡不足 |
| `blocked_by_missing_evidence` | 評価可能だが必要な fact が無い |
| `blocked_by_unverified_mapping` | サービスコード照合未確認のため保留 |
| `not_evaluated_source_required` | マスタの公式根拠未確認 |
| `not_evaluated_logic_unchecked` | DSL ロジック未確認 |
| `not_applicable` | 公式根拠で対象外確定 |
| `unknown` | DSL 未登録または評価不能 |

### 5-5. 例: 中重度者ケア体制加算

```json
{
  "logic_status": "checked",
  "operator": "all",
  "children": [
    {
      "operator": "any",
      "label": "要介護3以上30%以上",
      "children": [
        {
          "type": "condition",
          "fact": "receipt_pdf.yokaigo_3plus_ratio",
          "op": ">=",
          "value": 0.30
        },
        {
          "type": "condition",
          "fact": "user_summary.care_level_3_or_higher_ratio",
          "op": ">=",
          "value": 0.30
        }
      ]
    },
    {
      "type": "condition",
      "fact": "tenant_status.kango_kaigo_2nin_kahai.status",
      "op": "==",
      "value": "clear",
      "label": "看護・介護職員2名以上加配"
    },
    {
      "type": "condition",
      "fact": "tenant_status.kango_jikantai_haichi.status",
      "op": "==",
      "value": "clear",
      "label": "サービス提供時間帯を通じて専従看護職員1名以上配置"
    }
  ]
}
```

---

## 6. レセプト PDF 抽出

### 6-1. 対応サービス

| サービス | サービスコードプレフィックス | 抽出パターン数 |
|---|---:|---:|
| 通所介護 | 15 | 12 |
| 訪問介護 | 11 | 13（+ 5 サービス区分・3 時間帯） |
| 居宅介護支援 | 43 | 21 |
| 訪問看護（介護保険） | 13 | 20 |

### 6-2. 抽出パターン

`app/src/services/receipt-pdf.js` の `*_KASAN_PATTERNS` を参照。各エントリは `[kasan_key, display_name, service_code, match_name]` の 4 タプルで、`service_code` または `match_name` に部分一致したらカウントします。

### 6-3. PII 非保存ポリシー

被保険者番号・氏名・住所・電話番号・生年月日は **意図的に抽出しません**。evidence JSON には集計値（要介護度分布・サービスコード件数・要介護3以上比率）のみを記録します。

### 6-4. 信頼度

```
high   : 要介護度カバレッジ ≥ 80% かつ 加算 ≥ 3 種別
medium : 要介護度カバレッジ ≥ 50%
low    : それ以下
none   : 抽出対象なし
```

### 6-5. サービスコードマッピング状態

`service_code_mapping_status: pattern_based_unverified` の evidence は、DSL 評価で `mapping 依存条件` を `blocked_by_unverified_mapping` として保留扱いにします。これは社内資料ベースのパターン推定であり、公式サービスコード表との完全照合は継続更新対象です。

---

## 7. Gemini プロンプト設計

`app/src/services/analyzer.js` で組み立て。

- **System prompt**: 介護保険・障害福祉の加算分析エキスパートとして振る舞わせ、「取れない」で終わらせず代替ルートを示すよう指示
- **User prompt**: 判定エンジン結果（buckets, dsl_results, evidence）+ フォーム入力 + 添付ファイル抜粋 + 加算マスタの要約を渡す
- **Response schema**: `summary` / `top_actions` / `candidates` / `cautions` / `assumptions` を JSON Schema で固定（`responseMimeType: application/json` + `responseSchema`）

モデル選択は `.env` の `GEMINI_MODEL`（デフォルト `gemini-2.5-flash`）。`gemini-2.5-pro` で精度向上、`gemini-2.5-flash-lite` でコスト削減が可能です。

---

## 8. カスタマイズ

### 8-1. 新しいサービスを追加する

1. `regulatory_master/<domain>/<service>.json` を新規作成
2. `regulatory_master/service_registry.json` の `services` に追加
3. PDF 取込 が必要なら `app/src/services/receipt-pdf.js` の `SERVICE_PATTERNS` にエントリ追加
4. `npm run test:smoke` で smoke test を流す
5. CLI で動作確認: `npm run judge -- --service <new_service_key>`

### 8-2. UI のテーマ変更

`app/public/styles.css` 冒頭の CSS 変数:

```css
:root {
  --font-base: 18px;     /* 文字サイズ拡大可能 */
  --accent: #1d6fdc;     /* メインカラー */
  --bg: #f5f7fb;
}
```

### 8-3. 認証を追加する

#### IAP（Identity-Aware Proxy）

[DEPLOYMENT.md § 6-1](./DEPLOYMENT.md#6-1-アクセス制御) 参照。Cloud Run + LB 経由で IAP を有効化、Google アカウントベースで認可。

#### Firebase Authentication

```bash
npm install firebase-admin --prefix app
```

`app/src/middleware/auth.js`:

```js
import admin from 'firebase-admin';

admin.initializeApp({ credential: admin.credential.applicationDefault() });

export async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}
```

`app/src/server.js` で `/api/*` に適用。

### 8-4. 履歴永続化（Firestore 例）

```bash
npm install @google-cloud/firestore --prefix app
```

`app/src/services/history.js`:

```js
import { Firestore } from '@google-cloud/firestore';
const db = new Firestore();

export async function saveAnalysis({ tenant, result }) {
  await db.collection('analyses').add({
    tenant_id: tenant,
    result_summary: result.judge?.summary,
    executed_at: result.judge?.executed_at,
  });
}
```

ステートフルになるので Cloud Run のサービスに `--service-account` を別途付与し、Firestore IAM を許可してください。

### 8-5. アップロード上限の変更

`.env`:

```
MAX_UPLOAD_BYTES=52428800   # 50MB
```

加えて Cloud Run の `--memory` 設定も増やす必要があります（PDF 解析中はメモリ消費が増えます）:

```
CLOUD_RUN_MEMORY=2Gi
```

### 8-6. ログ出力フォーマット

現状は `console.log` ベース。構造化ログ（Cloud Logging の jsonPayload）にしたい場合は `app/src/server.js` を `pino` 等に置き換えます。

---

## 9. 開発・デバッグ

### 9-1. ローカル開発

```bash
npm run install:app
npm run dev    # node --watch で自動リロード
```

`http://localhost:8080` でアクセス。`.env` の `GEMINI_API_KEY` で実 API を叩きます。

### 9-2. テスト

```bash
npm run test:smoke   # 24 件のコアロジック検証
```

`bin/smoke-test.js` を直接編集して追加可能。

### 9-3. CLI で再現テスト

```bash
npm run judge -- --service tsusho_kaigo --office DEMO-0004 \
  --tenant-status tenant_data/demo_status/DEMO-0004/tenant_status.json \
  --staff-data    tenant_data/demo_staff/DEMO-0004/staff.json \
  --user-summary  tenant_data/demo_user_summary/DEMO-0004/user_summary.json \
  --report-md /tmp/test_report.md \
  --json       /tmp/test_result.json
```

### 9-4. PDF パターン追加時の検証

```bash
echo "テスト用テキスト" > /tmp/sample.txt
npm run import-receipt -- --service tsusho_kaigo --office TEST \
  --sample-text /tmp/sample.txt --evidence-out /tmp/test_evidence/
```

---

## 10. 既知の制約

| 制約 | 詳細 | 回避策 |
|---|---|---|
| サービスコード照合は暫定 | `pattern_based_unverified` 状態で公式コード表との完全一致は未検証 | DSL は `blocked_by_unverified_mapping` で保留扱い。本番運用前に各事業所のレセプトで検証 |
| 障害福祉サービスは draft | 代表加算のみマスタ化、要件ロジック DSL 未登録 | Gemini 補完分析で制度知識を活用。マスタ整備は順次対応予定 |
| PDF 抽出は帳票形式依存 | 介護ソフト・自治体差異により精度が変動 | `extraction_confidence` を確認し、`low` の場合は人手確認を推奨 |
| ステートレス | サーバ側で履歴永続化なし | カスタマイズで Firestore 等を追加（[8-4](#8-4-履歴永続化firestore-例)） |
| 同時実行は Cloud Run の concurrency に依存 | デフォルト concurrency = 80 | `--concurrency` オプションで調整 |

---

## 関連ドキュメント

- [USER_GUIDE.md](./USER_GUIDE.md) — Web UI の使い方
- [DEPLOYMENT.md](./DEPLOYMENT.md) — Cloud Run + カスタムドメイン デプロイ
- [CLI.md](./CLI.md) — コマンドラインツール
- [DESIGN_PHILOSOPHY.md](../DESIGN_PHILOSOPHY.md) — 設計思想・知識グラフ構造
