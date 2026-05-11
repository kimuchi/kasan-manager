# CareLinker 加算チェッカー リリース・改定ログ

> CareLinker加算マスタの法令改定・Q&A・訂正通知・スキーマ変更を時系列で記録。
> 各エントリは検証ステータスを持ち、unverified の改定は本番判定対象外。

## 記録フォーマット

各エントリは以下の項目を持つ。

| 項目 | 説明 |
|---|---|
| revision_tag | 改定識別子（例: R6_2024_04, R6_2026_06_shougu） |
| effective_from | 適用開始日 |
| source_name | 出典名（告示・通知・Q&A・訂正通知等） |
| source_url | 出典URL |
| affected_services | 影響を受ける service_key の配列 |
| changed_kasans | 変更された加算キーの配列 |
| verification_status | unverified / checked / legally_reviewed |
| notes | 補足 |

---

## 2026-05-06 — alpha.4.5 訪問看護（介護保険）source_required 残3件解消

- revision_tag: `R6_2024_06_plus_2026_06_shougu_alpha4_5`
- effective_from: 2024-06-01
- source_name: WAM NET 介護給付費単位数等サービスコード表（令和6年4月施行・2024-03-18版）
- source_url: https://www.wam.go.jp/gyoseiShiryou-files/documents/2024/0314163446376/20240318_006.pdf
- affected_services: ["houmon_kango_kaigo"]
- changed_kasans: |
  source_required → checked 昇格 4件:
  - 複数名訪問看護加算(Ⅰ)・30分未満 +254単位/回（看護師等の複数名）
  - 複数名訪問看護加算(Ⅰ)・30分以上 +402単位/回
  - 複数名訪問看護加算(Ⅱ)・30分未満 +201単位/回（看護補助者との組み合わせ）
  - 複数名訪問看護加算(Ⅱ)・30分以上 +317単位/回
  - 長時間訪問看護加算 +300単位/回（1時間30分以上）
  source_required → checked（対象外確定）1件:
  - 認知症専門ケア加算は訪問看護(13プレフィックス)コード表に存在せず、訪問介護・訪問入浴介護・定期巡回随時対応型訪問介護看護・夜間対応型訪問介護のみ対象と確定
  service_registry 表記更新:
  - source_required: false / source_required_count: 0
  - implemented_scope: "all_kasans_checked"
  - revision_tag: R6_2024_06_plus_2026_06_shougu_alpha4_5
- verification_status: checked
- notes: |
  訪問看護(介護保険)が完全 checked 状態に到達。
  複数名訪問看護加算は基本報酬コードのバリエーション（複１１/複１２/複２１/複２２サフィックス）として
  サービスコード表に織り込まれているが、加算項目としてマスタJSONに登録（4区分）。
  認知症専門ケア加算は applicability=not_applicable で「訪問看護では算定対象外」を明示。
  公式根拠が WAM NET の正式サービスコード表で確認できたため checked。

---

## 2026-05-06 — alpha.3.1 訪問看護（介護保険）根拠・期限・表記修正

- revision_tag: `R6_2024_06_plus_2026_06_shougu_alpha3_1`
- effective_from: 2024-06-01
- source_name: 令和6年度介護報酬改定資料 + 自治体運用通知（処遇改善加算 体制届出期限）
- source_file: `skills/regulatory/HOUMON_KANGO.md` + 令和6年度介護報酬改定資料
- affected_services: ["houmon_kango_kaigo"]
- changed_kasans: |
  期限表記の分離（処遇改善加算 R8.6新規対象）:
  - 体制届出: 2026-05-15（原則・前月15日）
  - 処遇改善計画書: 2026-06-15
  - 自治体（指定権者）への確認が必要との注記を追加
  source_required → checked 昇格:
  - 初回加算(Ⅰ) 350単位/月（退院日に初回訪問）
  - 初回加算(Ⅱ) 300単位/月（退院日翌日以降に初回訪問）
  - Ⅰ/Ⅱは併算定不可
  source_required 残置（介護保険版未確認）:
  - 複数名訪問看護加算
  - 長時間訪問看護加算
  - 認知症専門ケア加算
  service_registry 表記修正:
  - status: implemented (継続)
  - source_required: true
  - source_required_count: 3
  - implemented_scope: "major_kasans_checked_partial_source_required"
  - revision_tag: "R6_2024_06_plus_2026_06_shougu_alpha3_1"
  verification_status 整理:
  - 個別加算 source_status enum: checked / legally_reviewed / source_required / draft / planned
  - 「implemented」は service レベルの status のみで使用、加算レベルでは checked に寄せる
  - schemas/regulatory_master.schema.json の source_status enum を更新
- verification_status: checked
- notes: |
  alpha.3 公開・営業利用前の根拠強化版。処遇改善加算の届出期限を体制届出と
  計画書で分離し、自治体運用差を明示。初回加算Ⅰ/Ⅱを令和6年度改定資料に基づき
  source_required から昇格。残3件のsource_requiredは介護保険版固有の単位数・
  適用可否確認待ちとして明示。

---

## 2026-05-06 — alpha.3 訪問看護（介護保険）implemented 化

