# alpha.5.12 Legal Clearance Rules

**version**: alpha.5.12
**base_commit**: `a3af77843f01653f1e7e10c99ece00b98faa2aba` (alpha.5.11)
**generated_at**: 2026-05-10

---

## 概要

alpha.5.11 までは needs_legal_review 5件（複数名訪問看護加算 4件 + 長時間訪問看護加算 1件）は、
法令確認後も `legal_review_required` バケットに滞留する仕様でした。
alpha.5.12 では `legal_review_clearance` フラグを導入し、法令確認者がレビュー結果を記録できるようにします。

## legal_review_clearance の許可値

| 値 | 意味 | gate での扱い |
|---|---|---|
| `cleared` | 法令確認者が clearance を付与（解釈通知などを参照済み） | 他の必須フィールドが全揃いなら approved 候補に進める |
| `not_cleared` | 法令確認の結果、clearance が下りなかった | legal_review_required（approved にならない） |
| `pending` | 法令確認者がまだ確認中 | legal_review_required（approved にならない） |
| `not_required` | needs_legal_review に該当しない加算で reviewer が便宜的に記載 | 判定には使わない（needs_legal_review 以外の行で使用） |

## legal cleared → approved の必須条件

`needs_legal_review` バケットの行が approved 候補に進むには **以下の全条件** を満たす必要があります:

1. `legal_review_clearance == "cleared"`
2. `legal_review_reference` が空でない（解釈通知の番号や事務連絡日付など）
3. `implementation_allowed == "yes"`
4. `final_approved_by` が空でない（最終承認者）
5. `required_evidence` が空でない（PDF page など）
6. `reviewer_decision` が `MODIFYING_DECISIONS` に含まれる
   - approve_official_code_addition / add_receipt_alias / correct_internal_legacy_code
7. `reviewer_decision` が `correct_internal_legacy_code`（高リスク）の場合、
   `implementation_risk_acknowledged == "yes"` も必須

## サンプル: clearance あり approved 候補

```csv
service,kasan_key,reviewer_decision,reason,required_evidence,reviewer_name,reviewed_at,final_approved_by,implementation_allowed,reviewer_role,review_note,legal_review_clearance,legal_review_reference,legal_review_note,implementation_priority,implementation_risk_acknowledged
houmon_kango_kaigo,fukusu_mei_houmon_kango_kasan_II_under30,approve_official_code_addition,法令確認者の clearance を経て公式コード 134200 として登録,令和8年法令解釈通知 (sample reference) を法令確認者が確認,sample_業務担当A,2026-05-15,sample_最終承認者X,yes,business_reviewer,法令確認者から clearance=cleared を取得済,cleared,令和8年5月XX日 老企第XXX号 (sample reference),法令確認者: sample_法令確認者B が解釈通知を確認,high,yes
```

→ alpha.5.10 gate で **approved_changes_preview** に分類

## サンプル: clearance なし → legal_review_required

clearance が `pending` / `not_cleared` / 空欄のいずれかなら、impl=yes でも legal_review_required:

```csv
houmon_kango_kaigo,fukusu_mei_houmon_kango_kasan_I_under30,escalate_legal_review,...,yes,business_reviewer,...,pending,...
```

→ alpha.5.10 gate で **legal_review_required** に分類

## R8.6 案資料の扱い（変更なし）

- WAM_R8_6_8_PROVISIONAL_2026_04_30 は **案資料**で `checked_promotion_allowed=false`
- future_candidate_only 2 件 (訪介 shougu_kaizen_kasan / 居宅 shougu_kaizen_kasan_2026_06)
  は legal_review_clearance があっても **必ず defer_until_r8_definitive のみ受理**
- 他の decision を入れると alpha.5.10 gate で **blocked**

## 実装範囲（alpha.5.12 - alpha.5.13+）

- alpha.5.12: gate 側で legal_review_clearance を受け付け、approved 候補に流す
- alpha.5.12: master JSON は **改変しない**（候補提示のみ）
- **alpha.5.13+**: approved 候補を別 PR で master JSON に段階反映（一括反映禁止）

## 関連ファイル

- alpha5_12_reviewer_decision_workbook.xlsx — Decision_Input_All シートに legal_review_clearance 列
- sample_reviewed_decisions.csv — fixture 12 シナリオ（うち legal cleared 1件）
- alpha.5.10 gate — generate_alpha5_10_reviewer_decision_gate.py に判定ロジック追加済
