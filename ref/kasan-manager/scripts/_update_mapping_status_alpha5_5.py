"""alpha.5.5: regulatory_master/kaigo/houmon_kango_kaigo.json の各加算に
service_code_mapping_status と service_code_audit を追加する一回限りのマイグレーション。

WAM NET公式PDFと社内マスタの照合結果に基づき:
- 公式と整合する8加算 → checked
- 公式と不整合な5加算 → pattern_based_unverified（理由をauditに記録）
- 認知症専門ケア加算 → not_applicable
- 複数名・長時間（alpha.4.5でkasan-level確認済・コード未登録）→ pattern_based_unverified
- 未照合3加算（口腔連携・科学的介護・処遇改善）→ pattern_based_unverified
"""
import json
import sys
import io
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]

WAM_SOURCE = "WAM NET 介護給付費単位数等サービスコード表（令和6年4月施行・2024-03-18版）p67-69 訪問看護"
WAM_URL = "https://www.wam.go.jp/gyoseiShiryou-files/documents/2024/0314163446376/20240318_006.pdf"
CHECKED_DATE = "2026-05-07"

CHECKED_KASANS = {
    "tokubetsu_kanri_kasan_I": {"official_code": "134000", "official_unit": 500, "master_unit": 500, "consistency": "consistent"},
    "tokubetsu_kanri_kasan_II": {"official_code": "134001", "official_unit": 250, "master_unit": 250, "consistency": "consistent"},
    "kango_taisei_kyouka_kasan_I": {"official_code": "134010", "official_unit": 550, "master_unit": 550, "consistency": "consistent"},
    "kango_taisei_kyouka_kasan_II": {"official_code": "134005", "official_unit": 200, "master_unit": 200, "consistency": "consistent"},
    "service_taisei_kyouka_kasan_I": {"official_code": "136103", "official_unit": 6, "master_unit": 6, "consistency": "consistent",
                                       "note": "1回算定（イ及びロ算定時）。1月算定（ハ算定時）は136104=50単位"},
    "service_taisei_kyouka_kasan_II": {"official_code": "136101", "official_unit": 3, "master_unit": 3, "consistency": "consistent",
                                        "note": "1回算定（イ及びロ算定時）。1月算定（ハ算定時）は136102=25単位"},
    "taiin_kyoudou_shidou_kasan": {"official_code": "134003", "official_unit": 600, "master_unit": 600, "consistency": "consistent"},
    "kango_kaigo_renkei_kyouka_kasan": {"official_code": "134004", "official_unit": 250, "master_unit": 250, "consistency": "consistent"},
}

INCONSISTENT_KASANS = {
    "kinkyu_houmon_kango_kasan_I": {
        "official_code": "133100", "official_unit": 574, "master_unit": 600,
        "consistency": "inconsistent_unit_kubun",
        "note": "WAM NETは事業所種別区分（指定訪問看護S/医療機関）。社内マスタは令和6改定の要件区分（夜間負担軽減要件あり/なし）。構造解釈の差。要追加調査・alpha.5.6+で再照合"
    },
    "kinkyu_houmon_kango_kasan_II": {
        "official_code": "133200", "official_unit": 315, "master_unit": 574,
        "consistency": "inconsistent_unit_kubun",
        "note": "同上"
    },
    "terminal_care_kasan": {
        "official_code": "137000", "official_unit": 2000, "master_unit": 2500,
        "consistency": "inconsistent_unit",
        "note": "社内マスタの2500単位が公式の2000単位と不一致。マスタ訂正が必要（alpha.5.6+で対応）"
    },
    "shokai_kasan_I": {
        "official_code": "134002", "official_unit": 300, "master_unit": 350,
        "consistency": "inconsistent_unit_kubun",
        "note": "社内マスタは Ⅰ/Ⅱ 区分（350/300単位）。WAM NET公式PDFには区分なし（300単位）。alpha.5.6+で再照合"
    },
    "shokai_kasan_II": {
        "official_code": "134002", "official_unit": 300, "master_unit": 300,
        "consistency": "inconsistent_unit_kubun_II",
        "note": "社内マスタの単位値は公式と一致するが、区分構造が違う（公式は Ⅰ/Ⅱ なし）。alpha.5.6+で再照合"
    },
}

