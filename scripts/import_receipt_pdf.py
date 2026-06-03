"""CareLinker 加算チェッカー alpha.4.4: 介護給付費明細書PDF → evidence JSON 変換

通所介護・訪問介護・居宅介護支援・訪問看護（介護保険）のレセプトPDFから現状算定中加算・要介護度分布・サービス区分を抽出し、
tenant_data/evidence/<office_code>/receipt_pdf_<timestamp>.json に保存する。

設計方針:
- 個人情報（被保険者番号・氏名・住所・電話番号）は保存しない
- 抽出できなかった項目は warnings に記録、unknown扱い
- OCR前提にしない。PDFテキスト抽出（pdfplumber）で対応
- PDFがない場合は --sample-text でテキストファイルを直接渡してテスト可

使い方:
    python import_receipt_pdf.py --service tsusho_kaigo --office <code> \\
        --pdf <pdf_path> --evidence-out <output_dir or json>

    # PDFなしテスト
    python import_receipt_pdf.py --service tsusho_kaigo --office DEMO-0004 \\
        --sample-text tests/fixtures/tsusho_receipt_sample_text.txt \\
        --evidence-out tenant_data/evidence/DEMO-0004/receipt_pdf_sample.json
"""
import argparse
import json
import re
import sys
import io
from collections import Counter
from datetime import datetime
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

EXTRACTION_VERSION = "v2026.05.06-alpha.4.4"

# サービスコードマッピングの根拠管理（service-level・サマリ用）
# - checked: 公式サービスコード表で全加算確認済
# - partial_checked: 一部加算のみ公式確認済・残りは pattern_based_unverified
# - pattern_based_unverified: パターンベース推定。公式根拠未確認
# - source_required: 公式根拠未確認のため使用前確認必須
# alpha.5.5: per-kasan の mapping_status は regulatory_master の各kasan.service_code_mapping_status を正本とする
SERVICE_CODE_MAPPING_STATUS = {
    "tsusho_kaigo": {
        "status": "partial_checked",
        "source": "WAM NET 介護給付費単位数等サービスコード表（R7.8.1）（令和7年8月施行版・確定版）+ 社内マスタ tsusho_kaigo.json",
        "source_id": "WAM_R7_8_DEFINITIVE_2025_03_28",
        "source_url": "https://www.wam.go.jp/gyoseiShiryou-files/documents/2025/0325232829413/20250328_006.pdf",
        "source_kind": "definitive",
        "revision_status": "current_definitive",
        "alpha_5_7_2_note": "2026-05時点で R7.8.1 (effective 2025-08-01〜2026-05-31) が current_definitive。R7.4 は historical_definitive。R7.4 と R7.8 で通所介護29コード・訪問看護21コードとも内容同一を確認済。",
        "source_checked_date": "2026-05-10",
        "alpha_5_7_1_hotfix_note": "alpha.5.7 で誤って 2025-02-01版（親ページが「その2」案）を current_definitive 扱いしていた。alpha.5.7.1 で 2025-03-28 確定版（親ページ「確定版」）に source anchor を訂正。PDF内容は同一のため checked 件数は維持。",
        "note": "alpha.5.7.1 で R7.4 確定版（current_definitive）と再照合。13加算中6加算 exact_match→checked、6加算 code_mismatch（社内コード体系不整合）、1加算 not_found。詳細は per-kasan service_code_audit 参照。",
    },
    "houmon_kaigo": {
        "status": "pattern_based_unverified",
        "source": "WAM NET 介護給付費単位数等サービスコード表（R7.8.1）（令和7年8月施行版・確定版）+ 社内マスタ houmon_kaigo.json",
        "source_id": "WAM_R7_8_DEFINITIVE_2025_03_28",
        "source_url": "https://www.wam.go.jp/gyoseiShiryou-files/documents/2025/0325232829413/20250328_006.pdf",
        "source_kind": "definitive",
        "revision_status": "current_definitive",
        "alpha_5_7_2_note": "2026-05時点で R7.8.1 が current_definitive。",
        "source_checked_date": "2026-05-10",
        "alpha_5_7_1_hotfix_note": "source anchor 修正（2025-02-01案→2025-03-28確定版）。",
        "note": "alpha.5.7.1 で R7.4 確定版と再照合。13加算中 exact_match=0、code_mismatch=7、not_found=6。社内コード体系（116XXX）と公式コード体系（114XXX/116192等）が大きく異なるため checked 化は次バッチで社内マスタ訂正後に再評価。pattern_based_unverified 維持。",
    },
    "kyotaku_shien": {
        "status": "pattern_based_unverified",
        "source": "WAM NET 介護給付費単位数等サービスコード表（R7.8.1）（令和7年8月施行版・確定版）+ 社内マスタ kyotaku_shien.json",
        "source_id": "WAM_R7_8_DEFINITIVE_2025_03_28",
        "source_url": "https://www.wam.go.jp/gyoseiShiryou-files/documents/2025/0325232829413/20250328_006.pdf",
        "source_kind": "definitive",
        "revision_status": "current_definitive",
        "alpha_5_7_2_note": "2026-05時点で R7.8.1 が current_definitive。",
        "source_checked_date": "2026-05-10",
        "alpha_5_7_1_hotfix_note": "source anchor 修正（2025-02-01案→2025-03-28確定版）。",
        "note": "alpha.5.7.1 で R7.4 確定版と再照合。18加算中 exact_match=0、code_mismatch=16、not_found=2。社内コード体系（438XXX）と公式コード体系（434XXX/436XXX）が大きく異なるため checked 化は次バッチで社内マスタ訂正後に再評価。特定事業所加算(I)の40%要件は地域包括紹介除外などPDFのみでは確定できない。",
    },
    "houmon_kango_kaigo": {
        "status": "partial_checked",
        "source": "WAM NET 介護給付費単位数等サービスコード表（令和6年6月・8月施行版・2024-05-07版）p65-74 訪問看護 + 社内マスタ houmon_kango_kaigo.json",
        "source_url": "https://www.wam.go.jp/gyoseiShiryou-files/documents/2024/0506103517756/20240507_006.pdf",
        "source_kind": "definitive",
        "source_checked_date": "2026-05-09",
        "note": "alpha.5.6 で確定版（definitive・「案」表示なし・令和6.6.1/8月施行版）と再照合実施。22加算中14加算 checked化（alpha.5.5 8件維持 + 5件昇格 + 1件新規）、1加算 not_applicable（認知症専門ケア・訪看では対象外）、7加算 pattern_based_unverified（科学的介護推進・R8.6処遇改善・複数名×4・長時間 — 構造差/対象期間外）。alpha.5.5 で根拠とした 2024-03-18 PDF はタイトルに「（案）」表示があり source_kind=provisional。各加算の per-kasan mapping_status とソースはマスタ参照。",
    },
}

