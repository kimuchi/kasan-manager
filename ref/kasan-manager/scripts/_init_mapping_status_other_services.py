"""alpha.5.5: 他3サービス（houmon_kaigo / kyotaku_shien / tsusho_kaigo）に
service_code_mapping_status の初期値（pattern_based_unverified）を明示的に設定。

これらは alpha.5.5 時点で WAM NET 公式PDFとの照合作業を行っていないため、
全加算が pattern_based_unverified である事実を明示化する。alpha.5.6+ で照合予定。
"""
import json
import sys
import io
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
SERVICES = ["houmon_kaigo", "kyotaku_shien", "tsusho_kaigo"]
CHECKED_DATE = "2026-05-07"


def main():
    for service in SERVICES:
        path = ROOT / "regulatory_master" / "kaigo" / f"{service}.json"
        with open(path, encoding="utf-8") as f:
            d = json.load(f)

        unverified_count = 0
        for k, v in d.get("kasans", {}).items():
            if "service_code_mapping_status" not in v:
                v["service_code_mapping_status"] = "pattern_based_unverified"
                v["service_code_audit"] = {
                    "consistency": "unverified",
                    "note": "alpha.5.5 時点で WAM NET 介護給付費単位数等サービスコード表との照合未実施。alpha.5.6+で対応予定。",
                }
                unverified_count += 1

        d.setdefault("_meta", {})
        d["_meta"]["service_code_mapping_audit"] = {
            "audit_version": "alpha.5.5",
            "audit_date": CHECKED_DATE,
            "audit_source_document": "未照合（alpha.5.6+で WAM NET 介護給付費単位数等サービスコード表 で照合予定）",
            "checked_count": 0,
            "inconsistent_count": 0,
            "not_applicable_count": 0,
            "unverified_count": unverified_count,
            "note": f"{service}: 公式コード表との照合は alpha.5.6+ で実施。現状は社内資料・パターンベース。",
        }

        with open(path, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=2)

        print(f"Updated: {path.relative_to(ROOT.parent.parent)} ({unverified_count} kasans → pattern_based_unverified)")


if __name__ == "__main__":
    main()