- revision_tag: `R6_2024_06_plus_2026_06_shougu`
- effective_from: 2024-06-01
- source_name: 令和6年度介護報酬改定 + 令和8年6月臨時改定（処遇改善加算 訪問看護新規対象）
- source_file: `skills/regulatory/HOUMON_KANGO.md`（社内regulatory資料・2026-03-24最終更新）
- affected_services: ["houmon_kango_kaigo"]
- changed_kasans: |
  実装（checked）11件:
  - 緊急時訪問看護加算Ⅰ（600単位/月・R6新設）
  - 緊急時訪問看護加算Ⅱ（574単位/月・従来）
  - 特別管理加算Ⅰ（500単位/月）
  - 特別管理加算Ⅱ（250単位/月）
  - ターミナルケア加算（2,500単位・R6改定で2,000→2,500に引き上げ）
  - 看護体制強化加算Ⅰ（550単位/月）
  - 看護体制強化加算Ⅱ（200単位/月）
  - サービス提供体制強化加算Ⅰ（6単位/回）
  - サービス提供体制強化加算Ⅱ（3単位/回）
  - 退院時共同指導加算（600単位/回）
  - 看護・介護職員連携強化加算（250単位/月）
  - 口腔連携強化加算（50単位/回・R6新設）
  - 科学的介護推進体制加算LIFE（40単位/月）
  - 介護職員等処遇改善加算（1.8%・R8.6新規対象・届出期限2026-06-15）
  source_required 4件:
  - 初回加算（介護保険版の単位数・要件未確認）
  - 複数名訪問看護加算（介護保険版未確認）
  - 長時間訪問看護加算（介護保険版未確認）
  - 認知症専門ケア加算（訪問看護版適用可否未確認）
  減算 2件:
  - PT・OT・ST減算（8単位）
  - PT・OT・ST 12か月超追加減算（5単位）
- verification_status: checked
- notes: |
  社内regulatory資料 skills/regulatory/HOUMON_KANGO.md に基づき実装（checked）。
  社内資料はR6.6改定告示・厚労省Q&A・社内法務確認済（2026-03-24時点）。
  4加算（初回・複数名・長時間・認知症専門ケア）は介護保険版の根拠情報が
  社内資料に明示されていないため source_required で残置。
  service_registry の status を draft → implemented に昇格。
  alpha.3 リリース完了 → 公開対応サービスは4サービスに拡大。

---

## 2026-05-06 — リポジトリ初期化（外販MVP基盤化）

- revision_tag: `mvp_base_2026_05_06`
- effective_from: 2026-05-06
- source_name: 内部整理
- source_url: -
- affected_services: ["tsusho_kaigo", "kyotaku_shien", "houmon_kaigo"]
- changed_kasans: []
- verification_status: legally_reviewed
- notes: |
  既存3マスタを products/kasan-manager/regulatory_master/kaigo/ に移行。
  事業所固有データ（current_inquiry / current_status / owner / applied_offices）を tenant_data/status/ に分離。
  domain（kaigo/medical/disability）と service_key を導入。
  service_registry.json を新設し、未実装7サービス（訪問看護介護/訪問看護医療/小規模多機能/障害居宅介護/就労A/就労B/特養）を draft または planned で登録。
  スキーマ5本（regulatory_master / tenant_status / staff / user / evidence）を schemas/ に追加。

---

## 2026-06-01 — 居宅介護支援 処遇改善加算 新規対象（予定）

- revision_tag: `R6_2026_06_shougu`
- effective_from: 2026-06-01
- source_name: 2026年6月臨時介護報酬改定
- source_url: (要追記)
- affected_services: ["kyotaku_shien", "houmon_kango_kaigo"]
- changed_kasans: ["shougu_kaizen_kasan_2026_06"]
- verification_status: unverified
- notes: |
  居宅介護支援・訪問看護に処遇改善加算が新規適用。rate=2.1%。届出期限 2026-06-15。
  kyotaku_shien.json には反映済み。訪問看護（介護保険）は houmon_kango_kaigo.json 実装時に対応。

---

## 改定対応プロセス

1. 厚労省・各自治体の改定告示・Q&A・訂正通知を検出（skills/regulatory/AUTO_MONITOR.md と連携）
2. revision_tag を採番してこのファイルに `verification_status: unverified` で追記
3. 該当 master_file を更新（バックアップは git history で確保）
4. 内部レビューで `verification_status: checked` に更新
5. 法務・社労士レビューで `verification_status: legally_reviewed` に更新
6. リリース通知をテナントに配信（CareLinker顧客向け）

---

## 検証ステータス定義

- **unverified**: 改定情報を取り込んだが、内部レビュー未完了。本番判定では tips に注意喚起。
- **checked**: 社内レビュー完了。本番判定で参考表示。
- **legally_reviewed**: 社労士・行政書士等の法務レビュー完了。本番判定の正本。

---

## 過去改定履歴（再構成）

### R6_2024_04（令和6年介護報酬改定）

- effective_from: 2024-04-01
- source_name: 令和6年度介護報酬改定（令6厚告86号等）
- source_url: (要追記)
- affected_services: ["tsusho_kaigo", "kyotaku_shien", "houmon_kaigo"]
- changed_kasans: |
  訪問介護: 特事Ⅰ介護福祉士比率100%→30%緩和、特事Ⅴ（中山間）新設、口腔連携強化加算新設。
  通所介護: 中重度者ケア体制加算継続、入浴介助Ⅱ要件継続。
  居宅介護支援: 逓減制45→50件緩和（ICT/事務職員配置）。
- verification_status: legally_reviewed
- notes: 既存3マスタはこの改定をベースに作成済み。
