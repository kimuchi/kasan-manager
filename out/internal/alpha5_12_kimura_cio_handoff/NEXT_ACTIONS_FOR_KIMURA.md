# Next Actions for Kimura CIO

**version**: alpha.5.12-kimura-cio-handoff
**base_commit**: `db031d49134fe6d89bceba5931c8a0569857c6f7`
**generated_at**: 2026-05-10

---

## 7 つの次アクション

### Action 1. レビュー担当者を決める（最優先・即日可能）

**何を**: [`REVIEWER_ASSIGNMENT_TEMPLATE.csv`](REVIEWER_ASSIGNMENT_TEMPLATE.csv) の `(CIO 任命)` 欄を埋める。

**役割と人数**:
| role | 想定人数 | 候補 |
|---|---:|---|
| business_reviewer | 1〜2 名 | 介護事業運営に詳しい社内担当（介護事業運営エージェント担当者など）|
| legal_reviewer | 1 名 | 顧問社労士・行政書士・介護専門の外部コンサル |
| final_approver | 2 名 | 木村CIO + 渡辺執行役員（既定） |
| developer | 1 名 | alpha.5.13+ の master JSON 反映担当（社内エンジニア）|

**期限の目安**: 2026-05-15（任命のみ・実作業は後続）

---

### Action 2. alpha.5.12 reviewer ワークブックを各 reviewer に渡す

**何を**: 以下のファイルをコピーして reviewer に配布。

```
products/kasan-manager/out/internal/alpha5_12_reviewer_workflow_hardening/
  alpha5_12_reviewer_decision_workbook.xlsx (28KB)
```

**渡し方の注意**:
- **public 配下に置かない**（reviewer の判断記録ファイルは内部資料）
- メール添付ではなく社内 Drive の限定共有が推奨
- 同時に [`REVIEW_WORKFLOW_GUIDE.md`](REVIEW_WORKFLOW_GUIDE.md) も渡す

**期限の目安**: 2026-05-20

---

### Action 3. 38 件の判断入力を依頼する

**何を**: 各 reviewer に Decision_Input_All シートでの記入を依頼。

**業務担当の作業内容**:
- needs_master_review **28 件** + divergent **3 件** = **31 件**
- 推定所要時間: 1 件あたり 15〜30 分 → 計 **8〜16 時間**（数日〜1 週間に分散）

**法令確認者の作業内容**:
- needs_legal_review **5 件**
- 推定所要時間: 法令解釈を伴うため 1 件あたり 1〜3 時間 → 計 **5〜15 時間**
- 解釈通知の確認に外部書籍・有料データベース利用の可能性あり

**最終承認者の作業内容**:
- 全 38 件の最終確認・final_approved_by 記入
- 推定所要時間: 1 件あたり 5 分 → 計 **3 時間**

**期限の目安**:
- 業務担当: 2026-05-31
- 法令確認者: 2026-06-30
- 最終承認者: 2026-07-15

---

### Action 4. legal_review_clearance の運用責任者を決める

**何を**: needs_legal_review 5 件の `legal_review_clearance` を「cleared」と判定できる
責任者を決定（社内担当 or 外部委託先）。

**決定が必要な項目**:
1. **誰が clearance=cleared を付与するか**（法令確認者の権限範囲）
2. **どの解釈通知・告示を参照するか**（参照範囲の定義）
3. **clearance に異議がある場合の覆し方**（最終承認者の差し戻し権限）
4. **外部委託する場合の費用負担**（顧問契約内 or 別途見積）

**参考**:
- [`alpha5_12_reviewer_workflow_hardening/legal_clearance_rules.md`](../alpha5_12_reviewer_workflow_hardening/legal_clearance_rules.md) に
  alpha.5.12 で定義したルールを記載。alpha.5.13+ で正式化予定。

**期限の目安**: 2026-05-31

---

### Action 5. export して gate 再実行する

**何を**: reviewer が Excel 入力を完了したら、CIO 自身またはエンジニアに依頼して
export → alpha.5.10 gate 再実行を行う。

**コマンド**:
```bash
cd products/kasan-manager
# Step 1: Excel → CSV
python scripts/export_alpha5_11_workbook_decisions.py \
  --workbook out/internal/alpha5_12_reviewer_workflow_hardening/alpha5_12_reviewer_decision_workbook.xlsx \
  --output out/internal/alpha5_12_reviewer_workflow_hardening/reviewer_decision_export.csv

# Step 2: gate 再実行
python scripts/generate_alpha5_10_reviewer_decision_gate.py \
  --input out/internal/alpha5_12_reviewer_workflow_hardening/reviewer_decision_export.csv \
  --output out/internal/alpha5_10_reviewer_decision_gate_from_alpha5_12_workbook/
```

