"""alpha.5.7: source registry 導入 + 残り3サービスの R7.4 確定版照合 audit

判明した重要事実:
- 確定版 R7.4 (2025-02-01・「案」表示なし) を取得し、3サービスを照合
- houmon_kango_kaigo: alpha.5.6 14 checked が R7.4 でも全件同一コード・単位 → keep_checked
- tsusho_kaigo / houmon_kaigo / kyotaku_shien: 社内マスタの service_codes が公式 R7.4 と全件不整合
  - 例: 居宅介護支援初回加算 社内 438700 vs 公式 434001
  - 例: 訪問介護緊急時 社内 116500 vs 公式 114000
  - 社内コード体系は公式コード体系と異なる構造を採用していた可能性
- 社内マスタを訂正せず、audit_note で公式コードと不整合を可視化（pattern_based_unverified 維持）
- マスタコード訂正は alpha.5.8+ で別途レビュー後に実施
"""
import json
import sys
import io
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]

R7_4_SOURCE_ID = "WAM_R7_4_DEFINITIVE_2025_02_01"
R6_6_8_SOURCE_ID = "WAM_R6_6_8_DEFINITIVE_2024_05_07"
CHECKED_DATE = "2026-05-10"


# === 通所介護 R7.4 official codes (p138 で確認) ===
TSUSHO_OFFICIAL_CODES = {
    "kobetsu_kinou_I_i": {"official_code": "155051", "official_unit": 56, "name": "個別機能訓練加算（Ⅰ）イ"},
    "kobetsu_kinou_I_ro": {"official_code": "155053", "official_unit": 76, "name": "個別機能訓練加算（Ⅰ）ロ"},
    "kobetsu_kinou_II_life": {"official_code": "155052", "official_unit": 20, "name": "個別機能訓練加算（Ⅱ）"},
    "nyuyoku_I": {"official_code": "155301", "official_unit": 40, "name": "入浴介助加算（Ⅰ）"},
    "nyuyoku_II": {"official_code": "155303", "official_unit": 55, "name": "入浴介助加算（Ⅱ）"},
    "koukuu_kinou_I": {"official_code": "155606", "official_unit": 150, "name": "口腔機能向上加算（Ⅰ）"},
    "eiyou_assessment": {"official_code": "156116", "official_unit": 50, "name": "栄養アセスメント加算"},
    "eiyou_kaizen": {"official_code": "155605", "official_unit": 200, "name": "栄養改善加算"},
    "kagakuteki_kaigo": {"official_code": "156361", "official_unit": 40, "name": "科学的介護推進体制加算"},
    "chujudosha_care_taisei": {"official_code": "155306", "official_unit": 45, "name": "中重度者ケア体制加算"},
    "ninchi_kasan": {"official_code": "155305", "official_unit": 60, "name": "認知症加算"},
    "adl_iji": {"official_code": "156338", "official_unit": 30, "name": "ADL維持等加算（Ⅰ）"},
}

# === 訪問介護 R7.4 official codes (p23 で確認) ===
HOUMON_KAIGO_OFFICIAL_CODES = {
    "shokai_kasan": {"official_code": "114001", "official_unit": 200, "name": "初回加算"},
    "kinkyu_houmon": {"official_code": "114000", "official_unit": 100, "name": "緊急時訪問介護加算"},
    "seikatsu_kinou_renkei_I": {"official_code": "114003", "official_unit": 100, "name": "生活機能向上連携加算（Ⅰ）"},
    "seikatsu_kinou_renkei_II": {"official_code": "114002", "official_unit": 200, "name": "生活機能向上連携加算（Ⅱ）"},
    "koukuu_renkei_kyouka": {"official_code": "116192", "official_unit": 50, "name": "口腔連携強化加算"},
    "ninchi_senmon_care_I": {"official_code": "114004", "official_unit": 3, "name": "認知症専門ケア加算（Ⅰ）"},
    "ninchi_senmon_care_II": {"official_code": "114005", "official_unit": 4, "name": "認知症専門ケア加算（Ⅱ）"},
}

