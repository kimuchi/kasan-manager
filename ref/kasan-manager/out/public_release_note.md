# CareLinker 加算チェッカー リリースノート

**バージョン**: v2026.05.06-alpha.5.3
**リリース種別**: 限定外販MVP / 公開デモ版（public_demo_release_pack 整備済）
**ステータス**: MVP α5.3（DEMO 職員データブリッジMVP・staff_summary facts導入・不足証跡チェックリストに「次アクション」列追加）

> 本バージョンの公開可能なドキュメント一式は `releases/public/v2026.05.06-alpha.5.3/` 配下にまとまっています。営業デモは同梱の `DEMO_SCRIPT.md` をご利用ください。本ツールは**算定可否を法的に保証するものではなく**、公式根拠確認済み要件に対する機械的な充足推定を提示します。最終確認は事業所資料・届出状況・自治体確認が必要です。

---

## MVP版リリースのお知らせ

CareLinker 加算チェッカーの **MVP α5.3** を公開します。本バージョンはα5.2 に **DEMO用の架空 staff.json** を接続し、職員資格・常勤換算・看護職員配置などを `staff_summary.*` factsとして要件DSLに供給できるようにしました。これにより `tenant_status` 単独では `blocked_by_missing_evidence` だった条件が職員データ集計から代替ルートで `clear` できる場面が増えます。実事業所データではなく、すべて公開デモ用の架空サンプルです。

### α5.3 での主な改善点

- **公開デモ用の架空職員サマリ4件追加** — DEMO-0004/0005/0006/0007 各サービス用（氏名・住所・電話・給与・生年月日は含まない）
- **`build_facts_from_staff_data()` 導入** — staff.json から `staff_summary.*` 集計値を21項目算出（訪問介護8 / 通所介護6 / 訪問看護4 / 居宅介護支援3）
- **`merge_requirement_facts()` 導入** — `receipt_pdf > tenant_status > staff_summary` の優先順位でマージ。`staff_summary.*` キーは他名前空間を**侵犯不可**（テストで保護）
- **`judge_kasan.py --staff-data` オプション追加** — DEMO staff.json を指定すると要件DSLにstaff_summary factsが反映される
- **「👥 職員データ連携（DEMO alpha）」セクション追加** — レポートに**集計値のみ**（個別の氏名・staff_id・資格詳細は表示しない設計）
- **既存DSLにstaff_summary代替ルート追加**:
    - 訪問介護 特定事業所加算(Ⅰ): 介護福祉士比率(A:30%/B:50%) と 上乗せ配置 を tenant_status と staff_summary の **any** に拡張
    - 通所介護 中重度者ケア体制加算: 看護・介護職員2名以上加配 を tenant_status と staff_summary.kango_kaigo_total_fte の **any** に拡張
    - 訪問看護(介護保険) 緊急時Ⅱ: 既存維持（要件は届出/24h体制/担当看護師指定で staff_summary は補強要素にしない方針）
- **不足証跡チェックリストに「次アクション」列追加** — `config/evidence_labels.json` に `next_action` フィールド・`default_next_action` を追加
- **公開デモ専用ガード** — `sample_policy != "public_demo_synthetic"` の staff データには空辞書を返し、本番運用時は `staff_summary.*` を勝手に組み立てない安全側設計
- **テスト追加** — `tests/test_staff_facts.py`（14テスト・PII保護・名前空間侵犯保護・公開セクションでの個人情報非露出・--staff-data あり/なし両系の動作確認）

### α5.2 での主な改善点

- **DEMO用 tenant_status 4件追加** — DEMO-0004/0005/0006/0007 各サービス用（公開デモ用の架空サンプル）
- **DSL fact builder拡張** — `merge_demo_tenant_facts` で tenant_status をfactsに統合（receipt_pdf.* は上書き禁止の優先順位）
- **`judge_kasan.py --tenant-status` オプション追加** — 指定でDEMO factsをDSL評価に反映
- **「missing」「unknown」「waiting」「null」値を blocked_by_missing_evidence として扱う** — DEMO設計の証跡未整備状態を自然に表現
- **🧾 不足証跡チェックリスト（alpha）セクション追加** — レポート末尾に「加算 / 不足証跡 / 推奨確認資料 / 優先度」を表形式で表示
- **evidence label辞書追加** — `config/evidence_labels.json` で内部fact pathを公開向け日本語labelに変換（19項目登録）
- **DEMO架空サンプル明記** — チェックリストセクション冒頭に「DEMO用の架空tenant_statusを使用。実事業所データではありません」を表示
- **not_applicable はチェックリストに含めない安全弁** — 対象外加算が確認作業候補に混入しない

