# 加算マネージャー Web 版

> 介護保険・障害福祉の **加算（報酬加算）取得を AI で支援する** Web アプリです。
> 事業所の情報・レセプト PDF・職員/利用者集計をブラウザからアップロードすると、
> 取り漏れの可能性が高い加算と「どうすれば取れるか」を返します。

- **稼働環境**: Google Cloud Run（カスタムドメイン運用前提）
- **AI**: Google Gemini API
- **判定エンジン**: マスタ JSON + 要件論理式 DSL（Node.js）
- **対応分野**: 介護保険（通所/訪問/居宅介護支援/訪問看護）、医療保険（訪問看護）、障害福祉（居宅介護/就労継続支援 A 型/B 型）

---

## 5 分でデプロイ

```bash
# 1. リポジトリ取得
git clone <repository-url>
cd kasan-manager

# 2. .env を作成して値を埋める（GEMINI_API_KEY と GCP 関連のみで OK）
cp .env.example .env
# 編集: GEMINI_API_KEY / GCP_PROJECT_ID / CLOUD_RUN_CUSTOM_DOMAIN

# 3. 依存パッケージ
npm run install:app

# 4. gcloud 認証
gcloud auth login
gcloud auth application-default login

# 5. プロビジョニング（API 有効化・Artifact Registry・IAM 付与）
npm run setup:gcp

# 6. デプロイ（.env の GEMINI_API_KEY を Cloud Run の環境変数として渡します）
npm run deploy:cloudrun

# 7. カスタムドメイン
npm run setup:domain -- --domain=kasan.example.jp
# → 表示された CNAME / A レコードを DNS に登録
# → 5〜60 分で証明書発行 → https://kasan.example.jp で公開
```

> ℹ **`GEMINI_API_KEY` は `.env` で一元管理**。Cloud Run へのデプロイ時に
> `gcloud run deploy --set-env-vars=GEMINI_API_KEY=...` で渡されます。Secret Manager は不要です
> （高セキュリティ要件の場合は opt-in 可能。[DEPLOYMENT.md](./docs/DEPLOYMENT.md#8-secret-manager-連携opt-in) 参照）。

詳細は [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) を参照。

---

## マニュアル一覧

| 対象 | ファイル | 内容 |
|---|---|---|
| 事業所スタッフ・管理者 | [docs/USER_GUIDE.md](./docs/USER_GUIDE.md) | Web UI の使い方・結果の読み方 |
| インフラ担当 | [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | GCP プロビジョニング・Cloud Run・カスタムドメイン・運用 |
| 開発者 | [docs/TECHNICAL.md](./docs/TECHNICAL.md) | アーキテクチャ・API・データモデル・カスタマイズ |
| 開発者 | [docs/CLI.md](./docs/CLI.md) | CLI コマンド一覧（judge / import-receipt / setup / deploy / logs） |
| 設計思想 | [DESIGN_PHILOSOPHY.md](./DESIGN_PHILOSOPHY.md) | 加算チェッカーの 5 つの設計原則・知識グラフ構造 |

---

## 主要機能

### 1. AI 補完分析（`POST /api/analyze`）

ブラウザから事業所情報を入力 → 判定エンジンで加算別ステータスを生成 → Gemini で「取り方アクション」「OR 条件」「代替ルート」を補完 → 構造化 JSON で返却。

### 2. 決定的判定エンジン（`POST /api/judge`）

Gemini 不要。マスタ JSON + 要件論理式 DSL のみで加算を `clear / waiting / not_clear / unknown` に分類。Markdown レポートも同時生成。

### 3. レセプト PDF 取込（`POST /api/import-receipt`）

介護給付費明細書 PDF からサービスコード・要介護度分布・算定中加算を機械抽出（個人情報は意図的に非保存）。

### 4. CLI ツール

```bash
npm run judge -- --service tsusho_kaigo --office DEMO-0004 --report-md out.md
npm run import-receipt -- --service tsusho_kaigo --office DEMO-0004 --pdf receipt.pdf --evidence-out tenant_data/evidence/DEMO-0004/
```

---

## 対応サービス（10 種）

| ドメイン | サービス | 状態 |
|---|---|---|
| 介護保険 | 通所介護 | ✅ implemented |
| 介護保険 | 訪問介護 | ✅ implemented |
| 介護保険 | 居宅介護支援 | ✅ implemented |
| 介護保険 | 訪問看護（介護保険） | ✅ implemented |
| 介護保険 | 小規模多機能型居宅介護 | 🟡 draft |
| 介護保険 | 特別養護老人ホーム | ⏳ planned |
| 医療保険 | 訪問看護（医療保険） | 🟡 draft |
| 障害福祉 | 居宅介護 | 🟡 draft（代表加算マスタ化済） |
| 障害福祉 | 就労継続支援 A 型 | 🟡 draft（代表加算マスタ化済） |
| 障害福祉 | 就労継続支援 B 型 | 🟡 draft（代表加算マスタ化済） |

---

## アーキテクチャ概略

```
Browser → Cloud Run (Node.js + Express)
              │
              ├─ 判定エンジン (judge.js + dsl.js)
              ├─ PDF 抽出 (receipt-pdf.js)
              ├─ Markdown レポート (markdown-report.js)
              └─ Gemini 補完 (analyzer.js → gemini.js)
                        │
                        ▼
                Google Gemini API
```

詳細: [docs/TECHNICAL.md](./docs/TECHNICAL.md)

---

## ライセンス

UNLICENSED（ケア・プランニング株式会社・東京都荒川区）

> ⚠️ **本ツールは加算算定可否を法的に保証するものではありません。** 取得候補・確認待ち項目・必要書類・増収目安を提示する**支援ツール**です。実際の届出・算定は所管自治体の指導課・社労士・行政書士にご確認ください。
