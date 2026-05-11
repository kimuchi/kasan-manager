"""judge_kasan.py への DSL 連携テスト（alpha.5）"""
import io
import json
import subprocess
import sys
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2].parent  # worktree root
PRODUCT_ROOT = ROOT / "products" / "kasan-manager"


def run_judge(*args, capture_md=None):
    """judge_kasan.pyを実行してreturncodeとレポート内容を返す"""
    cmd = [sys.executable, str(PRODUCT_ROOT / "scripts" / "judge_kasan.py"), *args]
    if capture_md:
        cmd += ["--report-md", str(capture_md)]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    md = capture_md.read_text(encoding="utf-8") if capture_md and capture_md.exists() else ""
    return result.returncode, result.stdout + result.stderr, md


def test_existing_pdf_summary_intact():
    """既存PDF検出サマリが壊れていないこと"""
    out_md = ROOT / "products/kasan-manager/out/_test_dsl_houmon_kango.md"
    rc, log, md = run_judge(
        "--domain", "kaigo", "--service", "houmon_kango_kaigo", "--office", "DEMO-0007",
        "--receipt-pdf", str(PRODUCT_ROOT / "tests/fixtures/houmon_kango_kaigo_receipt_sample.pdf"),
        "--evidence-out", str(PRODUCT_ROOT / "tenant_data/evidence/DEMO-0007/"),
        "--apply-evidence",
        capture_md=out_md,
    )
    assert rc == 0, f"judge失敗: {log}"
    assert "📄 PDF取込結果サマリ" in md
    assert "📄 PDFで算定中として検出された加算" in md
    print("✅ test_existing_pdf_summary_intact")


def test_dsl_section_appears():
    """要件ロジック評価セクションが出る"""
    out_md = ROOT / "products/kasan-manager/out/_test_dsl_section.md"
    rc, log, md = run_judge(
        "--domain", "kaigo", "--service", "houmon_kango_kaigo", "--office", "DEMO-0007",
        "--receipt-pdf", str(PRODUCT_ROOT / "tests/fixtures/houmon_kango_kaigo_receipt_sample.pdf"),
        "--evidence-out", str(PRODUCT_ROOT / "tenant_data/evidence/DEMO-0007/"),
        "--apply-evidence",
        capture_md=out_md,
    )
    assert rc == 0, f"judge失敗: {log}"
    assert "🧠 要件ロジック評価" in md, "DSLセクションが出ない"
    print("✅ test_dsl_section_appears")


def test_not_applicable_not_in_opportunity():
    """対象外加算が改善候補・収益機会に混ざらない"""
    out_md = ROOT / "products/kasan-manager/out/_test_dsl_not_applicable.md"
    rc, log, md = run_judge(
        "--domain", "kaigo", "--service", "houmon_kango_kaigo", "--office", "DEMO-0007",
        "--receipt-pdf", str(PRODUCT_ROOT / "tests/fixtures/houmon_kango_kaigo_receipt_sample.pdf"),
        "--evidence-out", str(PRODUCT_ROOT / "tenant_data/evidence/DEMO-0007/"),
        "--apply-evidence",
        capture_md=out_md,
    )
    assert rc == 0, f"judge失敗: {log}"
    # 「PDFから未検出だが取得候補の加算」リストに認知症専門ケア加算（対象外）が含まれない
    sections = md.split("## 📄❔ PDFから未検出だが取得候補の加算")
    if len(sections) > 1:
        body = sections[1].split("---")[0]
        assert "認知症専門ケア加算" not in body, "対象外加算が改善候補に混ざっている"
    # not_applicable行が結論サマリに出る
    assert "🚫" in md or "当サービスでは算定対象外" in md, "not_applicableが表示されない"
    print("✅ test_not_applicable_not_in_opportunity")


def test_no_forbidden_terms_in_public_md():
    """publicファイルに禁止語が出ない"""
    forbidden = ["SUN", "ホットステーション", "1367197775", "1371802743", "1371802982",
                 "専務", "事務長", "サ責A", "サ責B", "サ責C", "サ責D", "506万円",
                 "skills/regulatory", "社内資料", "DEMO fixture",
                 "算定可否を保証", "必ず算定", "未検出なので未算定"]
    public_files = [
        ROOT / "products/kasan-manager/out/public_release_note.md",
        ROOT / "products/kasan-manager/README_PUBLIC.md",
    ] + list((ROOT / "products/kasan-manager/out").glob("sample_*_public.md"))
    hits = []
    for pf in public_files:
        if not pf.exists():
            continue
        text = pf.read_text(encoding="utf-8")
        for kw in forbidden:
            if kw in text:
                # 「保証するものではありません」のような否定文は除外
                if kw == "算定可否を保証" and "保証するものではありません" in text:
                    continue
                hits.append((pf.name, kw))
    assert not hits, f"public禁止語HIT: {hits}"
    print("✅ test_no_forbidden_terms_in_public_md")


if __name__ == "__main__":
    test_existing_pdf_summary_intact()
    test_dsl_section_appears()
    test_not_applicable_not_in_opportunity()
    test_no_forbidden_terms_in_public_md()
    print("\nAll judge-DSL tests passed.")
