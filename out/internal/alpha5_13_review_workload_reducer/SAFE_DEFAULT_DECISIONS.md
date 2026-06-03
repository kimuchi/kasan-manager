# Safe Default Decisions

**version**: alpha.5.13
**generated_at**: 2026-05-10

---

## 概要

reviewer の判断疲れを抑え、判断が割れた場合に **安全側に倒す** ためのデフォルト選択肢。
本パケットでは reviewer_decision を上書きしませんが、`recommended_initial_decision`
として提示しています。**最終決定は reviewer が行う** 前提です。

---

## バケット別 safe default

### 1. future_candidate_only (2 件) → `defer_until_r8_definitive`

**対象**:
- 訪問介護 `shougu_kaizen_kasan`
- 居宅介護支援 `shougu_kaizen_kasan_2026_06`

**理由**:
- R8.6 案資料 (WAM_R8_6_8_PROVISIONAL_2026_04_30 / `_2026_04_20`) は **案資料**
- `checked_promotion_allowed=false` でガード済（alpha.5.8.1）
- 確定版が出るまで checked 昇格に使えない

**運用**: R8.6.1 確定版（公開後）に alpha.5.16+ で再評価。

---

### 2. needs_legal_review (5 件) → `escalate_legal_review`

**対象**: 訪問看護
- `fukusu_mei_houmon_kango_kasan_I_under30` / `_I_over30` / `_II_under30` / `_II_over30`
- `chouji_kan_houmon_kango_kasan`

**理由**:
- 基本サービスコードへの **付加加算構造** の可能性（独立コードなし）
- 介護報酬告示・大臣基準告示・老企第36号 解釈通知の確認が必要
- business_reviewer が法令解釈を断定すべきでない

**運用**: legal_reviewer に委任。alpha.5.12 workbook の `legal_review_clearance` を
記入してもらう。

---

### 3. divergent (3 件) → `keep_pattern_based_unverified`

**対象**:
- 訪問看護 `shougu_kaizen_kasan_2026_06` (R8.6 関連でもある)
- 通所介護 `adl_iji`
- 通所介護 `ninchi_kasan`

**理由**:
- proposed_action と overall_mapping_status が分岐
- alpha.5.8.1 で `alpha_5_8_1_proposed_overall_divergence_note` に audit_note 化済
- 業務データの不整合ではなく、**正しい記録状態**

**運用**: 現状維持（記録のみ・追加作業不要）。

---

### 4. 高リスク (correct_internal_legacy_code) → 初回バッチには含めない

**理由**:
- 社内 service_codes を公式コードに置換する変更は **PDF 検出パターンを直接書き換える可能性**
- 4 サービス PDF 回帰テスト必須
- alpha.5.10 gate で `implementation_risk_acknowledged=yes` 必須化済（alpha.5.12）

**運用**: alpha.5.16+ で **個別 PR**（1 PR = 1 加算）で段階的に対応。

---

### 5. PDF 検出に影響するもの → 保留

**例**:
- 単位が公式と社内で異なる加算（マスタ訂正の影響範囲が大きい）
- 既存サンプルレポートで「算定中」と表示される加算

**運用**:
- 初回バッチには含めない
- 後続バッチで業務担当が **追加調査** してから判断

---

### 6. 判断が割れる場合 → `keep_pattern_based_unverified`

**運用ルール**:
- reviewer が「もう少し情報が欲しい」と感じたら **`keep_pattern_based_unverified`** に倒す
- master JSON への影響なし
- 後続バッチで再評価可能

---

### 7. 公式コード追加だけで済みそうなもの → `add_official_code_addition`（初回バッチ候補）

**判定基準**:
- 社内 `service_codes` が **空**
- 公式 `official_service_code` が **存在**
- match_type が `code_mismatch` ではない

**理由**:
- 既存 master を **追加のみ** で更新（書き換えなし）
- PDF 検出への影響なし
- リスク最小

---

## safe default の限界

以下は safe default ではカバーできない:
- ✗ 公式コードと社内コードの **意味的同一性**（コード番号は違うが同じ加算か？）
- ✗ R8.6.1 確定版の **実際の差分**（未公開）
- ✗ 自治体ごとの解釈差（書類運用差）

これらは reviewer が判断する必要があります。

---

## CIO の役割

CIO は safe default を **承認する** だけで OK:
1. 本ファイルを読んで「未確定の判断は keep_pattern_based_unverified に倒す」方針を確認
2. business_reviewer / legal_reviewer に「safe default に倒して OK」を伝達
3. 初回バッチで approved 候補がゼロでも **失敗ではない**ことを共有
