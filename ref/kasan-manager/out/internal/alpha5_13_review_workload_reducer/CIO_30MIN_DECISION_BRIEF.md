# CIO 30 Minute Decision Brief

**version**: alpha.5.13
**base_commit**: `228897a415aa8b2ff9a0d0a0b96723901a995266` (alpha.5.12 kimura cio handoff)
**target audience**: 木村CIO
**想定読了時間**: **30 分以内**
**generated_at**: 2026-05-10

---

## 🔑 結論（最初に読む）

**木村CIO にお願いするのは「38件のレビュー」ではなく、以下の 4 つの体制決裁だけです。**

| # | 決裁項目 | 30 分内に決められる？ |
|---|---|:---:|
| 1 | **business_reviewer の任命** (1〜2 名) | ✅ |
| 2 | **legal_reviewer の任命** (1 名・外部委託可) | ✅（任命のみ・契約は後続）|
| 3 | **final_approver の確認**（木村CIO + 渡辺執行役員 既定）| ✅ |
| 4 | **初回レビューを 8 件に絞る承認** | ✅ |

**38 件全部レビューする必要はありません。** alpha.5.13 review workload reducer で
**初回バッチを 8 件に絞り込みました**。残り 30 件は
**安全に defer / legal / 後続バッチへ振り分け済み**です。

---

## 数字の見方（5 分）

### 全 66 加算の内訳

| status | 件数 | コメント |
|---|---:|---|
| **checked** | **20** | 公開デモで根拠確定済（変更なし）|
| needs_review | 36 | 内訳: needs_master_review 28 / needs_legal_review 5 / divergent 3 |
| pattern_based_unverified | 9 | 記録のみ・追加作業なし |
| not_applicable | 1 | 訪問看護では対象外確定 |

### レビュー対象 38 件の優先度内訳

| risk_level | 件数 | 主な対応 |
|---|---:|---|
| **low (初回バッチ候補)** | 8 | add_receipt_alias / add_official_code_addition |
| medium | 4 | 後続バッチで対応 |
| high | 0 | correct_internal_legacy_code (PDF回帰必須・後回し) |
| **defer (legal/future_candidate)** | **7** | 法令確認者または R8.6.1 確定版待ち |

---

## 初回バッチの中身（8 件）

CIO が決裁すべき初回バッチは以下です。全件 **add_receipt_alias** または
**add_official_code_addition** で、**PDF 検出パターンに影響しない低リスク変更**:

| # | サービス | kasan | 推奨 decision | 想定時間 |
|---|---|---|---|---|
| 1 | 訪問介護 | `kinkyu_houmon` | `add_receipt_alias` | 15min |
| 2 | 訪問介護 | `koukuu_renkei_kyouka` | `add_receipt_alias` | 15min |
| 3 | 居宅介護支援 | `kinkyu_kyotaku_conference` | `add_receipt_alias` | 15min |
| 4 | 居宅介護支援 | `nyuin_jouhou_renkei_I` | `add_receipt_alias` | 15min |
| 5 | 通所介護 | `chujudosha_care_taisei` | `add_receipt_alias` | 15min |
| 6 | 通所介護 | `eiyou_kaizen` | `add_receipt_alias` | 15min |
| 7 | 通所介護 | `koukuu_kinou_I` | `add_receipt_alias` | 15min |
| 8 | 通所介護 | `nyuyoku_II` | `add_receipt_alias` | 15min |

**初回バッチ業務担当の想定総作業時間**: 約 **120 分**

---

## CIO が「決めなくてよい」こと（重要）

以下は alpha.5.13 で **自動的に defer / safe default に振り分け済み**です。CIO は
判断不要:

| カテゴリ | 件数 | safe default | 判断 |
|---|---:|---|---|
| future_candidate_only (R8.6 関連) | 2 | defer_until_r8_definitive | R8.6.1 確定版公開後 |
| needs_legal_review (訪看 複数名・長時間) | 5 | escalate_legal_review | legal_reviewer に委任 |
| divergent | 3 | keep_pattern_based_unverified | 記録のみ・追加作業なし |
| 単位不一致・公式 not_found 等 | 1 | 後続バッチ | 業務担当の判断材料収集後 |
| 同じパターンの後続代表 (per_service_cap_exceeded) | 19 | 初回バッチ承認結果を流用 | 業務担当が後続バッチで判断 |
| 高リスク (correct_internal_legacy_code) | 0 | 後続 PR で個別対応 | PDF 検出回帰必須 |

---

## CIO の 30 分タイムボックス案

| 時間 | 内容 |
|---:|---|
| 0〜5 分 | 本ファイル「結論」を読む |
| 5〜10 分 | 数字の内訳を見る（66加算・38レビュー・初回 8 件）|
| 10〜15 分 | 初回バッチの kasan 名と recommended_initial_decision を眺める |
| 15〜20 分 | reviewer 候補 4 名を決める（社内 + 外部） |
| 20〜25 分 | [`REVIEWER_ASSIGNMENT_TEMPLATE.csv`](../alpha5_12_kimura_cio_handoff/REVIEWER_ASSIGNMENT_TEMPLATE.csv) の `(CIO 任命)` 欄を埋める |
| 25〜30 分 | 業務担当に「初回 8 件のみ着手で OK」を伝達 |

---

## 次のフェーズ（alpha.5.14+）

CIO 決裁後の流れ:

1. 業務担当が **初回 8 件のみ** alpha.5.12 workbook で記入
2. export → alpha.5.10 gate 再実行
3. approved 行が出たら alpha.5.14 dry run
4. 問題なければ alpha.5.15 で master JSON 段階反映
5. 後続バッチ（残り 30 件のうち legal/future を除く items）を alpha.5.16+ で処理
6. 法令確認者の clearance 取得後に needs_legal_review 5 件を再評価
7. R8.6.1 確定版公開後に future_candidate_only 2 件を再評価

---

## 確認事項（CIO による確認）

- ✅ master JSON は alpha.5.4 公開デモ版から **完全に未変更**（業務データ無変更）
- ✅ checked 20 件は **完全維持**（訪看 14 + 通所 6）
- ✅ R8.6 案資料は checked 昇格に **使っていない**
- ✅ public release pack (alpha.5.3 / alpha.5.4) は **完全未改変**
- ✅ 算定可否を法的に保証する表現は **出していない**
- ✅ reviewer 入力ファイルは **public に出さない**運用

---

_本ファイルは内部レビュー用。public release pack には含めない。_