ZENKAKU_DIGITS = "0123456789"
z2h_table = str.maketrans(ZENKAKU_DIGITS, "0123456789")


def z2h(s: str) -> str:
    return s.translate(z2h_table)


# 通所介護: kasan_master/tsusho_kaigo.json と整合
TSUSHO_KASAN_PATTERNS = [
    ("kobetsu_kinou_I_i", "個別機能訓練加算Ⅰ(イ)", "155051", "個別機能訓練加算Ⅰ1"),
    ("kobetsu_kinou_I_ro", "個別機能訓練加算Ⅰ(ロ)", "155053", "個別機能訓練加算Ⅰ2"),
    ("kobetsu_kinou_II_life", "個別機能訓練加算Ⅱ", "155052", "個別機能訓練加算Ⅱ"),
    ("nyuyoku_I", "入浴介助加算Ⅰ", "155301", "入浴介助加算Ⅰ"),
    ("nyuyoku_II", "入浴介助加算Ⅱ", "155302", "入浴介助加算Ⅱ"),
    ("koukuu_kinou_I", "口腔機能向上加算Ⅰ", "155501", "口腔機能向上"),
    ("eiyou_assessment", "栄養アセスメント加算", "156116", "栄養アセスメント"),
    ("eiyou_kaizen", "栄養改善加算", "156112", "栄養改善"),
    ("kagakuteki_kaigo", "科学的介護推進体制加算", "156361", "科学的介護推進"),
    ("chujudosha_care_taisei", "中重度者ケア体制加算", "156271", "中重度者ケア体制加算"),
    ("ninchi_kasan", "認知症加算", "156274", "認知症加算"),
    ("adl_iji", "ADL維持等加算", "156275", "ADL維持"),
]

