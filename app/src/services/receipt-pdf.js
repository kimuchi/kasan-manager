// CareLinker 加算チェッカー alpha.4.4: 介護給付費明細書PDF → evidence JSON 変換 (Node.js port)
// 元実装: scripts/import_receipt_pdf.py
//
// 純粋な抽出ロジック（analyzeText / buildEvidence / SERVICE_PATTERNS 等）は
// app/public/local/receipt-core.js に切り出し、ブラウザのローカル前処理エンジンと
// 共有している。このファイルは PDF/ファイル I/O を伴う Node 専用関数のみを持つ。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  EXTRACTION_VERSION,
  SERVICE_CODE_MAPPING_STATUS,
  SERVICE_PATTERNS,
  analyzeText,
  calculateConfidence,
  buildEvidence,
} from '../../public/local/receipt-core.js';
import { ocrPdfBuffer } from './ocr.js';
import { scrubText } from '../../public/local/pii.js';

const require = createRequire(import.meta.url);

// 空白以外の文字数（スキャンPDF判定・OCR採否の比較に使う）
function nonSpaceLen(s) {
  return String(s || '').replace(/\s/g, '').length;
}

// 既存 import 互換のため、純ロジックを再エクスポート
export {
  EXTRACTION_VERSION,
  SERVICE_CODE_MAPPING_STATUS,
  SERVICE_PATTERNS,
  analyzeText,
  calculateConfidence,
  buildEvidence,
};

export async function extractFromPdf(pdfPath) {
  const buffer = await readFile(pdfPath);
  return extractFromPdfBuffer(buffer);
}

export async function extractFromPdfBuffer(buffer) {
  const pdfParse = require('pdf-parse/lib/pdf-parse.js');
  // ページ区切りで連結（pdf-parse は \f を含めてくれる）
  const result = await pdfParse(buffer, { pagerender: undefined });
  return result.text || '';
}

export async function analyzePdf(pdfPath, serviceKey) {
  const text = await extractFromPdf(pdfPath);
  return analyzeText(text, serviceKey);
}

export async function saveEvidence(evidence, outPathStr) {
  let outPath = outPathStr;
  if (!path.extname(outPath)) {
    if (!existsSync(outPath)) await mkdir(outPath, { recursive: true });
    const ts = new Date()
      .toISOString()
      .replace(/[-:T.Z]/g, '')
      .slice(0, 14);
    outPath = path.join(outPath, `receipt_pdf_${ts}.json`);
  } else {
    const dir = path.dirname(outPath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  }
  await writeFile(outPath, JSON.stringify(evidence, null, 2), 'utf-8');
  return outPath;
}

export async function runExtraction({
  office,
  service,
  tenant = null,
  pdfPath = null,
  sampleTextPath = null,
  pdfBuffer = null,
  sourceName = null,
  evidenceOut = null,
} = {}) {
  let text;
  let resolvedSource;
  let buffer = null;

  if (pdfPath) {
    resolvedSource = sourceName || path.basename(pdfPath);
    buffer = await readFile(pdfPath);
    text = await extractFromPdfBuffer(buffer);
  } else if (sampleTextPath) {
    resolvedSource = sourceName || `${path.basename(sampleTextPath)} (sample-text fallback)`;
    text = await readFile(sampleTextPath, 'utf-8');
  } else if (pdfBuffer) {
    resolvedSource = sourceName || 'in-memory.pdf';
    buffer = pdfBuffer;
    text = await extractFromPdfBuffer(buffer);
  } else {
    throw new Error('pdfPath / sampleTextPath / pdfBuffer のいずれかが必須');
  }

  // スキャンPDF（pdf-parse でテキストが取れない画像PDF）はサーバOCRでテキスト化する。
  // OCRバイナリ（poppler+tesseract）が無い環境では ocrPdfBuffer が null を返し、デジタルPDFのまま処理。
  let ocrApplied = false;
  if (buffer && nonSpaceLen(text) < 20) {
    const ocrText = await ocrPdfBuffer(buffer).catch(() => null);
    if (ocrText && nonSpaceLen(ocrText) > nonSpaceLen(text)) {
      text = ocrText;
      ocrApplied = true;
    }
  }

  // PII スクラブ（OCR・デジタル共通）。被保険者番号・電話・氏名候補の生年月日等を集計前に伏字化。
  // evidence 自体は集計値（加算件数・要介護度割合など）のみで個人情報を含まないが、二重防御として実施。
  text = scrubText(text);

  const extracted = analyzeText(text, service);
  const evidence = buildEvidence(office, service, tenant, extracted, resolvedSource);
  if (ocrApplied && evidence?.evidence?.[0]) {
    evidence.evidence[0].warnings = [
      ...(evidence.evidence[0].warnings || []),
      'サーバOCR(tesseract)でテキスト抽出したスキャンPDFです。抽出精度は帳票画質に依存します。',
    ];
  }

  let savedPath = null;
  if (evidenceOut) savedPath = await saveEvidence(evidence, evidenceOut);
  return { evidence, savedPath, ocr_applied: ocrApplied };
}
