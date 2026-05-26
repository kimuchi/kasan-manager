"""alpha.5.8: 三層コードモデル導入。各加算の service_code_audit に
official_code_model / receipt_detection_model / internal_legacy_model を追加する。

方針:
- 既存 service_code_mapping_status は維持（後方互換）
- overall_mapping_status を新設し、三層の整合度から判定
- checked 20件は keep_checked + 三層情報を充足
- 未解決45件は三層モデルで分類（needs_master_review / needs_legal_review / structural_mismatch / future_candidate）
- 一括置換しない・PDF検出を壊さない
"""
import json
import sys
import io
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
HOTFIX_DATE = "2026-05-10"
R7_8_SOURCE_ID = "WAM_R7_8_DEFINITIVE_2025_03_28"


def _build_three_layer(kasan_def: dict, service: str, kasan_key: str) -> dict:
    """各加算に三層モデルを付与。既存 audit と整合させる。"""
    existing_audit = kasan_def.get("service_code_audit") or {}
    mapping_status = kasan_def.get("service_code_mapping_status", "pattern_based_unverified")
    internal_codes = kasan_def.get("service_codes", [])
    internal_unit = (kasan_def.get("unit_per_month") or kasan_def.get("unit_per_day") or
                     kasan_def.get("unit_per_visit") or kasan_def.get("rate"))
    internal_name = kasan_def.get("name", "")

    # 1) official_code_model
    official_code_model = {
        "official_service_code": existing_audit.get("official_code"),
        "official_name": existing_audit.get("official_name") or internal_name,
        "official_unit": existing_audit.get("official_unit"),
        "official_calc_unit": kasan_def.get("unit_type", ""),
        "official_service_type": service,
        "source_id": existing_audit.get("source_id") or R7_8_SOURCE_ID,
        "source_kind": existing_audit.get("source_kind") or "definitive",
        "revision_status": existing_audit.get("revision_status") or "current_definitive",
        "effective_from": "2025-08-01",
        "effective_to": "2026-05-31",
        "official_match_type": existing_audit.get("match_type", "unverified"),
        "official_code_status": "checked" if mapping_status == "checked" else (
            "not_applicable" if mapping_status == "not_applicable" else
            "needs_review" if existing_audit.get("match_type") in ("code_mismatch", "code_and_unit_mismatch", "unit_mismatch") else
            "not_found" if existing_audit.get("match_type") == "not_found" else
            "structural_mismatch" if existing_audit.get("match_type") == "structural_mismatch" else
            "needs_review"
        ),
    }

    # 2) receipt_detection_model
    # PDF検出は HOUMON_KAIGO_KASAN_PATTERNS 等のパターンが正本
    # 社内 service_codes が公式コードと一致する場合のみ exact_official_code
    if mapping_status == "checked":
        receipt_status = "exact_official_code"
        receipt_source = "pdf_text"
    elif mapping_status == "not_applicable":
        receipt_status = "unknown"  # 該当コードなしのため検出なし
        receipt_source = "unknown"
    else:
        # 社内コードがあるが公式と不一致 → legacy_detection_only
        receipt_status = "legacy_detection_only" if internal_codes else "pattern_detection_only"
        receipt_source = "legacy_code" if internal_codes else "receipt_pattern"

    receipt_detection_model = {
        "receipt_detection_code": internal_codes[0] if internal_codes else None,
        "receipt_detection_name": internal_name,
        "receipt_detection_pattern": kasan_def.get("short_name") or internal_name,
        "receipt_detection_source": receipt_source,
        "receipt_detection_status": receipt_status,
    }

    # 3) internal_legacy_model
    legacy_keep = bool(internal_codes) and mapping_status != "checked"
    internal_legacy_model = {
        "internal_legacy_code": internal_codes[0] if internal_codes else None,
        "internal_legacy_name": internal_name,
        "internal_legacy_unit": internal_unit,
        "legacy_origin": "社内マスタ起源（公式照合前）" if internal_codes else "社内マスタにコード未登録",
        "keep_for_backward_compatibility": legacy_keep,
        "migration_note": (
            "checked 化済 — legacy code は公式と一致" if mapping_status == "checked" else
            "対象外加算 — legacy code は維持" if mapping_status == "not_applicable" else
            "公式コードと不一致。alpha.5.8+でマスタ訂正レビュー後に検討" if internal_codes else
            "コード未登録。PDFパターン検出のみで運用"
        ),
    }

    # 4) overall_mapping_status
    if mapping_status == "checked":
        # official_code_status checked + receipt_detection_status exact_official_code
        overall = "checked"
    elif mapping_status == "not_applicable":
        overall = "not_applicable"
    elif official_code_model["official_code_status"] == "needs_review":
        # コード不整合だが法令解釈は不要 → needs_master_review
        overall = "needs_review"
    elif official_code_model["official_code_status"] == "not_found":
        overall = "pattern_based_unverified"
    elif official_code_model["official_code_status"] == "structural_mismatch":
        overall = "needs_review"
    else:
        overall = "pattern_based_unverified"

    # proposed_action
    if mapping_status == "checked":
        proposed_action = "keep_checked"
    elif mapping_status == "not_applicable":
        proposed_action = "not_applicable_confirmed"
    elif official_code_model["official_code_status"] == "needs_review" and internal_codes:
        proposed_action = "needs_master_review"
    elif official_code_model["official_code_status"] == "structural_mismatch":
        proposed_action = "needs_legal_review"
    elif official_code_model["official_code_status"] == "not_found":
        if "shougu_kaizen" in kasan_key or "_2026_06" in kasan_key:
            proposed_action = "future_candidate_only"
        else:
            proposed_action = "keep_pattern_based_unverified"
    else:
        proposed_action = "keep_pattern_based_unverified"

    return {
        "official_code_model": official_code_model,
        "receipt_detection_model": receipt_detection_model,
        "internal_legacy_model": internal_legacy_model,
        "overall_mapping_status": overall,
        "proposed_action": proposed_action,
        "audit_note": existing_audit.get("audit_note") or existing_audit.get("note") or "",
        "alpha_5_8_three_layer_introduced_at": HOTFIX_DATE,
    }