HOUMON_KASAN_PATTERNS = [
    ("shokai_kasan", "初回加算", "116200", "初回加算"),
    ("seikatsu_kinou_renkei_I", "生活機能向上連携加算(I)", "116301", "生活機能向上連携加算Ⅰ"),
    ("seikatsu_kinou_renkei_II", "生活機能向上連携加算(II)", "116302", "生活機能向上連携加算Ⅱ"),
    ("ninchi_senmon_care_I", "認知症専門ケア加算(I)", "116401", "認知症専門ケア加算Ⅰ"),
    ("ninchi_senmon_care_II", "認知症専門ケア加算(II)", "116402", "認知症専門ケア加算Ⅱ"),
    ("kinkyu_houmon", "緊急時訪問介護加算", "116500", "緊急時訪問介護加算"),
    ("koukuu_renkei_kyouka", "口腔連携強化加算", "116600", "口腔連携強化加算"),
    ("tokutei_jigyousho_I", "特定事業所加算(I)", "116100", "特定事業所加算Ⅰ"),
    ("tokutei_jigyousho_II", "特定事業所加算(II)", "116101", "特定事業所加算Ⅱ"),
    ("tokutei_jigyousho_III", "特定事業所加算(III)", "116102", "特定事業所加算Ⅲ"),
    ("tokutei_jigyousho_IV", "特定事業所加算(IV)", "116103", "特定事業所加算Ⅳ"),
    ("tokutei_jigyousho_V", "特定事業所加算(V)", "116104", "特定事業所加算Ⅴ"),
    ("shougu_kaizen_kasan", "介護職員処遇改善加算", None, "処遇改善加算"),
]

# 訪問介護のサービス区分パターン
HOUMON_SERVICE_CATEGORIES = [
    ("shintai_kaigo", "身体介護", r"身体[0-9]"),
    ("seikatsu_enjyo", "生活援助", r"生活[0-9]"),
    ("shintai_seikatsu", "身体生活", r"身体生活|身生"),
    ("tsuuin_jouko", "通院等乗降介助", r"通院乗降|乗降介助"),
    ("futari_kaigo", "2人介護", r"2人介護|二人介護|複数訪問"),
]

# 訪問介護の時間帯加算
HOUMON_TIME_BANDS = [
    ("soucho", "早朝(6:00-8:00)", r"早朝"),
    ("yakan", "夜間(18:00-22:00)", r"夜間"),
    ("shinya", "深夜(22:00-6:00)", r"深夜"),
]

HOUMON_KANGO_KAIGO_KASAN_PATTERNS = [
    ("kinkyu_houmon_kango_kasan_I", "緊急時訪問看護加算(I)", "136100", "緊急時訪問看護加算Ⅰ"),
    ("kinkyu_houmon_kango_kasan_II", "緊急時訪問看護加算(II)", "136101", "緊急時訪問看護加算Ⅱ"),
    ("tokubetsu_kanri_kasan_I", "特別管理加算(I)", "136200", "特別管理加算Ⅰ"),
    ("tokubetsu_kanri_kasan_II", "特別管理加算(II)", "136201", "特別管理加算Ⅱ"),
    ("terminal_care_kasan", "ターミナルケア加算", "136300", "ターミナルケア加算"),
    ("kango_taisei_kyouka_kasan_I", "看護体制強化加算(I)", "136400", "看護体制強化加算Ⅰ"),
    ("kango_taisei_kyouka_kasan_II", "看護体制強化加算(II)", "136401", "看護体制強化加算Ⅱ"),
    ("service_taisei_kyouka_kasan_I", "サービス提供体制強化加算(I)", "136500", "サービス提供体制強化加算Ⅰ"),
    ("service_taisei_kyouka_kasan_II", "サービス提供体制強化加算(II)", "136501", "サービス提供体制強化加算Ⅱ"),
    ("taiin_kyoudou_shidou_kasan", "退院時共同指導加算", "136600", "退院時共同指導加算"),
    ("kango_kaigo_renkei_kyouka_kasan", "看護・介護職員連携強化加算", "136700", "看護・介護職員連携強化加算"),
    ("koukuu_renkei_kyouka_kasan", "口腔連携強化加算", "136800", "口腔連携強化加算"),
    ("kagakuteki_kaigo_suishin_kasan", "科学的介護推進体制加算", "136900", "科学的介護推進体制加算"),
    ("shokai_kasan_I", "初回加算(I)", "131000", "初回加算Ⅰ"),
    ("shokai_kasan_II", "初回加算(II)", "131001", "初回加算Ⅱ"),
    ("shougu_kaizen_kasan_2026_06", "介護職員等処遇改善加算", None, "処遇改善加算"),
    # 以下はマスタ側で source_required の3加算。文字列検出時のみcountするが、要件・単位は推測しない
    ("fukusu_mei_houmon_kango_kasan", "複数名訪問看護加算（介護保険版・要根拠確認）", None, "複数名訪問看護加算"),
    ("chouji_kan_houmon_kango_kasan", "長時間訪問看護加算（介護保険版・要根拠確認）", None, "長時間訪問看護加算"),
    ("ninchi_senmon_care_kasan", "認知症専門ケア加算（訪問看護版・要根拠確認）", None, "認知症専門ケア加算"),
]