# === 居宅介護支援 R7.4 official codes (p332 で確認) ===
KYOTAKU_SHIEN_OFFICIAL_CODES = {
    "shokai_kasan": {"official_code": "434001", "official_unit": 300, "name": "初回加算"},
    "tokutei_jigyousho_I": {"official_code": "434002", "official_unit": 519, "name": "特定事業所加算（Ⅰ）"},
    "tokutei_jigyousho_II": {"official_code": "434003", "official_unit": 421, "name": "特定事業所加算（Ⅱ）"},
    "tokutei_jigyousho_III": {"official_code": "434004", "official_unit": 323, "name": "特定事業所加算（Ⅲ）"},
    "tokutei_jigyousho_A": {"official_code": "434006", "official_unit": 114, "name": "特定事業所加算（Ａ）"},
    "tokutei_jigyousho_iryou_kaigo": {"official_code": "434005", "official_unit": 125, "name": "特定事業所医療介護連携加算"},
    "nyuin_jouhou_renkei_I": {"official_code": "436125", "official_unit": 250, "name": "入院時情報連携加算（Ⅰ）"},
    "nyuin_jouhou_renkei_II": {"official_code": "436129", "official_unit": 200, "name": "入院時情報連携加算（Ⅱ）"},
    "taiin_taisho_kasan_I_i": {"official_code": "436132", "official_unit": 450, "name": "退院・退所加算（Ⅰ）イ"},
    "taiin_taisho_kasan_I_ro": {"official_code": "436143", "official_unit": 600, "name": "退院・退所加算（Ⅰ）ロ"},
    "taiin_taisho_kasan_II_i": {"official_code": "436144", "official_unit": 600, "name": "退院・退所加算（Ⅱ）イ"},
    "taiin_taisho_kasan_II_ro": {"official_code": "436145", "official_unit": 750, "name": "退院・退所加算（Ⅱ）ロ"},
    "taiin_taisho_kasan_III": {"official_code": "436146", "official_unit": 900, "name": "退院・退所加算（Ⅲ）"},
    "tsuuin_jouhou_renkei": {"official_code": "436135", "official_unit": 50, "name": "通院時情報連携加算"},
    "kinkyu_kyotaku_conference": {"official_code": "436133", "official_unit": 200, "name": "緊急時等居宅カンファレンス加算"},
    "terminal_care_management": {"official_code": "436100", "official_unit": 400, "name": "ターミナルケアマネジメント加算"},
}


def _audit_kasan(kasan_def: dict, kasan_key: str, official: dict | None, service: str) -> dict:
    """各加算の audit_note を返す。social_codes と公式コードを比較。"""
    internal_codes = kasan_def.get("service_codes", [])
    internal_unit = (kasan_def.get("unit_per_month") or kasan_def.get("unit_per_day") or
                     kasan_def.get("unit_per_visit") or kasan_def.get("rate"))

    if official is None:
        return {
            "match_type": "not_found",
            "audit_note": f"R7.4確定版に対応コードを抽出できなかった（alpha.5.7時点で要追加調査）",
            "internal_service_codes": internal_codes,
            "internal_unit": internal_unit,
        }

    code_match = official["official_code"] in internal_codes
    unit_match = (official["official_unit"] == internal_unit)

    if code_match and unit_match:
        return {
            "match_type": "exact_match",
            "audit_note": f"R7.4確定版で完全整合（コード・単位とも一致）",
            "internal_service_codes": internal_codes,
            "internal_unit": internal_unit,
            "official_code": official["official_code"],
            "official_unit": official["official_unit"],
            "official_name": official["name"],
        }
    elif unit_match and not code_match:
        return {
            "match_type": "code_mismatch",
            "audit_note": f"単位は一致するがサービスコードが不一致。社内コード体系は公式と異なる可能性。マスタ訂正候補（alpha.5.8+）",
            "internal_service_codes": internal_codes,
            "internal_unit": internal_unit,
            "official_code": official["official_code"],
            "official_unit": official["official_unit"],
            "official_name": official["name"],
        }
    elif code_match and not unit_match:
        return {
            "match_type": "unit_mismatch",
            "audit_note": f"コードは一致するが単位が不一致。社内マスタ {internal_unit} vs 公式 {official['official_unit']}。要マスタ確認",
            "internal_service_codes": internal_codes,
            "internal_unit": internal_unit,
            "official_code": official["official_code"],
            "official_unit": official["official_unit"],
            "official_name": official["name"],
        }
    else:
        return {
            "match_type": "code_and_unit_mismatch",
            "audit_note": f"コードも単位も不一致。社内マスタ code={internal_codes}/{internal_unit}単位 vs 公式 {official['official_code']}/{official['official_unit']}単位。社内コード体系の根本見直しが必要（alpha.5.8+）",
            "internal_service_codes": internal_codes,
            "internal_unit": internal_unit,
            "official_code": official["official_code"],
            "official_unit": official["official_unit"],
            "official_name": official["name"],
        }