### α5.1 での主な改善点（継続）

- **pattern_based_unverified 安全弁の精緻化**:
    - サービスコード依存fact（current_kasan_counts/detected_claim_status/service_code/claim_item_code/claimed_units）は mapping未確認時に **`blocked_by_unverified_mapping`** で保留
    - サービスコード非依存fact（yokaigo_3plus_ratio/total_users_estimated/extraction_confidence/tenant_status等）は警告note付きで評価可能
    - condition に `depends_on_service_code_mapping` の明示フィールドを追加（trueで強制保留・falseで強制評価）
- **新status `blocked_by_unverified_mapping` 追加** — レポートでは「🔒 サービスコード照合未完了のため保留」と表示
- **既存4サービスの主要加算へDSL少数展開**:
    - 訪問介護: **特定事業所加算(Ⅰ)** に重度者要件A or B（要介護4-5/認知症Ⅲ20% or 看取り期1人以上）等のOR条件含む大規模ロジック追加
    - 通所介護: **中重度者ケア体制加算** に PDF evidence (yokaigo_3plus_ratio≥30%) + tenant_status 加配・時間帯配置の3条件all
    - 居宅介護支援: **初回加算** に新規ケアプラン作成 AND (新規認定 or 区分変更) のネスト条件
    - 訪問看護(介護保険): 緊急時Ⅱ既存維持（追加なし）
- **DSL評価結果の強化**:
    - `mapping_held_conditions` 配列追加（保留条件の可視化）
    - レポートに「注意」列追加（mapping保留 / pattern_based_unverified 警告）
- **テスト拡張**:
    - mapping依存fact + pattern_based_unverified → blocked_by_unverified_mapping
    - depends_on_service_code_mapping 明示テスト
    - mapping保留 + clear 混在で partially_clear 集約

### α5 での主な改善点（継続）

- **要件論理式DSL MVP導入** — JSONベースのDSLで AND / OR / ネスト条件を評価可能に
- **`scripts/requirement_dsl.py` 新設** — DSL evaluator（11テスト全PASS）
- **judge_kasan.py に「要件ロジック評価（alpha）」セクション追加** — PDF検出と要件評価を分離表示・達成ルート・不足証跡を可視化
- **applicability=not_applicable の安全弁強化** — 対象外加算が改善候補・収益機会・PDF算定中検出に混入しない
- **複数の安全弁実装**:
    - source_status != checked → `not_evaluated_source_required`
    - logic_status != checked → `not_evaluated_logic_unchecked`
    - applicability=not_applicable → `not_applicable`
    - factなし → `blocked_by_missing_evidence`
    - PDF未検出 → 未算定扱いしない
- **公式根拠確認済みの要件のみ評価** — pattern_based_unverifiedの場合は注記表示
- **訪問看護(介護保険)の緊急時訪問看護加算(II)に実例DSL追加** — 届出済 AND 24時間連絡体制 AND 担当看護師指定の3条件all評価

### α4.5 での主な改善点（継続）

- **訪問看護（介護保険）の source_required 残3件を解消**
    - **複数名訪問看護加算** → checked 昇格（Ⅰ/Ⅱ × 30分未満/30分以上の4区分・+254/+402/+201/+317単位）
    - **長時間訪問看護加算** → checked 昇格（+300単位・1時間30分以上）
    - **認知症専門ケア加算** → checked（訪問看護では算定対象外と確定・他サービス専用）
- **公式根拠を明記** — 各加算に `source_document` `source_url` `source_checked_date` を追加
- **service_registry 整合更新** — source_required: false / source_required_count: 0 / implemented_scope: "all_kasans_checked"
- **訪問看護（介護保険）が implemented 4サービスで初の完全checked到達**

### α4.4 での主な改善点（継続）

