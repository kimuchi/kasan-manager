"""合成PDFを生成するスクリプト（テスト用・個人情報なし）

reportlabで tsusho_receipt_sample_text.txt と同等の内容のPDFを生成。
pdfplumberでテキスト抽出可能なベクタPDFになる。

使い方:
    python products/kasan-manager/tests/generate_sample_pdf.py
"""
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
FIXTURES_DIR = ROOT / "tests" / "fixtures"

GENERATE_TARGETS = [
    ("tsusho_receipt_sample.pdf", "tsusho_receipt_sample_text.txt"),
    ("houmon_kaigo_receipt_sample.pdf", "houmon_kaigo_receipt_sample_text.txt"),
    ("kyotaku_shien_receipt_sample.pdf", "kyotaku_shien_receipt_sample_text.txt"),
    ("houmon_kango_kaigo_receipt_sample.pdf", "houmon_kango_kaigo_receipt_sample_text.txt"),
]


def generate_pdf(pdf_name: str, text_name: str):
    pdf_path = FIXTURES_DIR / pdf_name
    text_path = FIXTURES_DIR / text_name
    if not text_path.exists():
        print(f"  SKIP: {text_name} 未存在")
        return

    c = canvas.Canvas(str(pdf_path), pagesize=A4)
    text = text_path.read_text(encoding="utf-8")
    pages = [p.strip() for p in text.split("=== PAGE ") if p.strip()]

    for i, page in enumerate(pages, 1):
        body = page.split("===", 1)[-1].strip()
        c.setFont("HeiseiKakuGo-W5", 14)
        c.drawString(50, 800, f"=== PAGE {i} ===")
        c.setFont("HeiseiKakuGo-W5", 11)
        y = 770
        for line in body.split("\n"):
            c.drawString(50, y, line)
            y -= 20
        c.showPage()

    c.save()
    print(f"  OK: {pdf_path.name} ({len(pages)}ページ・個人情報なし)")


def main():
    pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))
    print("=== 合成PDF生成 ===")
    for pdf, txt in GENERATE_TARGETS:
        generate_pdf(pdf, txt)


if __name__ == "__main__":
    main()
