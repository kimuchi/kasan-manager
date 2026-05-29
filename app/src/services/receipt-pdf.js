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

const require = createRequire(import.meta.url);

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

  if (pdfPath) {
    resolvedSource = sourceName || path.basename(pdfPath);
    text = await extractFromPdf(pdfPath);
  } else if (sampleTextPath) {
    resolvedSource = sourceName || `${path.basename(sampleTextPath)} (sample-text fallback)`;
    text = await readFile(sampleTextPath, 'utf-8');
  } else if (pdfBuffer) {
    resolvedSource = sourceName || 'in-memory.pdf';
    text = await extractFromPdfBuffer(pdfBuffer);
  } else {
    throw new Error('pdfPath / sampleTextPath / pdfBuffer のいずれかが必須');
  }

  const extracted = analyzeText(text, service);
  const evidence = buildEvidence(office, service, tenant, extracted, resolvedSource);

  let savedPath = null;
  if (evidenceOut) savedPath = await saveEvidence(evidence, evidenceOut);
  return { evidence, savedPath };
}