- **訪問看護（介護保険）PDF取込の初期対応** — `houmon_kango_kaigo` を `SERVICE_PATTERNS` に追加
- **implemented 4サービス全てがPDF診断対応** — 通所介護・訪問介護・居宅介護支援・訪問看護（介護保険）
- **訪問看護の算定中加算推定抽出** — 緊急時Ⅰ/Ⅱ・特別管理Ⅰ/Ⅱ・ターミナル・看護体制強化Ⅰ/Ⅱ・サ提体制Ⅰ/Ⅱ・退院時共同指導・看介連携・口腔連携・LIFE・初回Ⅰ/Ⅱ・処遇改善（R8.6新規対象）
- **医療保険版訪問看護とは厳密分離** — `houmon_kango_iryo` は `SERVICE_PATTERNS` に含めず、PDF取込対象外として警告
- **source_required 残3件の取り扱い** — 複数名訪問看護加算 / 長時間訪問看護加算 / 認知症専門ケア加算 はPDFで文字列検出時のみcountするが、要件・単位は推測しない
- **共通evidence設計（継続）** — 4サービス全て同じJSON構造で運用統一
- **個人情報を保存しない設計（継続）** — 被保険者番号・氏名・住所・電話番号は意図的に非抽出
- **PDF検出は要件充足を保証しない方針（継続）**
- **PDF未検出は未算定を意味しない方針（継続）**
- **公開サンプルの外部向け表現調整** — `pattern_based_unverified` を「暫定パターンによる推定（公式サービスコード表との完全照合は継続更新対象）」へ言い換え

### α4.3 での主な改善点（継続）

- **居宅介護支援PDF取込の初期対応** — `kyotaku_shien` を `SERVICE_PATTERNS` に追加
- **居宅介護支援の算定中加算推定抽出** — 居宅介護支援費(I)/(II)・初回・入院時情報連携Ⅰ/Ⅱ・退院退所Ⅰ-Ⅲ・通院時情報連携・緊急時居宅カンファレンス・ターミナルケアマネジメント・特定事業所加算Ⅰ-Ⅳ-A・医療介護連携・処遇改善
- **特定事業所加算Ⅰ-Ⅳ-AのPDF検出対応** — 検出してもclearにせず`claimed_but_requirements_unknown`で表示
- **入院時情報連携・退院退所・ターミナル等の検出対応** — 個別加算の算定実態を把握
- **40%要件はPDFだけでは確定しない方針** — 居宅介護支援(I)の要介護3以上40%要件は地域包括紹介除外が必要。`raw_yokaigo_3plus_ratio` として参考値のみ保存し、要件用の `yokaigo_3plus_ratio` は `None` として要件clearに使用しない
- **サービスコード根拠管理の追加** — `service_code_mapping_status` (checked/pattern_based_unverified/source_required)・`service_code_mapping_source`・`pattern_confidence_note`をevidence JSONに追加
- **通所/訪問/居宅の共通evidence設計** — 同じJSON構造で運用統一
- **個人情報を保存しない設計（継続）** — 被保険者番号・氏名・住所・電話番号は意図的に非抽出
- **PDF検出は要件充足を保証しない方針（継続）**

### α4.2 での主な改善点（継続）

- **訪問介護PDF取込の初期対応** — `houmon_kaigo` を `SERVICE_PATTERNS` に追加
- **訪問介護の算定中加算推定抽出** — 特定事業所加算Ⅰ-Ⅴ・初回・緊急時・生活機能向上連携・口腔連携・認知症専門ケア・処遇改善
- **特定事業所加算Ⅰ〜ⅤのPDF検出対応** — 検出してもclearにせず`claimed_but_requirements_unknown`で表示
- **サービス区分・時間帯の集計** — 身体介護・生活援助・身体生活・通院乗降・2人介護 / 早朝・夜間・深夜
- **通所介護PDF取込との共通evidence設計** — 同じJSON構造・同じpii_policyで運用統一
- **個人情報を保存しない設計（継続）** — 被保険者番号・氏名・住所・電話番号は意図的に非抽出
- **PDF検出は要件充足を保証しない方針（継続）** — 「算定中の推定」「未検出≠未算定」を全レポートに明記
- **alpha.4 表記ズレの統一修正** — `extraction_version` / public sample / public_release_note / README を `v2026.05.06-alpha.5.2` に統一

### α4.1 での主な改善点（継続）