UNVERIFIED_KASANS = ["koukuu_renkei_kyouka_kasan", "kagakuteki_kaigo_suishin_kasan", "shougu_kaizen_kasan_2026_06"]


def main():
    path = ROOT / "regulatory_master" / "kaigo" / "houmon_kango_kaigo.json"
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    for k, v in d.get("kasans", {}).items():
        if k in CHECKED_KASANS:
            info = CHECKED_KASANS[k]
            v["service_code_mapping_status"] = "checked"
            v["service_code_audit"] = {
                "official_code": info["official_code"],
                "official_unit": info["official_unit"],
                "master_unit": info["master_unit"],
                "consistency": info["consistency"],
                "source_document": WAM_SOURCE,
                "source_url": WAM_URL,
                "source_checked_date": CHECKED_DATE,
            }
            if "note" in info:
                v["service_code_audit"]["note"] = info["note"]
        elif k in INCONSISTENT_KASANS:
            info = INCONSISTENT_KASANS[k]
            v["service_code_mapping_status"] = "pattern_based_unverified"
            v["service_code_audit"] = {
                "official_code": info["official_code"],
                "official_unit": info["official_unit"],
                "master_unit": info["master_unit"],
                "consistency": info["consistency"],
                "note": info["note"],
                "source_document": WAM_SOURCE,
                "source_url": WAM_URL,
                "source_checked_date": CHECKED_DATE,
                "follow_up": "alpha.5.6 で社内マスタ訂正検討",
            }
        elif k == "ninchi_senmon_care_kasan":
            v["service_code_mapping_status"] = "not_applicable"
            v["service_code_audit"] = {
                "consistency": "confirmed_not_applicable",
                "source_document": WAM_SOURCE,
                "source_url": WAM_URL,
                "source_checked_date": CHECKED_DATE,
                "note": "訪問看護プレフィックス13に該当コードなし（alpha.4.5 既確認）",
            }
        elif k.startswith("fukusu_mei_houmon_kango_kasan") or k == "chouji_kan_houmon_kango_kasan":
            v["service_code_mapping_status"] = "pattern_based_unverified"
            v["service_code_audit"] = {
                "consistency": "kasan_requirement_checked_no_code_match",
                "source_document": WAM_SOURCE,
                "source_url": WAM_URL,
                "source_checked_date": CHECKED_DATE,
                "note": "alpha.4.5 で加算要件・単位の公式根拠は確認済。サービスコード自体はマスタに登録なし（PDFパターンのみ）。alpha.5.6+で公式コード照合検討",
            }
        elif k in UNVERIFIED_KASANS:
            v["service_code_mapping_status"] = "pattern_based_unverified"
            v["service_code_audit"] = {
                "consistency": "unverified",
                "note": "WAM NET 介護給付費単位数等サービスコード表での照合 alpha.5.5 時点未実施。alpha.5.6+で対応",
            }
        else:
            if "service_code_mapping_status" not in v:
                v["service_code_mapping_status"] = "pattern_based_unverified"

    d.setdefault("_meta", {})
    d["_meta"]["service_code_mapping_audit"] = {
        "audit_version": "alpha.5.5",
        "audit_date": CHECKED_DATE,
        "audit_source_document": WAM_SOURCE,
        "audit_source_url": WAM_URL,
        "checked_count": len(CHECKED_KASANS),
        "inconsistent_count": len(INCONSISTENT_KASANS),
        "not_applicable_count": 1,
        "unverified_count": len(UNVERIFIED_KASANS) + 5,
        "note": "社内マスタの単位数・加算区分とWAM NET公式コード表の整合確認。整合する加算のみ checked 化。不整合は alpha.5.6 でマスタ訂正検討。",
    }

    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)

    print(f"Updated: {path.relative_to(ROOT.parent.parent)}")
    print(f"  checked: {len(CHECKED_KASANS)}")
    print(f"  inconsistent (pattern_based_unverified): {len(INCONSISTENT_KASANS)}")
    print(f"  not_applicable: 1")
    print(f"  unverified (alpha.4.5 kasan-level only): 5")
    print(f"  unverified (other): {len(UNVERIFIED_KASANS)}")


if __name__ == "__main__":
    main()