def update_service(service: str, official_codes: dict):
    path = ROOT / "regulatory_master" / "kaigo" / f"{service}.json"
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    matches = {"exact_match": 0, "code_mismatch": 0, "unit_mismatch": 0,
               "code_and_unit_mismatch": 0, "not_found": 0}
    for kasan_key, kasan_def in d.get("kasans", {}).items():
        official = official_codes.get(kasan_key)
        audit = _audit_kasan(kasan_def, kasan_key, official, service)
        # alpha.5.7: source registry 参照
        kasan_def["service_code_audit"] = {
            **audit,
            "source_id": R7_4_SOURCE_ID,
            "source_kind": "definitive",
            "revision_status": "current_definitive",
            "source_checked_date": CHECKED_DATE,
            "audit_version": "alpha.5.7",
        }
        # exact_match のみ checked にできるが、alpha.5.7 では社内コードが大幅不一致のため pattern_based_unverified 維持
        # （マスタ訂正なしで checked にすると判定が壊れるため）
        if audit["match_type"] == "exact_match":
            kasan_def["service_code_mapping_status"] = "checked"
        else:
            kasan_def["service_code_mapping_status"] = "pattern_based_unverified"
        matches[audit["match_type"]] = matches.get(audit["match_type"], 0) + 1

    # _meta audit summary 更新
    d.setdefault("_meta", {})
    d["_meta"]["service_code_mapping_audit"] = {
        "audit_version": "alpha.5.7",
        "audit_date": CHECKED_DATE,
        "primary_source_id": R7_4_SOURCE_ID,
        "primary_source_kind": "definitive",
        "primary_source_revision_status": "current_definitive",
        "match_type_breakdown": matches,
        "checked_count": matches.get("exact_match", 0),
        "pattern_based_unverified_count": sum(v for k, v in matches.items() if k != "exact_match"),
        "not_applicable_count": 0,
        "note": f"{service}: alpha.5.7 で R7.4確定版（current_definitive）と照合実施。コード・単位整合は exact_match のみ checked、それ以外は社内マスタ訂正候補として pattern_based_unverified 維持。詳細は service_code_audit 参照。",
    }

    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print(f"Updated: {service}")
    print(f"  match_type_breakdown: {matches}")


def update_houmon_kango_kaigo_with_r7_4_reconfirm():
    """訪問看護: alpha.5.6 14件 checked を維持し、R7.4 でも整合確認したことを記録"""
    path = ROOT / "regulatory_master" / "kaigo" / "houmon_kango_kaigo.json"
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    # 各 checked 加算の audit に R7.4 確認を追加
    for kasan_key, kasan_def in d.get("kasans", {}).items():
        if kasan_def.get("service_code_mapping_status") == "checked":
            audit = kasan_def.get("service_code_audit") or {}
            audit["source_id"] = R6_6_8_SOURCE_ID
            audit["alpha_5_7_r7_4_reconfirm"] = {
                "source_id": R7_4_SOURCE_ID,
                "match_type": "exact_match",
                "confirmed_at": CHECKED_DATE,
                "note": "R7.4確定版 (2025-02-01) でも同一コード・単位を確認 (R6.6/8 と R7.4 で訪問看護加算は変更なし)",
            }
            kasan_def["service_code_audit"] = audit

    # _meta audit summary 更新
    audit = d["_meta"].get("service_code_mapping_audit", {})
    audit["audit_version"] = "alpha.5.7"
    audit["audit_date"] = CHECKED_DATE
    audit["alpha_5_7_r7_4_reconfirm"] = {
        "source_id": R7_4_SOURCE_ID,
        "result": "no_diff_from_r6_6_8",
        "note": "R6.6/8 と R7.4 で訪問看護加算は同一コード・単位（21コード）。alpha.5.6 の14件 checked を R7.4 でも維持。",
    }
    audit["sources_consulted"] = [R6_6_8_SOURCE_ID, R7_4_SOURCE_ID]
    d["_meta"]["service_code_mapping_audit"] = audit

    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print("Updated: houmon_kango_kaigo (R7.4 reconfirm added)")


if __name__ == "__main__":
    update_houmon_kango_kaigo_with_r7_4_reconfirm()
    update_service("tsusho_kaigo", TSUSHO_OFFICIAL_CODES)
    update_service("houmon_kaigo", HOUMON_KAIGO_OFFICIAL_CODES)
    update_service("kyotaku_shien", KYOTAKU_SHIEN_OFFICIAL_CODES)