KYOTAKU_SHIEN_KASAN_PATTERNS = [
    ("kyotaku_shien_I", "居宅介護支援費(I)", "431001", "居宅介護支援費Ⅰ"),
    ("kyotaku_shien_II", "居宅介護支援費(II)", "432001", "居宅介護支援費Ⅱ"),
    ("shokai_kasan", "初回加算", "438700", "初回加算"),
    ("nyuin_jouhou_renkei_I", "入院時情報連携加算(I)", "438200", "入院時情報連携加算Ⅰ"),
    ("nyuin_jouhou_renkei_II", "入院時情報連携加算(II)", "438201", "入院時情報連携加算Ⅱ"),
    ("taiin_taisho_kasan_I_i", "退院・退所加算(I)イ", "438301", "退院・退所加算Ⅰイ"),
    ("taiin_taisho_kasan_I_ro", "退院・退所加算(I)ロ", "438302", "退院・退所加算Ⅰロ"),
    ("taiin_taisho_kasan_II_i", "退院・退所加算(II)イ", "438303", "退院・退所加算Ⅱイ"),
    ("taiin_taisho_kasan_II_ro", "退院・退所加算(II)ロ", "438304", "退院・退所加算Ⅱロ"),
    ("taiin_taisho_kasan_III", "退院・退所加算(III)", "438305", "退院・退所加算Ⅲ"),
    ("tsuuin_jouhou_renkei", "通院時情報連携加算", "438400", "通院時情報連携加算"),
    ("kinkyu_kyotaku_conference", "緊急時等居宅カンファレンス加算", "438500", "緊急時等居宅カンファレンス加算"),
    ("terminal_care_management", "ターミナルケアマネジメント加算", "438600", "ターミナルケアマネジメント加算"),
    ("tokutei_jigyousho_I", "特定事業所加算(I)", "438100", "特定事業所加算Ⅰ"),
    ("tokutei_jigyousho_II", "特定事業所加算(II)", "438101", "特定事業所加算Ⅱ"),
    ("tokutei_jigyousho_III", "特定事業所加算(III)", "438102", "特定事業所加算Ⅲ"),
    ("tokutei_jigyousho_IV", "特定事業所加算(IV)", "438103", "特定事業所加算Ⅳ"),
    ("tokutei_jigyousho_A", "特定事業所加算(A)", "438104", "特定事業所加算A"),
    ("tokutei_jigyousho_iryou_kaigo", "特定事業所医療介護連携加算", "438800", "特定事業所医療介護連携加算"),
    ("shougu_kaizen_kasan_2026_06", "処遇改善加算（R8.6新規対象）", None, "処遇改善加算"),
]

SERVICE_PATTERNS = {
    "tsusho_kaigo": {
        "kasan_patterns": TSUSHO_KASAN_PATTERNS,
        "care_level_regex": r"通所介護[ⅠⅡ]([1-9])([1-5])(?!\d)",
    },
    "houmon_kaigo": {
        "kasan_patterns": HOUMON_KASAN_PATTERNS,
        "service_categories": HOUMON_SERVICE_CATEGORIES,
        "time_bands": HOUMON_TIME_BANDS,
        "service_code_prefix": "11",
        "care_level_regex": r"訪問介護[ⅠⅡⅢ]?([1-9])([1-5])?(?!\d)",
    },
    "kyotaku_shien": {
        "kasan_patterns": KYOTAKU_SHIEN_KASAN_PATTERNS,
        "service_code_prefix": "43",
        "care_level_regex": r"居宅介護支援費[ⅠⅡ]([1-9])([1-5])(?!\d)",
    },
    "houmon_kango_kaigo": {
        "kasan_patterns": HOUMON_KANGO_KAIGO_KASAN_PATTERNS,
        "service_code_prefix": "13",
        "care_level_regex": r"訪問看護[ⅠⅡⅢ]?([1-9])([1-5])?(?!\d)",
    },
}


def extract_care_level_tsusho(text_nospace: str) -> str | None:
    m = re.search(SERVICE_PATTERNS["tsusho_kaigo"]["care_level_regex"], text_nospace)
    if m:
        return f"要介護{m.group(2)}"
    return None