def update_master(service: str):
    path = ROOT / "regulatory_master" / "kaigo" / f"{service}.json"
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    overall_breakdown = {"checked": 0, "needs_review": 0, "pattern_based_unverified": 0,
                         "not_applicable": 0, "provisional_future": 0}
    proposed_breakdown = {}
    for kasan_key, kasan_def in d.get("kasans", {}).items():
        three_layer = _build_three_layer(kasan_def, service, kasan_key)
        # 既存の service_code_audit は維持しつつ、三層モデルを別フィールドで追加
        existing_audit = kasan_def.get("service_code_audit") or {}
        existing_audit["alpha_5_8_three_layer_model"] = three_layer
        kasan_def["service_code_audit"] = existing_audit
        # overall_mapping_status を新設フィールドとして
        kasan_def["overall_mapping_status"] = three_layer["overall_mapping_status"]
        ovs = three_layer["overall_mapping_status"]
        overall_breakdown[ovs] = overall_breakdown.get(ovs, 0) + 1
        pa = three_layer["proposed_action"]
        proposed_breakdown[pa] = proposed_breakdown.get(pa, 0) + 1

    # _meta に三層モデル監査を追加
    audit_meta = d.get("_meta", {}).get("service_code_mapping_audit", {})
    audit_meta["audit_version"] = "alpha.5.8"
    audit_meta["audit_date"] = HOTFIX_DATE
    audit_meta["alpha_5_8_three_layer_model_introduced"] = {
        "schema_version": "alpha.5.8",
        "schema_path": "regulatory_master/sources/code_model_schema.json",
        "overall_mapping_status_breakdown": overall_breakdown,
        "proposed_action_breakdown": proposed_breakdown,
        "note": "三層モデル(official / receipt_detection / internal_legacy)導入。一括置換せず、各加算で公式コード・PDF検出・社内legacyを分離管理。",
    }
    d["_meta"]["service_code_mapping_audit"] = audit_meta

    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print(f"Updated {service}:")
    print(f"  overall: {overall_breakdown}")
    print(f"  proposed: {proposed_breakdown}")


if __name__ == "__main__":
    for svc in ("houmon_kango_kaigo", "tsusho_kaigo", "houmon_kaigo", "kyotaku_shien"):
        update_master(svc)
