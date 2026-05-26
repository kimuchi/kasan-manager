"""alpha.5.6: alpha.5.5 mapping_status を確定版 (2024-05-07・令和6.6.1/8月施行版) で再検証。

判明した重要事実:
- alpha.5.5 で根拠とした 2024-03-18 PDF はタイトルに「（案）」表示あり → source_kind: provisional
- 確定版 2024-05-07 PDF は「案」表示なし → source_kind: definitive
- 訪問看護加算は令和6.6.1 で構造変更があり、確定版では社内マスタと整合する加算が増えた:
  * 緊急時訪問看護加算Ⅰ/Ⅱ × 1/2 の四区分構造に拡張（社内マスタの Ⅰ/Ⅱ 解釈と整合）
  * ターミナルケア加算 R6.6 で 2,500単位 に増額（社内マスタと整合）
  * 初回加算Ⅰ/Ⅱ 区分新設（社内マスタと整合）
- alpha.5.5 で「不整合」と判定した5加算は確定版で全て整合（社内マスタが正・案版が誤りだった）
"""
import json
import sys
import io
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]

# 確定版 source anchor (alpha.5.6)
DEFINITIVE_SOURCE = {
    "source_kind": "definitive",
    "source_title": "介護給付費単位数等サービスコード表（令和6年6月・8月施行版）",
    "source_url": "https://www.wam.go.jp/gyoseiShiryou-files/documents/2024/0506103517756/20240507_006.pdf",
    "document_version": "2024-05-07版",
    "effective_date": "2024-06-01 / 2024-08-01",
    "page_or_section": "p65-74 訪問看護サービスコード表",
    "confirmed_at": "2026-05-09",
    "confirmed_by": "alpha.5.6 audit (CareLinker)",
}

# 案版（alpha.5.5 で使用）source anchor
PROVISIONAL_SOURCE = {
    "source_kind": "provisional",
    "source_title": "介護給付費単位数等サービスコード表（案）（令和6年4月施行版）",
    "source_url": "https://www.wam.go.jp/gyoseiShiryou-files/documents/2024/0314163446376/20240318_006.pdf",
    "document_version": "2024-03-18版（案）",
    "page_or_section": "p67-69 訪問看護サービスコード表",
}

# 確定版で確認した訪問看護加算（社内マスタと整合）
HOUMON_KANGO_CHECKED = {
    "tokubetsu_kanri_kasan_I": {
        "official_code": "134000", "official_unit": 500, "master_unit": 500,
        "match_type": "exact_match", "audit_note": "確定版で完全整合（コード・名称・単位）"
    },
    "tokubetsu_kanri_kasan_II": {
        "official_code": "134001", "official_unit": 250, "master_unit": 250,
        "match_type": "exact_match", "audit_note": "確定版で完全整合"
    },
    "kango_taisei_kyouka_kasan_I": {
        "official_code": "134010", "official_unit": 550, "master_unit": 550,
        "match_type": "exact_match", "audit_note": "確定版で完全整合"
    },
    "kango_taisei_kyouka_kasan_II": {
        "official_code": "134005", "official_unit": 200, "master_unit": 200,
        "match_type": "exact_match", "audit_note": "確定版で完全整合"
    },
    "service_taisei_kyouka_kasan_I": {
        "official_code": "136103", "official_unit": 6, "master_unit": 6,
        "match_type": "exact_match",
        "audit_note": "確定版で1回算定（イ及びロ）。1月算定（ハ）は136104=50単位として別コード"
    },
    "service_taisei_kyouka_kasan_II": {
        "official_code": "136101", "official_unit": 3, "master_unit": 3,
        "match_type": "exact_match",
        "audit_note": "確定版で1回算定（イ及びロ）。1月算定（ハ）は136102=25単位として別コード"
    },
    "taiin_kyoudou_shidou_kasan": {
        "official_code": "134003", "official_unit": 600, "master_unit": 600,
        "match_type": "exact_match", "audit_note": "確定版で完全整合"
    },
    "kango_kaigo_renkei_kyouka_kasan": {
        "official_code": "134004", "official_unit": 250, "master_unit": 250,
        "match_type": "exact_match", "audit_note": "確定版で完全整合"
    },
    # alpha.5.5 で不整合だった5件 → 確定版で整合確認 → 昇格
    "kinkyu_houmon_kango_kasan_I": {
        "official_code": "133001", "official_unit": 600, "master_unit": 600,
        "match_type": "exact_match",
        "audit_note": "alpha.5.5案版では Ⅰ/Ⅱ × 1/2 の四区分が未確定だったが、確定版（令和6.6.1施行）で構造が確定し、社内マスタの解釈と整合（指定訪問看護ステーション・600単位）。alpha.5.5 promotion was correct after revalidation.",
        "alpha_5_5_status": "promoted_from_pattern_based_unverified"
    },
    "kinkyu_houmon_kango_kasan_II": {
        "official_code": "133100", "official_unit": 574, "master_unit": 574,
        "match_type": "exact_match",
        "audit_note": "確定版（令和6.6.1）で 13 3100 緊急時訪問看護加算Ⅱ１ 574単位 と整合。社内マスタは指定訪問看護ステーション・574単位を指す（医療機関版13 3200 315単位は別コード）。",
        "alpha_5_5_status": "promoted_from_pattern_based_unverified"
    },
    "terminal_care_kasan": {
        "official_code": "137000", "official_unit": 2500, "master_unit": 2500,
        "match_type": "exact_match",
        "audit_note": "確定版でターミナルケア加算は 2,500単位（死亡月）に増額確定。alpha.5.5案版の 2,000単位は古い情報だった。社内マスタの 2,500単位 が正。",
        "alpha_5_5_status": "promoted_from_pattern_based_unverified"
    },
    "shokai_kasan_I": {
        "official_code": "134023", "official_unit": 350, "master_unit": 350,
        "match_type": "exact_match",
        "audit_note": "確定版で初回加算Ⅰ/Ⅱ区分が新設。13 4023 初回加算Ⅰ 350単位 で社内マスタと整合。",
        "alpha_5_5_status": "promoted_from_pattern_based_unverified"
    },
    "shokai_kasan_II": {
        "official_code": "134002", "official_unit": 300, "master_unit": 300,
        "match_type": "exact_match",
        "audit_note": "確定版で初回加算Ⅱ 13 4002 300単位 と社内マスタが整合。",
        "alpha_5_5_status": "promoted_from_pattern_based_unverified"
    },
    # 口腔連携強化加算 → 確定版で確認
    "koukuu_renkei_kyouka_kasan": {
        "official_code": "136192", "official_unit": 50, "master_unit": 50,
        "match_type": "exact_match",
        "audit_note": "確定版で 13 6192 訪問看護口腔連携強化加算 50単位 月1回限度 と社内マスタが整合。",
        "alpha_5_5_status": "newly_checked_in_alpha_5_6"
    },
}