def analyze_text(text: str, service_key: str) -> dict:
    """生テキストから現状算定中加算・要介護度・サービス区分を抽出。
    対応service: tsusho_kaigo / houmon_kaigo（alpha.4.2時点）
    その他は warnings を返す。"""
    if service_key not in SERVICE_PATTERNS:
        return {
            "warnings": [f"service_key={service_key}はalpha.4.4ではPDF取込未対応。tsusho_kaigo / houmon_kaigo / kyotaku_shien / houmon_kango_kaigoのみ対応。医療保険版（houmon_kango_iryo）は別管理で準備中。"],
            "current_kasan_counts": {},
            "current_kasan_ratios": {},
            "detected_service_codes": [],
            "care_level_distribution": {},
            "yokaigo_3plus_ratio": None,
            "raw_yokaigo_3plus_ratio": None,
            "total_users_estimated": 0,
            "service_category_counts": {},
            "time_band_counts": {},
            "unknown_service_codes": [],
        }

    config = SERVICE_PATTERNS[service_key]
    patterns = config["kasan_patterns"]
    pages = re.split(r"\f|=== ?PAGE ?\d+ ?===", text)
    pages = [p for p in pages if p.strip()]
    if not pages:
        pages = [text]

    care_levels = []
    kasan_counter = Counter()
    detected_codes = set()
    service_category_counter = Counter()
    time_band_counter = Counter()
    unknown_codes = set()
    warnings = []

    care_level_regex = config.get("care_level_regex")
    code_prefix = config.get("service_code_prefix")
    service_categories = config.get("service_categories", [])
    time_bands = config.get("time_bands", [])

    for page_text in pages:
        text_z2h = z2h(page_text)
        text_nospace = re.sub(r"\s", "", text_z2h)

        # 要介護度（通所介護版/訪問介護版の正規表現）
        if care_level_regex:
            m = re.search(care_level_regex, text_z2h)
            if m and m.group(2):
                care_levels.append(f"要介護{m.group(2)}")

        # 加算検出
        for kasan_key, display_name, code, match_name in patterns:
            if match_name in text_nospace:
                kasan_counter[kasan_key] += 1
                if code and code in text_nospace:
                    detected_codes.add(code)

        # サービス区分検出（訪問介護のみ）
        for cat_key, display_name, regex in service_categories:
            if re.search(regex, text_z2h):
                service_category_counter[cat_key] += 1

        # 時間帯加算検出（訪問介護のみ）
        for band_key, display_name, regex in time_bands:
            if re.search(regex, text_z2h):
                time_band_counter[band_key] += 1

        # 未知のサービスコード検出（service_code_prefix指定時のみ）
        if code_prefix:
            for code_match in re.finditer(rf"{code_prefix}\d{{4}}", text_nospace):
                code = code_match.group(0)
                if code not in detected_codes:
                    # 既知パターンに含まれているか
                    known = any(p[2] == code for p in patterns if p[2])
                    if not known:
                        unknown_codes.add(code)

    total = len(pages)
    care_level_dist = Counter(care_levels)
    yokaigo_3plus = sum(v for k, v in care_level_dist.items() if k in ("要介護3", "要介護4", "要介護5"))
    yokaigo_3plus_ratio = round(yokaigo_3plus / total, 4) if total else None

    if total == 0:
        warnings.append("pages=0: 抽出対象テキストが空")
    if not care_levels and total > 0:
        warnings.append("care_level: 要介護度を1件も抽出できず（PDFフォーマット要確認）")
    if not kasan_counter and total > 0:
        warnings.append("kasan: 算定中加算を1件も抽出できず（PDFフォーマット要確認）")
    if unknown_codes:
        warnings.append(f"unknown_service_code: 既知パターン外のサービスコードを検出 {sorted(unknown_codes)}")

    # 居宅介護支援は40%要件が地域包括紹介除外などPDFのみで確定できないため、
    # 単純な要介護3以上割合は raw_yokaigo_3plus_ratio として保存し、
    # yokaigo_3plus_ratio（要件判定用）はNoneにする
    is_kyotaku_shien = service_key == "kyotaku_shien"
    if is_kyotaku_shien:
        warnings.append("kyotaku_shien: 特定事業所加算(I)の40%要件は地域包括紹介除外などPDFのみで確定できない。raw_yokaigo_3plus_ratioは参考値。")

    return {
        "warnings": warnings,
        "current_kasan_counts": dict(kasan_counter),
        "current_kasan_ratios": {k: round(v / total, 4) for k, v in kasan_counter.items()} if total else {},
        "detected_service_codes": sorted(detected_codes),
        "care_level_distribution": dict(care_level_dist),
        "yokaigo_3plus_ratio": None if is_kyotaku_shien else yokaigo_3plus_ratio,
        "raw_yokaigo_3plus_ratio": yokaigo_3plus_ratio,
        "total_users_estimated": total,
        "service_category_counts": dict(service_category_counter),
        "time_band_counts": dict(time_band_counter),
        "unknown_service_codes": sorted(unknown_codes),
    }


