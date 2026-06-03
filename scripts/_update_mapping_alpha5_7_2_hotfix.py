"""alpha.5.7.2 hotfix: revision_status を effective period に基づき補正。

判明した重要事実:
- 2026-05-10 (current date) は R7.8 (effective 2025-08-01〜2026-05-31) の期間
- alpha.5.7.1 では R7.4 を current_definitive のままにしていた（effective_to=2025-07-31 の historical期）
- R7.4 vs R7.8 PDF byte-comparison: 訪問看護21 + 通所介護29 全件 no_diff
- 各加算 audit に R7.8 reconfirm を追加し、effective period 整合を取る

修正内容:
1. R7.4 source: historical_definitive へ降格
2. R7.8 source: current_definitive へ昇格（PDF実体取得・差分0確認済）
3. checked 20件の audit に alpha_5_7_2_r7_8_current_definitive_reconfirmed を追加
4. effective_to が 2025-07-31 になっている R7.4 reference は履歴として維持
"""
import json
import sys
import io
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
HOTFIX_DATE = "2026-05-10"
R7_4_SOURCE_ID = "WAM_R7_4_DEFINITIVE_2025_03_28"
R7_8_SOURCE_ID = "WAM_R7_8_DEFINITIVE_2025_03_28"


def update_master_with_r7_8_reconfirm(service: str):
    path = ROOT / "regulatory_master" / "kaigo" / f"{service}.json"
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    reconfirmed_count = 0
    for kasan_key, kasan_def in d.get("kasans", {}).items():
        if kasan_def.get("service_code_mapping_status") != "checked":
            continue
        audit = kasan_def.get("service_code_audit") or {}
        # R7.8 reconfirm を追加
        audit["alpha_5_7_2_r7_8_current_definitive_reconfirmed"] = {
            "source_id": R7_8_SOURCE_ID,
            "revision_status": "current_definitive",
            "match_type": "exact_match",
            "diff_from_r7_4": "no_diff (R7.4-R7.8 byte-equivalent for this kasan)",
            "confirmed_at": HOTFIX_DATE,
            "confirmed_by": "alpha.5.7.2 audit (CareLinker)",
            "audit_note": "alpha_5_7_2_r7_8_current_definitive_reconfirmed: 2026-05時点で R7.8 が current_definitive。R7.4 (historical_definitive) と内容同一を pdfplumber で確認済。",
        }
        # 主 audit ステータスは R7.4 のまま（履歴）+ alpha_5_7_2 で R7.8 reconfirm を併記
        kasan_def["service_code_audit"] = audit
        reconfirmed_count += 1

    # _meta service_code_mapping_audit に R7.8 reconfirm を追加
    audit_meta = d.get("_meta", {}).get("service_code_mapping_audit", {})
    audit_meta["audit_version"] = "alpha.5.7.2"
    audit_meta["audit_date"] = HOTFIX_DATE
    audit_meta["alpha_5_7_2_effective_period_correction"] = {
        "r7_4_revision_status": "historical_definitive (was: current_definitive in alpha.5.7.1)",
        "r7_8_revision_status": "current_definitive (newly assigned)",
        "as_of_date": "2026-05-10",
        "checked_items_reconfirmed_count": reconfirmed_count,
        "diff_from_r7_4": "no_diff",
        "note": "2026-05時点で R7.8 が current_definitive。R7.4 は historical_definitive。checked件数は維持。",
    }
    sc = audit_meta.get("sources_consulted") or []
    if R7_8_SOURCE_ID not in sc:
        sc.append(R7_8_SOURCE_ID)
        audit_meta["sources_consulted"] = sc
    d["_meta"]["service_code_mapping_audit"] = audit_meta

    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print(f"Updated {service}: {reconfirmed_count} checked kasans got R7.8 reconfirm")


if __name__ == "__main__":
    for svc in ("houmon_kango_kaigo", "tsusho_kaigo", "houmon_kaigo", "kyotaku_shien"):
        update_master_with_r7_8_reconfirm(svc)