- **`judge_kasan.py --receipt-pdf` の実動作化** — 内部で抽出→evidence生成→保存→判定反映までワンコマンドで完結
- **PDF検出結果の表示改善** — 「PDFで算定中として検出」を主語にし、「うち要件確認済」「うち要件未確認」を分離表示
- **合成PDFによる動作確認** — `tests/fixtures/tsusho_receipt_sample.pdf`（reportlab生成・個人情報なし）で抽出ロジックを検証可能
- **PDF検出は要件充足を保証しない旨の明確化** — レポート冒頭に「算定中の推定」「未検出≠未算定」「個人情報非保存」を明記
- **evidence JSON フィールド追加** — `detected_claim_status` / `detection_scope` / `not_detected_policy` / `requirement_policy` を追加し意味を明確化
- **`import_receipt_pdf.py` の関数化** — `analyze_text` / `analyze_pdf` / `build_evidence` / `save_evidence` / `run_extraction` を judge_kasan.py から再利用可能に

### α4 での主な改善点（継続）

- **通所介護PDF取込パイプラインの初期実装** — `scripts/import_receipt_pdf.py` を新規追加
- **現在算定中加算の自動抽出** — サービスコード・要介護度分布・加算名から `current_kasan_counts` を生成
- **evidence JSON 保存** — `tenant_data/evidence/<office_code>/receipt_pdf_<timestamp>.json`
- **個人情報を保存しない設計** — 被保険者番号・氏名・住所・電話番号は意図的に抽出・保存しない。集計値・統計値のみ
- **PDF未検出を未算定とは断定しない方針** — 抽出ロジック未対応や様式違いの可能性を考慮
- **judge_kasan.py に `--evidence` `--apply-evidence` オプション追加** — 算定中加算を `currently_claimed` / `claimed_but_requirements_unknown` で表示
- **抽出信頼度（high/medium/low/none）の自動算定** — 要介護度カバー率と加算検出数から判定

**alpha.4時点ではPDF取込は通所介護のみ対応**。訪問介護・居宅介護支援・訪問看護は次工程で順次対応します。

### α3.1 での改善点（継続）

- **処遇改善加算の届出期限を分離記載**
    - 体制届出：原則 **2026-05-15**（前月15日）
    - 処遇改善計画書：**2026-06-15**
    - 自治体（指定権者）により柔軟運用があり得るため、必ず指定権者への確認が必要
- **初回加算 Ⅰ/Ⅱ の checked 昇格** — 令和6年度改定資料に基づき以下を実装
    - 初回加算(Ⅰ) 350単位/月（退院日に初回訪問）
    - 初回加算(Ⅱ) 300単位/月（退院日翌日以降に初回訪問）
    - Ⅰ/Ⅱは併算定不可
- **source_required の残置3件を明示** — 複数名訪問看護加算 / 長時間訪問看護加算 / 認知症専門ケア加算（介護保険版の単位数・適用可否は公式告示確認待ち）
- **service_registry の表記精緻化** — `source_required: true` / `source_required_count: 3` / `implemented_scope: "major_kasans_checked_partial_source_required"` を追加し「全加算完全確認済み」に見えないよう修正
- **verification_status の用語整理** — 加算レベルは `checked / legally_reviewed / source_required` に統一、`implemented` はサービスレベルの status のみで使用

### α3 での主な改善点（継続）

- **訪問看護（介護保険）の implemented 化** — 加算13件・減算2件を社内法令資料に基づき実装
- **令和8年6月臨時改定の反映** — 訪問看護にも処遇改善加算（1.8%）が新規適用、届出期限 2026-06-15 を明示
- **令和6年度改定の反映** — 緊急時訪問看護加算Ⅰ（新設・600単位）／ターミナルケア加算引き上げ（2,500単位）／PT・OT・ST減算（8単位＋12か月超5単位）
- **判定エンジンは既存実装で対応** — judge_kasan.py 改修なしで houmon_kango_kaigo を処理可能

### α2 → α3 の継続改善点

- 1ページ目に結論サマリ
- すぐ確認すべき項目TOP5
- unknown の5分類化
- 増収見込みの数値化
- 今月やること
- 法的免責の明記

---

## 現在対応サービス（implemented）