def calculate_confidence(extracted: dict) -> str:
    """抽出結果の信頼度を high/medium/low で返す。"""
    total = extracted.get("total_users_estimated", 0)
    if total == 0:
        return "none"
    cl_dist = extracted.get("care_level_distribution") or {}
    kasan_count = len(extracted.get("current_kasan_counts") or {})
    cl_coverage = sum(cl_dist.values()) / total if total else 0
    if cl_coverage >= 0.8 and kasan_count >= 3:
        return "high"
    if cl_coverage >= 0.5:
        return "medium"
    return "low"


def build_evidence(office: str, service: str, tenant: str | None,
                    extracted: dict, source_file_name: str) -> dict:
    """evidence JSONを構築。CLIとjudge_kasan.pyの両方から呼び出される。"""
    now = datetime.now()
    timestamp = now.strftime("%Y%m%d%H%M%S")
    evidence_id = f"receipt_pdf_{office}_{timestamp}"
    mapping = SERVICE_CODE_MAPPING_STATUS.get(service, {
        "status": "source_required",
        "source": "unknown",
        "note": "サービスコードマッピング未登録",
    })
    return {
        "_meta": {
            "schema": "evidence",
            "schema_version": "1.2",
            "office_code": office,
            "tenant_id": tenant or "unknown",
            "updated": now.isoformat(timespec="seconds"),
        },
        "evidence": [{
            "evidence_id": evidence_id,
            "tenant_id": tenant or "unknown",
            "office_code": office,
            "service_key": service,
            "source_type": "receipt_pdf",
            "source_file_name": source_file_name,
            "extracted_at": now.isoformat(timespec="seconds"),
            "extraction_version": EXTRACTION_VERSION,
            "detected_claim_status": "detected_in_receipt_pdf",
            "detection_scope": "aggregated_claim_items_only",
            "not_detected_policy": "PDF未検出は未算定を意味しない。サービスコード未収載・帳票形式違い・OCR不可等の要因がある。",
            "requirement_policy": "PDF検出は算定中の推定であり、要件充足確認は別途必要。",
            "pii_policy": {
                "保存しない項目": ["被保険者番号", "氏名", "カナ氏名", "住所", "電話番号", "生年月日"],
                "保存する項目": ["要介護度分布(集計値)", "算定中加算の件数(集計値)", "サービスコード"],
                "policy_note": "個人を特定できる情報は意図的に抽出・保存しない設計。集計値・統計値のみを残す。",
            },
            "total_pages": extracted.get("total_users_estimated", 0),
            "total_users_estimated": extracted.get("total_users_estimated", 0),
            "care_level_distribution": extracted.get("care_level_distribution", {}),
            "yokaigo_3plus_ratio": extracted.get("yokaigo_3plus_ratio"),
            "current_kasan_counts": extracted.get("current_kasan_counts", {}),
            "current_kasan_ratios": extracted.get("current_kasan_ratios", {}),
            "detected_service_codes": extracted.get("detected_service_codes", []),
            "service_category_counts": extracted.get("service_category_counts", {}),
            "time_band_counts": extracted.get("time_band_counts", {}),
            "unknown_service_codes": extracted.get("unknown_service_codes", []),
            "raw_yokaigo_3plus_ratio": extracted.get("raw_yokaigo_3plus_ratio"),
            "warnings": extracted.get("warnings", []),
            "extraction_confidence": calculate_confidence(extracted),
            "service_code_mapping_status": mapping["status"],
            "service_code_mapping_source": mapping["source"],
            "service_code_mapping_source_url": mapping.get("source_url"),
            "service_code_mapping_source_checked_date": mapping.get("source_checked_date"),
            "pattern_confidence_note": mapping["note"],
            # alpha.5.5: per-kasan mapping_status をマスタから取り込む
            "per_kasan_mapping_status": load_per_kasan_mapping_status(service),
            "per_kasan_mapping_status_summary": summarize_mapping_status_breakdown(
                load_per_kasan_mapping_status(service)
            ),
        }]
    }