**結果の確認**: `alpha5_10_reviewer_decision_gate_from_alpha5_12_workbook/decision_validation_report.md`

**期限の目安**: reviewer 完了後 1 営業日以内

---

### Action 6. approved のみ alpha.5.13 dry run へ進む

**何を**: gate 実行結果の `approved_changes_preview.csv` に入った行のみ、
alpha.5.13 で master JSON 適用シミュレーション（**実反映なし**）を行うかの GO 判断。

**alpha.5.13 dry run で何をするか**:
- approved 行を master JSON に **適用したらどうなるか** をテスト環境で確認
- PDF 検出パターンが壊れないか
- checked 件数が想定通り増えるか
- 4 サービス PDF 回帰 + 5 パターン回帰 + 既存 checked 20 件維持の自動テスト

**dry run 中も**:
- ❌ 実 master JSON は変更しない
- ❌ 公開デモパックは更新しない
- ❌ 一括反映しない（個別 PR を想定）

**期限の目安**: 2026-08 上旬（reviewer 完了後）

---

### Action 7. blocked / pending / legal_review_required は差し戻す

**何を**: gate の出力に blocked / pending / legal_review_required が残っている
場合、対応する reviewer に差し戻す。

**差し戻しの基準**:
| バケット | 差し戻し先 |
|---|---|
| blocked | 該当 reviewer に修正依頼（`recommended_fix` 列を参照）|
| pending (blank_template_row) | 業務担当に未記入箇所の記入依頼 |
| pending (deferred_until_r8_definitive) | （差し戻し不要・R8.6.1 確定版待ち）|
| legal_review_required | 法令確認者に clearance 判定を依頼 |

**差し戻し後の流れ**: reviewer が修正 → ワークブック保存 → Action 5 を再実行。
すべて解消されるまで Action 5〜7 をループ。

**期限の目安**: reviewer 完了サイクルごとに即実施

---

## 全体タイムライン（目安）

```
2026-05-15 [Action 1] reviewer 任命
2026-05-20 [Action 2] ワークブック配布
2026-05-31 [Action 3] 業務担当の入力完了 / [Action 4] legal clearance 運用責任者決定
2026-06-30 [Action 3] 法令確認者の入力完了
2026-07-01 [Action 5] export + gate 1 回目実行
2026-07-05 [Action 7] 差し戻し対応 + Action 5 反復
2026-07-15 [Action 3] 最終承認者の最終ハンコ完了
2026-07-20 [Action 5] 最終 gate 実行
2026-07-25 [Action 6] alpha.5.13 dry run GO 判断
2026-08-上旬 alpha.5.13 dry run 実施
2026-08-下旬 alpha.5.14 段階反映開始（個別 PR）
```

---

## 木村CIO が即決可能な事項

すぐに決められること:
- ✅ Action 1 (reviewer 任命) — 社内人員で即決可能
- ✅ Action 2 (ワークブック配布) — 社内 Drive で即配布可能
- ✅ Action 4 (legal clearance 運用責任者) — 社内担当 or 顧問先の選択

少し時間が必要なこと:
- ⏸ Action 3 (38 件の入力) — reviewer の通常業務との調整
- ⏸ Action 4 (法令確認者の費用見積) — 顧問契約内か別途見積か

完全に reviewer 完了後でないと進められないこと:
- ❌ Action 6 (alpha.5.13 dry run GO) — gate 完了後に判断
- ❌ alpha.5.14 以降の master JSON 段階反映

---

## エスカレーションパス

| 状況 | エスカレーション先 |
|---|---|
| reviewer の判断が割れる | 最終承認者（木村CIO + 渡辺執行役員）の二者協議 |
| 法令解釈が複数の解釈通知で矛盾 | 顧問社労士 + 介護専門弁護士の合議 |
| 高リスク decision の reviewer 同意が得られない | デフォルトで `keep_legacy_detection_only` に倒す（master 不変）|
| R8.6.1 確定版の公開時期が大きくずれる | future_candidate 2 件は defer のまま継続 |
| 緊急に外部公開デモを更新する必要が出た | alpha.5.4 公開デモパックは未変更で再利用可能 |

---

## 連絡先（手元の運用フロー）

このパケットに関する質問:
- 開発側: kasan-manager 開発担当
- 運用側: 木村CIO + 介護事業運営エージェント

reviewer 任命連絡:
- 業務担当: 介護事業運営エージェント経由
- 法令確認者: 顧問社労士・外部コンサル経由
- 最終承認者: 木村CIO 直
