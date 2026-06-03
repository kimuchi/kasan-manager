"""alpha.5.7.1 hotfix: source registry anchor 修正。

判明した重要事実:
- alpha.5.7 で current_definitive とした WAM_R7_4_DEFINITIVE_2025_02_01 (2025-02-01 PDF) は、
  親ページが「介護保険事務処理システム変更に係る参考資料（その２）（令和7年2月3日事務連絡）」
  という「案・予備版」のページだった。
- 本物の R7.4 確定版は「介護保険事務処理システム変更に係る参考資料（確定版）（令和7年3月28日事務連絡）」
  配下の `20250328_005.pdf` (R7.4.1) と `20250328_006.pdf` (R7.8.1)
- PDFは内容同一だが、source_kind は親ページのstatusで判定する必要があるため hotfix。

Hotfix 内容:
1. 旧 source_id `WAM_R7_4_DEFINITIVE_2025_02_01` → registry で `WAM_R7_4_PROVISIONAL_2025_02_01` に降格
2. 新 source_id `WAM_R7_4_DEFINITIVE_2025_03_28` を current_definitive として追加
3. R7.8 / R8.6 案 source も registry に追加
4. 各 master の service_code_audit の source_id を 2025-02-01 → 2025-03-28 に差し替え
5. 内容同一が確認できているため checked 20件全件維持
6. audit_note に alpha_5_7_1_source_anchor_corrected_to_r7_4_definitive を追加
"""
import json
import sys
import io
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]

OLD_PROVISIONAL_SOURCE_ID = "WAM_R7_4_PROVISIONAL_2025_02_01"
NEW_DEFINITIVE_SOURCE_ID = "WAM_R7_4_DEFINITIVE_2025_03_28"
HOTFIX_DATE = "2026-05-10"


def update_master_audit_source_id(service: str):
    """各加算の service_code_audit.source_id を 2025-02-01版 → 2025-03-28版 に差し替え。
    PDF内容同一が確認済のため checked は維持し、audit_note を追加する。"""
    path = ROOT / "regulatory_master" / "kaigo" / f"{service}.json"
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    swapped_count = 0
    for kasan_key, kasan_def in d.get("kasans", {}).items():
        audit = kasan_def.get("service_code_audit") or {}
        old_sid = audit.get("source_id")
        # 2025-02-01版を参照していた場合は確定版へ差し替え
        if old_sid in (
            "WAM_R7_4_DEFINITIVE_2025_02_01",  # alpha.5.7 で誤って definitive 扱いだったID
            OLD_PROVISIONAL_SOURCE_ID,         # 万一 demote 後の id を直接参照していた場合
        ):
            audit["source_id"] = NEW_DEFINITIVE_SOURCE_ID
            audit["source_kind"] = "definitive"
            audit["revision_status"] = "current_definitive"
            audit["alpha_5_7_1_source_anchor_corrected_to_r7_4_definitive"] = {
                "previous_source_id": "WAM_R7_4_DEFINITIVE_2025_02_01",
                "previous_status": "ERRONEOUSLY_TREATED_AS_DEFINITIVE",
                "corrected_to_source_id": NEW_DEFINITIVE_SOURCE_ID,
                "corrected_to_revision_status": "current_definitive",
                "diff_from_previous_pdf": "no_diff (PDF contents identical for 訪問看護21 + 通所介護29 加算行)",
                "corrected_at": HOTFIX_DATE,
                "note": "alpha.5.7 で誤って current_definitive 扱いされていた 2025-02-01 PDF は親ページが「（その2）」（案）。alpha.5.7.1 で 2025-03-28 確定版に差し替え。",
            }
            kasan_def["service_code_audit"] = audit
            swapped_count += 1
        # alpha_5_7_r7_4_reconfirm の参照も更新
        recf = audit.get("alpha_5_7_r7_4_reconfirm")
        if isinstance(recf, dict) and recf.get("source_id") == "WAM_R7_4_DEFINITIVE_2025_02_01":
            recf["source_id"] = NEW_DEFINITIVE_SOURCE_ID
            recf["alpha_5_7_1_source_anchor_corrected"] = True
            audit["alpha_5_7_r7_4_reconfirm"] = recf

    # _meta service_code_mapping_audit の source_id も差し替え
    audit_meta = d.get("_meta", {}).get("service_code_mapping_audit", {})
    if audit_meta.get("primary_source_id") == "WAM_R7_4_DEFINITIVE_2025_02_01":
        audit_meta["primary_source_id"] = NEW_DEFINITIVE_SOURCE_ID
        audit_meta["audit_version"] = "alpha.5.7.1"
        audit_meta["audit_date"] = HOTFIX_DATE
        audit_meta["alpha_5_7_1_hotfix"] = "source_anchor_corrected_to_r7_4_definitive_2025_03_28"
    if audit_meta.get("alpha_5_7_r7_4_reconfirm", {}).get("source_id") == "WAM_R7_4_DEFINITIVE_2025_02_01":
        audit_meta["alpha_5_7_r7_4_reconfirm"]["source_id"] = NEW_DEFINITIVE_SOURCE_ID
        audit_meta["alpha_5_7_r7_4_reconfirm"]["alpha_5_7_1_source_anchor_corrected"] = True

    # sources_consulted リストも差し替え
    sc = audit_meta.get("sources_consulted") or []
    if "WAM_R7_4_DEFINITIVE_2025_02_01" in sc:
        sc = [NEW_DEFINITIVE_SOURCE_ID if s == "WAM_R7_4_DEFINITIVE_2025_02_01" else s for s in sc]
        audit_meta["sources_consulted"] = sc

    d["_meta"]["service_code_mapping_audit"] = audit_meta

    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print(f"Updated {service}: swapped {swapped_count} kasans' source_id from 2025-02-01 to 2025-03-28")


if __name__ == "__main__":
    for svc in ("houmon_kango_kaigo", "tsusho_kaigo", "houmon_kaigo", "kyotaku_shien"):
        update_master_audit_source_id(svc)