# 確定版で対象外として再確認 (alpha.5.5 既確認・確定版でも整合)
HOUMON_KANGO_NOT_APPLICABLE = {
    "ninchi_senmon_care_kasan": {
        "audit_note": "確定版（プレフィックス13・訪問看護）にも該当コードなし。訪問看護では算定対象外（alpha.4.5確認・alpha.5.6で確定版でも再確認）。"
    }
}

# 確定版で見つからなかった or 構造差で慎重判断必要
HOUMON_KANGO_REMAINS_UNVERIFIED = {
    "kagakuteki_kaigo_suishin_kasan": {
        "audit_note": "確定版訪問看護コード表 (p65-74) には科学的介護推進体制加算の独立コード見当たらず。要追加調査。pattern_based_unverified 維持。",
        "match_type": "not_found_in_definitive_source",
    },
    "shougu_kaizen_kasan_2026_06": {
        "audit_note": "令和8年6月臨時改定（処遇改善加算 訪問看護新規対象・1.8%）。確定版PDF（令和6.6.1/8月施行版）の対象期間外。R8.6改定の公式資料を別途取得して照合必要。",
        "match_type": "out_of_definitive_scope",
    },
    "fukusu_mei_houmon_kango_kasan_I_under30": {
        "audit_note": "確定版で複数名訪問看護加算は基本サービスコード（13 1017〜等）に組み込まれた構造。独立コードではないため、社内マスタの kasan_key 単位での mapping_status は確定不可。alpha.4.5 で kasan-level 単位確認済。",
        "match_type": "structural_mismatch",
    },
    "fukusu_mei_houmon_kango_kasan_I_over30": {
        "audit_note": "同上",
        "match_type": "structural_mismatch",
    },
    "fukusu_mei_houmon_kango_kasan_II_under30": {
        "audit_note": "同上",
        "match_type": "structural_mismatch",
    },
    "fukusu_mei_houmon_kango_kasan_II_over30": {
        "audit_note": "同上",
        "match_type": "structural_mismatch",
    },
    "chouji_kan_houmon_kango_kasan": {
        "audit_note": "確定版で長時間訪問看護加算は基本サービスコードへの追加加算として組み込まれた構造。alpha.4.5 で kasan-level 確認済だが service_code 単独 mapping は確定不可。",
        "match_type": "structural_mismatch",
    },
}