def load_source_registry() -> dict:
    """alpha.5.7: regulatory_master/sources/kaigo_service_code_sources.json を読み込む。"""
    import json
    from pathlib import Path
    path = Path(__file__).resolve().parent.parent / "regulatory_master" / "sources" / "kaigo_service_code_sources.json"
    if not path.exists():
        return {"sources": {}, "service_to_authoritative_source": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def get_authoritative_source(service_key: str) -> dict | None:
    """指定サービスの authoritative source（current_definitive 優先）を返す。"""
    registry = load_source_registry()
    service_map = registry.get("service_to_authoritative_source", {}).get(service_key, [])
    if not service_map:
        return None
    sources = registry.get("sources", {})
    # current_definitive を優先
    for entry in service_map:
        sid = entry.get("source_id")
        if sid in sources and sources[sid].get("revision_status") == "current_definitive":
            return sources[sid]
    # それ以外（historical_definitive 等）
    for entry in service_map:
        sid = entry.get("source_id")
        if sid in sources:
            return sources[sid]
    return None


def resolve_current_source_for_date(service_key: str, target_date: str) -> dict | None:
    """alpha.5.7.2 / alpha.5.8.1: 対象年月（YYYY-MM-DD 形式）から current source を返す。

    判定ルール:
    - source の effective_from <= target_date <= effective_to かつ source_kind=definitive のものを優先
    - 該当が複数ある場合は revision_status=current_definitive が最優先
    - target_date が provisional_future の effective_from 以降の場合は None を返す
      （案資料を current として扱わない）
    - alpha.5.8.1: source.checked_promotion_allowed=false の場合も current として返さない（二重防御）
    """
    registry = load_source_registry()
    sources = registry.get("sources", {})
    service_map = registry.get("service_to_authoritative_source", {}).get(service_key, [])
    if not service_map:
        return None

    candidates = []
    for entry in service_map:
        sid = entry.get("source_id")
        s = sources.get(sid)
        if not s: continue
        if s.get("source_kind") != "definitive": continue
        # alpha.5.8.1: checked_promotion_allowed=False は明示除外
        if s.get("checked_promotion_allowed") is False: continue
        eff_from = s.get("effective_from") or ""
        eff_to = s.get("effective_to") or "9999-12-31"
        if eff_from <= target_date <= eff_to:
            candidates.append((s, sid))
    if not candidates:
        return None
    # current_definitive を最優先
    for s, sid in candidates:
        if s.get("revision_status") == "current_definitive":
            return s
    # それ以外は最初の definitive を返す
    return candidates[0][0]


def get_definitive_sources_for_period(service_key: str, start_date: str, end_date: str) -> list:
    """指定期間に effective な definitive sources を全て返す（連続的に R7.4 → R7.8 のように切り替わる場合に使用）。
    alpha.5.8.1: checked_promotion_allowed=false の source は除外。"""
    registry = load_source_registry()
    sources = registry.get("sources", {})
    service_map = registry.get("service_to_authoritative_source", {}).get(service_key, [])
    out = []
    for entry in service_map:
        sid = entry.get("source_id")
        s = sources.get(sid)
        if not s: continue
        if s.get("source_kind") != "definitive": continue
        # alpha.5.8.1: checked_promotion_allowed=False は明示除外
        if s.get("checked_promotion_allowed") is False: continue
        eff_from = s.get("effective_from") or ""
        eff_to = s.get("effective_to") or "9999-12-31"
        # 期間が重なる
        if eff_from <= end_date and start_date <= eff_to:
            out.append(s)
    return out


def load_per_kasan_mapping_status(service_key: str) -> dict:
    """alpha.5.5: regulatory_master の各加算から service_code_mapping_status を抽出。
    返り値: {kasan_key: {"status": ..., "audit": ...}}"""
    import json
    from pathlib import Path
    # service_key → master file path
    candidates = [
        Path(__file__).resolve().parent.parent / "regulatory_master" / "kaigo" / f"{service_key}.json",
        Path(__file__).resolve().parent.parent / "regulatory_master" / "medical" / f"{service_key}.json",
        Path(__file__).resolve().parent.parent / "regulatory_master" / "disability" / f"{service_key}.json",
    ]
    out: dict = {}
    for path in candidates:
        if not path.exists():
            continue
        try:
            d = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for kasan_key, kasan_def in (d.get("kasans") or {}).items():
            status = kasan_def.get("service_code_mapping_status", "pattern_based_unverified")
            audit = kasan_def.get("service_code_audit", {})
            out[kasan_key] = {
                "status": status,
                "audit": audit,
            }
        break
    return out


def summarize_mapping_status_breakdown(per_kasan_mapping: dict) -> dict:
    """各加算 mapping_status のカウント集計。"""
    summary = {"checked": 0, "pattern_based_unverified": 0, "not_applicable": 0,
               "source_required": 0, "unknown": 0}
    for k, v in per_kasan_mapping.items():
        st = v.get("status", "pattern_based_unverified")
        if st in summary:
            summary[st] += 1
        else:
            summary["unknown"] += 1
    return summary


def extract_from_pdf(pdf_path: str) -> str:
    """pdfplumberでPDFテキストを抽出。1ページごとに === PAGE N === で連結。"""
    try:
        import pdfplumber
    except ImportError:
        raise RuntimeError("pdfplumber未インストール。pip install pdfplumber")

    out = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages, 1):
            t = page.extract_text() or ""
            out.append(f"=== PAGE {i} ===\n{t}")
    return "\n".join(out)