| サービス | ドメイン | 加算数 | マスタ版 |
|---|---|---:|---|
| 訪問介護 | 介護保険 | 13 | 2026.4 (R6_2024_04) |
| 居宅介護支援 | 介護保険 | 18 | 2026.6 (R6_2024_04 + 2026_06_shougu) |
| 通所介護 | 介護保険 | 12 | 2026.4 (R6_2024_04) |
| **訪問看護（介護保険）** | 介護保険 | 15 checked ＋ 3 source_required | v2026.05.06-alpha.5.3 (R6_2024_06_plus_2026_06_shougu_alpha3_1) |

訪問看護（介護保険）は令和6年度介護報酬改定資料に基づき実装（2026-03-24時点の根拠を反映）。15加算は `checked`、3加算（複数名訪問看護加算／長時間訪問看護加算／認知症専門ケア加算）は介護保険版の単位数・適用可否確認待ちのため `source_required` で残置しています。

**訪問看護の医療保険版（訪問看護療養費）は別管理で準備中**です。介護保険版とは制度体系が異なるため、混同しないようご注意ください。

---

## 順次対応予定サービス（draft / planned）

| サービス | ドメイン | ステータス |
|---|---|---|
| 訪問看護（医療保険） | 医療保険 | draft（準備中） |
| 小規模多機能型居宅介護 | 介護保険 | draft |
| 特別養護老人ホーム | 介護保険 | planned |
| 居宅介護（障害福祉） | 障害福祉 | draft |
| 就労継続支援A型 | 障害福祉 | draft |
| 就労継続支援B型 | 障害福祉 | draft |

---

## できること

- 加算マスタ（法令要件・単位・必要書類）と事業所固有データ（職員配置・確認待ち・回答履歴）を分離して管理
- 加算ごとに「✅ 取得済 / ⏸ 確認待ち / ❌ 対象外 / ❔ 情報不足」を判定
- 取得可能性が高い加算と確認待ち項目をMarkdownレポートで出力
- 必要書類のチェックリスト・追加確認すべき職員/利用者情報を自動抽出
- 増収目安（40名想定の超概算）を年間金額で提示
- 法令改定をrevision_tag + verification_status（unverified/checked/legally_reviewed）で管理
- 令和8年度改定・処遇改善加算等の継続更新対象として運用

---

## まだできないこと

- ネストした論理式（OR-AND-OR）の自動評価 → 一部要件は `logic_not_implemented` で表示
- 訪問看護（医療保険）・小規模多機能・障害福祉・特養の判定（マスタ実装中）
- マルチテナント認可（tenant_id予約のみ）
- 訪問看護（介護保険）の3加算（複数名・長時間・認知症専門ケア）の判定（source_required・公式告示確認待ち）
- 本番tenant向けstaff.jsonスキーマの確定（α5.3はDEMO公開デモ専用。本番運用前にスキーマ凍結とPII方針の最終整備が必要）

---

## 注意事項

- **本ツールは加算算定可否を法的に保証するものではありません。**
- 実際の届出・算定にあたっては、各自治体の指導課・監査担当および顧問の社労士等に確認してください。
- マスタは継続的に更新していますが、最新の改定・Q&A・訂正通知が反映されていない場合があります。
- 本ツールは現場の判断・運用を**支援する目的**で提供されるものであり、法令解釈の最終判断は各事業者の責任で行ってください。
- 訪問看護の介護保険版と医療保険版は制度が異なります。本ツールは介護保険版を対象としており、医療保険版（訪問看護療養費）は別管理で準備中です。

---

## 更新ポリシー

加算マスタは以下のタイミングで更新されます：

- 介護報酬改定（3年に1回）
- 年次・臨時改定（**令和8年6月臨時改定 反映済**）
- 厚労省 Q&A・訂正通知
- 各自治体の運用通知

各更新は `releases/changelog.md` に下記の検証ステータスで記録します。

| ステータス | 意味 |
|---|---|
| `unverified` | 取り込み済み・内部レビュー前（参考表示） |
| `checked` | 社内レビュー完了 |
| `legally_reviewed` | 法務レビュー完了（本番判定の正本） |

`unverified` の段階での判定は参考扱いとし、本番算定判断には `checked` 以上を採用してください。

---

## バージョン採番ルール

- 形式: `vYYYY.MM.DD-{stage}.{patch}`
- stage:
  - `alpha`: 社内検証・限定パートナー向け
  - `beta`: 広域検証
  - `rc`: リリース候補
  - `stable`: 安定版（法務レビュー済マスタのみ）

---

_CareLinker / ケア・プランニング株式会社_
