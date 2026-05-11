"""簡易テスト: import_receipt_pdf.py の analyze_text 動作確認

使い方:
    python products/kasan-manager/tests/test_import_receipt_pdf.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from import_receipt_pdf import analyze_text, calculate_confidence, analyze_pdf, build_evidence


def test_tsusho_extraction():
    fixture = Path(__file__).parent / "fixtures" / "tsusho_receipt_sample_text.txt"
    text = fixture.read_text(encoding="utf-8")
    result = analyze_text(text, "tsusho_kaigo")

    assert result["total_users_estimated"] == 5, f"5名期待: {result['total_users_estimated']}"
    cl = result["care_level_distribution"]
    assert cl.get("要介護2") == 1, f"要介護2=1名期待: {cl.get('要介護2')}"
    assert cl.get("要介護5") == 1, f"要介護5=1名期待: {cl.get('要介護5')}"
    assert result["yokaigo_3plus_ratio"] == 0.6, f"60%期待（要介護3,4,5各1名/全5名）: {result['yokaigo_3plus_ratio']}"

    counts = result["current_kasan_counts"]
    assert counts.get("kobetsu_kinou_I_i") == 5, f"個別機能Ⅰイ=5: {counts.get('kobetsu_kinou_I_i')}"
    assert counts.get("nyuyoku_I") == 5, f"入浴Ⅰ=5: {counts.get('nyuyoku_I')}"
    assert counts.get("koukuu_kinou_I") == 1, f"口腔Ⅰ=1: {counts.get('koukuu_kinou_I')}"
    assert counts.get("chujudosha_care_taisei") == 1, f"中重度=1: {counts.get('chujudosha_care_taisei')}"

    conf = calculate_confidence(result)
    assert conf == "high", f"high期待: {conf}"

    print("✅ test_tsusho_extraction PASS")
    print(f"   推定利用者数: {result['total_users_estimated']}")
    print(f"   要介護度分布: {cl}")
    print(f"   要介護3以上割合: {result['yokaigo_3plus_ratio']*100:.1f}%")
    print(f"   検出加算数: {len(counts)}")
    print(f"   信頼度: {conf}")


def test_unsupported_service():
    """alpha.4.4では tsusho_kaigo / houmon_kaigo / kyotaku_shien / houmon_kango_kaigo 以外は警告"""
    result = analyze_text("dummy", "houmon_kango_iryo")
    assert result["warnings"], "未対応サービスは警告必須"
    assert "houmon_kango_iryo" not in result["warnings"][0] or "別管理" in result["warnings"][0]
    print("✅ test_unsupported_service PASS")


def test_houmon_kango_kaigo_extraction():
    """訪問看護(介護保険)fixtureから加算が抽出できる + 医療保険版と混ざらない"""
    fixture = Path(__file__).parent / "fixtures" / "houmon_kango_kaigo_receipt_sample_text.txt"
    text = fixture.read_text(encoding="utf-8")
    result = analyze_text(text, "houmon_kango_kaigo")

    assert result["total_users_estimated"] == 7, f"7名期待: {result['total_users_estimated']}"
    counts = result["current_kasan_counts"]
    assert counts.get("kinkyu_houmon_kango_kasan_II") == 7, f"緊急時Ⅱ=7: {counts.get('kinkyu_houmon_kango_kasan_II')}"
    assert counts.get("shougu_kaizen_kasan_2026_06") == 7
    assert counts.get("tokubetsu_kanri_kasan_I") == 1
    assert counts.get("tokubetsu_kanri_kasan_II") == 2
    assert counts.get("terminal_care_kasan") == 1
    assert counts.get("kango_taisei_kyouka_kasan_II") == 1
    assert counts.get("service_taisei_kyouka_kasan_II") == 1
    assert counts.get("taiin_kyoudou_shidou_kasan") == 1
    assert counts.get("kango_kaigo_renkei_kyouka_kasan") == 1
    assert counts.get("koukuu_renkei_kyouka_kasan") == 1
    assert counts.get("kagakuteki_kaigo_suishin_kasan") == 1
    assert counts.get("shokai_kasan_I") == 1
    assert counts.get("shokai_kasan_II") == 1

    assert result["detected_service_codes"], "サービスコード検出"
    assert calculate_confidence(result) in ("high", "medium")

    print("✅ test_houmon_kango_kaigo_extraction PASS")
    print(f"   推定利用者数: {result['total_users_estimated']}")
    print(f"   検出加算: {len(counts)}件 (緊急時Ⅱ={counts.get('kinkyu_houmon_kango_kasan_II')}, 特別管理Ⅱ={counts.get('tokubetsu_kanri_kasan_II')}, 退院時共同={counts.get('taiin_kyoudou_shidou_kasan')})")
    print(f"   信頼度: {calculate_confidence(result)}")


def test_houmon_kango_kaigo_synthetic_pdf():
    """訪問看護(介護保険)合成PDFがpdfplumberで抽出できる"""
    pdf_path = Path(__file__).parent / "fixtures" / "houmon_kango_kaigo_receipt_sample.pdf"
    if not pdf_path.exists():
        print("⚠️  test_houmon_kango_kaigo_synthetic_pdf SKIP（合成PDF未生成）")
        return
    result = analyze_pdf(str(pdf_path), "houmon_kango_kaigo")
    assert result["total_users_estimated"] == 7
    assert result["current_kasan_counts"].get("kinkyu_houmon_kango_kasan_II") == 7

    ev = build_evidence("DEMO-0007", "houmon_kango_kaigo", "test", result, pdf_path.name)
    e = ev["evidence"][0]
    # alpha.5.5: houmon_kango_kaigo は partial_checked へ昇格（8加算で公式コード照合済）
    assert e["service_code_mapping_status"] == "partial_checked"
    assert "訪問看護" in e["pattern_confidence_note"] or "WAM NET" in e.get("service_code_mapping_source", "")
    # alpha.5.6: per_kasan_mapping_status_summary を確認 (14 checked)
    summary = e.get("per_kasan_mapping_status_summary") or {}
    assert summary.get("checked", 0) >= 14, f"checked数が想定以下（alpha.5.6で14件想定）: {summary}"
    assert summary.get("not_applicable", 0) >= 1, f"not_applicable数が想定以下: {summary}"

    print("✅ test_houmon_kango_kaigo_synthetic_pdf PASS")
    print(f"   PDF経由でも7名・緊急時Ⅱ7件確認")
    print(f"   per_kasan_mapping_status: checked={summary.get('checked')} / pattern={summary.get('pattern_based_unverified')} / not_applicable={summary.get('not_applicable')}")


def test_houmon_kango_iryo_separation():
    """医療保険版 houmon_kango_iryo は SERVICE_PATTERNS に含まれない（別管理）"""
    result = analyze_text("dummy", "houmon_kango_iryo")
    assert result["warnings"], "医療保険版は警告必須"
    assert "houmon_kango_kaigo" in result["warnings"][0]
    assert result["current_kasan_counts"] == {}, "医療保険版は加算検出しない"
    print("✅ test_houmon_kango_iryo_separation PASS")


def test_kyotaku_shien_extraction():
    """居宅介護支援fixtureから加算が抽出できる + 40%要件はPDFのみでclearにしない"""
    fixture = Path(__file__).parent / "fixtures" / "kyotaku_shien_receipt_sample_text.txt"
    text = fixture.read_text(encoding="utf-8")
    result = analyze_text(text, "kyotaku_shien")

    assert result["total_users_estimated"] == 7, f"7名期待: {result['total_users_estimated']}"
    counts = result["current_kasan_counts"]
    assert counts.get("tokutei_jigyousho_II") == 7, f"特事Ⅱ=7: {counts.get('tokutei_jigyousho_II')}"
    assert counts.get("shokai_kasan") == 1
    assert counts.get("nyuin_jouhou_renkei_I") == 1
    assert counts.get("nyuin_jouhou_renkei_II") == 1
    assert counts.get("taiin_taisho_kasan_I_ro") == 1
    assert counts.get("taiin_taisho_kasan_II_ro") == 1
    assert counts.get("tsuuin_jouhou_renkei") == 1
    assert counts.get("terminal_care_management") == 1

    # 40%要件はPDFのみでclearにしない設計確認
    assert result["yokaigo_3plus_ratio"] is None, f"yokaigo_3plus_ratioはNone（40%要件PDFのみclearしない）"
    assert result["raw_yokaigo_3plus_ratio"] is not None, f"raw_yokaigo_3plus_ratioは保存"

    # PDFのみclearしない警告が出ている
    assert any("40%要件" in w for w in result["warnings"]), "40%要件警告必須"

    assert result["detected_service_codes"], "サービスコード検出"
    assert calculate_confidence(result) in ("high", "medium")

    print("✅ test_kyotaku_shien_extraction PASS")
    print(f"   推定利用者数: {result['total_users_estimated']}")
    print(f"   検出加算: {len(counts)}件")
    print(f"   raw_yokaigo_3plus_ratio: {result['raw_yokaigo_3plus_ratio']}")
    print(f"   yokaigo_3plus_ratio (40%要件用): {result['yokaigo_3plus_ratio']} ← PDFのみではclearしない")


def test_kyotaku_shien_synthetic_pdf():
    """居宅介護支援合成PDFがpdfplumberで抽出できる + evidence追加フィールド検証"""
    pdf_path = Path(__file__).parent / "fixtures" / "kyotaku_shien_receipt_sample.pdf"
    if not pdf_path.exists():
        print("⚠️  test_kyotaku_shien_synthetic_pdf SKIP（合成PDF未生成）")
        return
    result = analyze_pdf(str(pdf_path), "kyotaku_shien")
    assert result["total_users_estimated"] == 7
    assert result["yokaigo_3plus_ratio"] is None
    assert result["raw_yokaigo_3plus_ratio"] is not None

    ev = build_evidence("DEMO-0006", "kyotaku_shien", "test", result, pdf_path.name)
    e = ev["evidence"][0]
    for f in ("service_code_mapping_status", "service_code_mapping_source", "pattern_confidence_note", "raw_yokaigo_3plus_ratio"):
        assert f in e, f"alpha.4.3新フィールド欠損: {f}"
    assert e["service_code_mapping_status"] == "pattern_based_unverified"

    print("✅ test_kyotaku_shien_synthetic_pdf PASS")
    print(f"   PDF経由でも7名・特事Ⅱ7件・raw_yokaigo_3plus_ratio={result['raw_yokaigo_3plus_ratio']}")


def test_synthetic_pdf_extraction():
    """合成PDFがpdfplumberで読み取れ、sample_textと同等の結果になることを確認"""
    pdf_path = Path(__file__).parent / "fixtures" / "tsusho_receipt_sample.pdf"
    if not pdf_path.exists():
        print("⚠️  test_synthetic_pdf_extraction SKIP（合成PDF未生成。generate_sample_pdf.pyを先に実行）")
        return

    result = analyze_pdf(str(pdf_path), "tsusho_kaigo")
    assert result["total_users_estimated"] == 5, f"5名期待: {result['total_users_estimated']}"
    assert result["yokaigo_3plus_ratio"] == 0.6, f"60%期待: {result['yokaigo_3plus_ratio']}"
    counts = result["current_kasan_counts"]
    assert counts.get("kobetsu_kinou_I_i") == 5
    assert counts.get("nyuyoku_I") == 5

    print("✅ test_synthetic_pdf_extraction PASS")
    print(f"   合成PDF: {pdf_path.name}")
    print(f"   推定利用者数: {result['total_users_estimated']}")
    print(f"   要介護3以上割合: {result['yokaigo_3plus_ratio']*100:.1f}%")
    print(f"   検出加算数: {len(counts)}")


def test_evidence_has_pdf_policy_fields():
    """build_evidenceがalpha.4.1の追加フィールドを含むこと"""
    extracted = analyze_text("=== PAGE 1 ===\n通所介護Ⅰ52", "tsusho_kaigo")
    ev = build_evidence("DEMO-0099", "tsusho_kaigo", "test", extracted, "test.pdf")
    e = ev["evidence"][0]
    for f in ("detected_claim_status", "detection_scope", "not_detected_policy", "requirement_policy"):
        assert f in e, f"alpha.4.1新フィールド欠損: {f}"
    assert e["detected_claim_status"] == "detected_in_receipt_pdf"
    assert e["detection_scope"] == "aggregated_claim_items_only"
    print("✅ test_evidence_has_pdf_policy_fields PASS")


def test_houmon_kaigo_extraction():
    """訪問介護fixtureから加算・サービス区分・時間帯が抽出できる"""
    fixture = Path(__file__).parent / "fixtures" / "houmon_kaigo_receipt_sample_text.txt"
    text = fixture.read_text(encoding="utf-8")
    result = analyze_text(text, "houmon_kaigo")

    assert result["total_users_estimated"] == 6, f"6名期待: {result['total_users_estimated']}"
    counts = result["current_kasan_counts"]
    assert counts.get("tokutei_jigyousho_II") == 6, f"特事Ⅱ=6: {counts.get('tokutei_jigyousho_II')}"
    assert counts.get("shougu_kaizen_kasan") == 6, f"処遇改善=6: {counts.get('shougu_kaizen_kasan')}"
    assert counts.get("shokai_kasan") == 1, f"初回=1: {counts.get('shokai_kasan')}"
    assert counts.get("kinkyu_houmon") == 1, f"緊急時=1: {counts.get('kinkyu_houmon')}"
    assert counts.get("seikatsu_kinou_renkei_I") == 1, f"生活機能Ⅰ=1: {counts.get('seikatsu_kinou_renkei_I')}"

    cats = result["service_category_counts"]
    assert cats.get("shintai_kaigo", 0) >= 4, f"身体介護>=4: {cats.get('shintai_kaigo')}"
    assert cats.get("seikatsu_enjyo", 0) >= 1, f"生活援助>=1: {cats.get('seikatsu_enjyo')}"

    bands = result["time_band_counts"]
    assert bands.get("yakan") == 1, f"夜間=1: {bands.get('yakan')}"
    assert bands.get("shinya") == 1, f"深夜=1: {bands.get('shinya')}"
    assert bands.get("soucho") == 1, f"早朝=1: {bands.get('soucho')}"

    assert result["detected_service_codes"], "サービスコード検出"
    assert calculate_confidence(result) in ("high", "medium"), "信頼度high or medium"

    print("✅ test_houmon_kaigo_extraction PASS")
    print(f"   推定利用者数: {result['total_users_estimated']}")
    print(f"   検出加算: {len(counts)}件 (特事Ⅱ={counts.get('tokutei_jigyousho_II')}, 初回={counts.get('shokai_kasan')}, 緊急時={counts.get('kinkyu_houmon')})")
    print(f"   サービス区分: {cats}")
    print(f"   時間帯: {bands}")
    print(f"   信頼度: {calculate_confidence(result)}")


def test_houmon_kaigo_synthetic_pdf():
    """訪問介護合成PDFがpdfplumberで抽出できる"""
    pdf_path = Path(__file__).parent / "fixtures" / "houmon_kaigo_receipt_sample.pdf"
    if not pdf_path.exists():
        print("⚠️  test_houmon_kaigo_synthetic_pdf SKIP（合成PDF未生成）")
        return
    result = analyze_pdf(str(pdf_path), "houmon_kaigo")
    assert result["total_users_estimated"] == 6
    counts = result["current_kasan_counts"]
    assert counts.get("tokutei_jigyousho_II") == 6
    assert counts.get("shokai_kasan") == 1

    ev = build_evidence("DEMO-0005", "houmon_kaigo", "test", result, pdf_path.name)
    e = ev["evidence"][0]
    assert "pii_policy" in e
    assert "not_detected_policy" in e
    assert "requirement_policy" in e
    assert "service_category_counts" in e
    assert "time_band_counts" in e

    print("✅ test_houmon_kaigo_synthetic_pdf PASS")
    print(f"   PDF経由でも6名・特事Ⅱ6件・初回1件を確認")


if __name__ == "__main__":
    test_tsusho_extraction()
    test_unsupported_service()
    test_synthetic_pdf_extraction()
    test_evidence_has_pdf_policy_fields()
    test_houmon_kaigo_extraction()
    test_houmon_kaigo_synthetic_pdf()
    test_kyotaku_shien_extraction()
    test_kyotaku_shien_synthetic_pdf()
    test_houmon_kango_kaigo_extraction()
    test_houmon_kango_kaigo_synthetic_pdf()
    test_houmon_kango_iryo_separation()
    print()
    print("All tests passed.")