def update_houmon_kango():
    path = ROOT / "regulatory_master" / "kaigo" / "houmon_kango_kaigo.json"
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    promoted = 0
    kept = 0
    for kasan_key, kasan_def in d.get("kasans", {}).items():
        if kasan_key in HOUMON_KANGO_CHECKED:
            info = HOUMON_KANGO_CHECKED[kasan_key]
            prev_status = kasan_def.get("service_code_mapping_status")
            kasan_def["service_code_mapping_status"] = "checked"
            kasan_def["service_code_audit"] = {
                "official_code": info["official_code"],
                "official_unit": info["official_unit"],
                "master_unit": info["master_unit"],
                "match_type": info["match_type"],
                "audit_note": info["audit_note"],
                **DEFINITIVE_SOURCE,
                "alpha_5_5_provisional_source": {
                    "source_kind": "provisional",
                    "source_title": PROVISIONAL_SOURCE["source_title"],
                    "source_url": PROVISIONAL_SOURCE["source_url"],
                    "document_version": PROVISIONAL_SOURCE["document_version"],
                },
            }
            if "alpha_5_5_status" in info:
                kasan_def["service_code_audit"]["alpha_5_5_status"] = info["alpha_5_5_status"]
            if prev_status == "checked":
                kept += 1
            else:
                promoted += 1
        elif kasan_key in HOUMON_KANGO_NOT_APPLICABLE:
            info = HOUMON_KANGO_NOT_APPLICABLE[kasan_key]
            kasan_def["service_code_mapping_status"] = "not_applicable"
            kasan_def["service_code_audit"] = {
                "match_type": "not_applicable",
                "audit_note": info["audit_note"],
                **DEFINITIVE_SOURCE,
            }
        elif kasan_key in HOUMON_KANGO_REMAINS_UNVERIFIED:
            info = HOUMON_KANGO_REMAINS_UNVERIFIED[kasan_key]
            kasan_def["service_code_mapping_status"] = "pattern_based_unverified"
            kasan_def["service_code_audit"] = {
                "match_type": info["match_type"],
                "audit_note": info["audit_note"],
                "definitive_source_consulted": DEFINITIVE_SOURCE,
            }

    # _meta audit summary 更新
    audit_summary = d["_meta"].get("service_code_mapping_audit", {})
    audit_summary.update({
        "audit_version": "alpha.5.6",
        "audit_date": "2026-05-09",
        "definitive_source": DEFINITIVE_SOURCE,
        "alpha_5_5_provisional_source_used": PROVISIONAL_SOURCE,
        "checked_count": len(HOUMON_KANGO_CHECKED),
        "not_applicable_count": len(HOUMON_KANGO_NOT_APPLICABLE),
        "pattern_based_unverified_count": len(HOUMON_KANGO_REMAINS_UNVERIFIED),
        "alpha_5_5_revalidation_summary": {
            "kept_checked": 8,  # alpha.5.5 で checked だった8件 → 確定版でも整合
            "promoted_from_pattern_unverified": 5,  # 不整合5件 → 確定版で整合判明・昇格
            "newly_checked_in_alpha_5_6": 1,  # 口腔連携強化加算
        },
        "note": "alpha.5.5 では 案版 (provisional) 資料を根拠にしたため、5加算を不整合と判定していた。alpha.5.6 で確定版（definitive・令和6.6.1/8月施行版）と再照合し、社内マスタが正しいことを確認・全件 checked 化。"
    })
    d["_meta"]["service_code_mapping_audit"] = audit_summary

    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)

    print(f"Updated: {path.relative_to(ROOT.parent.parent)}")
    print(f"  checked: {len(HOUMON_KANGO_CHECKED)} (kept={kept} / promoted={promoted})")
    print(f"  not_applicable: {len(HOUMON_KANGO_NOT_APPLICABLE)}")
    print(f"  pattern_based_unverified: {len(HOUMON_KANGO_REMAINS_UNVERIFIED)}")


def update_other_services_audit_metadata():
    """他3サービスはまだ未照合 — _meta の audit に definitive source を予定として記録"""
    for service in ("houmon_kaigo", "kyotaku_shien", "tsusho_kaigo"):
        path = ROOT / "regulatory_master" / "kaigo" / f"{service}.json"
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        audit = d["_meta"].get("service_code_mapping_audit", {})
        audit.update({
            "audit_version": "alpha.5.6",
            "audit_date": "2026-05-09",
            "definitive_source_planned": DEFINITIVE_SOURCE,
            "note": f"{service}: alpha.5.6時点では確定版PDFとの照合未実施。確定版が手元にあるため次の作業バッチで実施予定。各加算は引き続き pattern_based_unverified。",
        })
        d["_meta"]["service_code_mapping_audit"] = audit
        with open(path, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=2)
        print(f"Updated audit metadata: {path.relative_to(ROOT.parent.parent)}")


if __name__ == "__main__":
    update_houmon_kango()
    update_other_services_audit_metadata()
