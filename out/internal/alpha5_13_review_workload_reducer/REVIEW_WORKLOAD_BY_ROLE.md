# Review Workload by Role

**version**: alpha.5.13
**generated_at**: 2026-05-10

---

## 役割別の想定作業時間

### 木村CIO

- **想定時間**: 約 **30 分**
- **やること**:
  - [`CIO_30MIN_DECISION_BRIEF.md`](CIO_30MIN_DECISION_BRIEF.md) を読む
  - reviewer 4 名（business / legal / final_approver 2 名 / developer）の任命を決める
  - 初回レビューを 8 件に絞る承認
- **やらないこと**:
  - 38 件すべてのレビュー
  - 個別加算の technical 判断
  - master JSON への直接介入

### business_reviewer（初回バッチのみ）

- **想定時間**: 約 **120 分**（≈ 2 時間 0 分）
- **対象**: 初回バッチ 8 件のみ（needs_master_review の low/medium risk のサブセット）
- **やること**:
  - 各加算の `recommended_initial_decision` を確認
  - alpha.5.12 workbook の Decision_Input_All で記入
  - 公式コードと社内コードの単位一致を再確認
- **やらないこと**:
  - 残り 20 件の needs_master_review（後続バッチ）
  - 5 件の needs_legal_review（legal_reviewer に委任）
  - 2 件の future_candidate_only（defer）
  - 3 件の divergent（記録のみ・追加作業なし）

### legal_reviewer

- **想定時間**: 初回は **対象外**。後続フェーズで約 5〜15 時間
- **対象**: needs_legal_review 5 件（複数名訪問看護加算 4 + 長時間訪問看護加算 1）
- **やること**:
  - alpha.5.12 workbook の Needs_Legal_Review シートで legal_review_clearance を判定
  - 介護報酬告示・大臣基準告示・老企第36号 解釈通知を参照
  - clearance=cleared を付与するか判断
- **やらないこと**:
  - 業務担当の judgment に介入
  - master JSON への直接介入

### final_approver（木村CIO + 渡辺執行役員）

- **想定時間**: 初回バッチ後に約 **30 分**
- **対象**: 初回バッチ 8 件
- **やること**:
  - business_reviewer の入力を確認
  - implementation_allowed = yes / final_approved_by に氏名記入
  - 高リスク decision が含まれていないことを確認（本パケットでは含めていない）
- **やらないこと**:
  - 業務担当・法令確認者の判断を技術的に覆す
  - 38 件すべての判定を最終承認

### developer

- **想定時間**: 約 **2〜4 時間**（alpha.5.14 dry run 準備）
- **対象**: 初回バッチが alpha.5.10 gate を通過した後
- **やること**:
  - workbook → CSV export
  - alpha.5.10 gate 再実行
  - approved_changes_preview の確認
  - alpha.5.14 dry run（master JSON 適用シミュレーション・実反映なし）
- **やらないこと**:
  - 一括 master JSON 反映
  - 公開デモパックの更新

---

## 累積負荷の比較

| 段階 | 従来 (alpha.5.12) | alpha.5.13 reducer 後 |
|---|---|---|
| CIO 想定時間 | 不明確（数時間 〜 数日）| **30 分** ✅ |
| 初回 reviewer 件数 | 38 件 | **8 件** ✅ |
| 法令確認者の初回 | 5 件（同時並行）| **対象外** ✅（後続フェーズへ）|
| 最終承認者の初回 | 38 件 | **8 件** ✅ |
| 反復回数 | 不明 | 初回バッチ完了後に再評価 |

---

## CIO 任命を待つ待機状態

- alpha.5.13 までで「reviewer がやるべきこと」を可能な限り **絞り込み済み**
- 残るは **CIO の reviewer 任命のみ**
- 任命後は本パケットの [`FIRST_REVIEW_BATCH.csv`](FIRST_REVIEW_BATCH.csv) を渡せば
  業務担当が **120 分** で初回バッチを完了できる想定