def analyze_pdf(pdf_path: str, service_key: str) -> dict:
    """PDFパスから直接 analyze 結果を返す。judge_kasan.pyから呼ぶ。"""
    text = extract_from_pdf(pdf_path)
    return analyze_text(text, service_key)


def save_evidence(evidence: dict, out_path_str: str) -> Path:
    """evidence JSONを指定先に保存。ディレクトリ指定時はタイムスタンプ付きファイル名で生成。"""
    out_path = Path(out_path_str)
    if out_path.suffix == "":
        out_path.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d%H%M%S")
        out_path = out_path / f"receipt_pdf_{ts}.json"
    else:
        out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(evidence, f, ensure_ascii=False, indent=2)
    return out_path


def run_extraction(office: str, service: str, tenant: str | None = None,
                    pdf_path: str | None = None, sample_text_path: str | None = None,
                    evidence_out: str | None = None) -> tuple[dict, Path | None]:
    """PDFまたはサンプルテキストから抽出 → evidence構築 → 保存。
    judge_kasan.pyの--receipt-pdfから呼び出されるエントリポイント。
    戻り値: (evidence dict, 保存先Path or None)"""
    if pdf_path:
        source_name = Path(pdf_path).name
        text = extract_from_pdf(pdf_path)
    elif sample_text_path:
        source_name = Path(sample_text_path).name + " (sample-text fallback)"
        with open(sample_text_path, "r", encoding="utf-8") as f:
            text = f.read()
    else:
        raise ValueError("pdf_pathまたはsample_text_pathが必須")

    extracted = analyze_text(text, service)
    evidence = build_evidence(office, service, tenant, extracted, source_name)

    saved_path = None
    if evidence_out:
        saved_path = save_evidence(evidence, evidence_out)
    return evidence, saved_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--service", required=True, help="サービスキー（alpha.4.2はtsusho_kaigo / houmon_kaigoに対応）")
    parser.add_argument("--office", required=True, help="事業所コード")
    parser.add_argument("--tenant", help="テナントID（省略時はunknown）")
    parser.add_argument("--pdf", help="介護給付費明細書PDFのパス")
    parser.add_argument("--sample-text", help="PDFの代わりにテキストファイルを使う（テスト用）")
    parser.add_argument("--evidence-out", required=True, help="evidence JSON出力先（ファイル名 or ディレクトリ）")
    args = parser.parse_args()

    if not args.pdf and not args.sample_text:
        print("ERROR: --pdf または --sample-text のいずれか必須", file=sys.stderr)
        sys.exit(1)

    evidence, out_path = run_extraction(
        office=args.office, service=args.service, tenant=args.tenant,
        pdf_path=args.pdf, sample_text_path=args.sample_text,
        evidence_out=args.evidence_out,
    )

    print(f"evidence書き出し: {out_path}")
    e = evidence["evidence"][0]
    print(f"  service_key: {e['service_key']}")
    print(f"  office_code: {e['office_code']}")
    print(f"  total_users_estimated: {e['total_users_estimated']}")
    print(f"  yokaigo_3plus_ratio: {e['yokaigo_3plus_ratio']}")
    print(f"  current_kasan_counts: {len(e['current_kasan_counts'])}件検出")
    print(f"  extraction_confidence: {e['extraction_confidence']}")
    if e["warnings"]:
        print(f"  warnings:")
        for w in e["warnings"]:
            print(f"    - {w}")


if __name__ == "__main__":
    main()
