// ブラウザ内での書類解析の共有コア（ローカルページ / Pro ワークスペース 双方から利用）。
//
// PDF テキスト抽出・Excel/CSV パース・OCR は CDN から遅延ロード。
// 分類・PII 除去・集計・バンドル化は純ロジック（/local/*.js）を再利用する。
// すべてブラウザ内で完結し、生ファイルはネットワークに送らない。

import { classifyDocument } from './classify.js';
import { scrubText } from './pii.js';
import { extractTabular } from './tabular.js';
import {
  detectServiceKeyFromText,
  aggregateReceiptTexts,
  mergeUserSummaries,
  mergeStaffSummaries,
} from './aggregate.js';
import { buildLocalBundle } from './bundle.js';

const CDN = {
  pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs',
  pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs',
  xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm',
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js',
};

export const SUPPORTED_RE = /\.(pdf|xlsx|xls|csv|tsv|png|jpe?g|tiff?)$/i;

// ---- フォルダ選択（File System Access API / webkitdirectory フォールバック） ----
export async function pickFiles({ onFallbackInput } = {}) {
  if (window.showDirectoryPicker) {
    try {
      const handle = await window.showDirectoryPicker();
      const files = [];
      await collectFromDir(handle, files);
      return files;
    } catch (err) {
      if (err && err.name === 'AbortError') return [];
      if (onFallbackInput) return onFallbackInput();
    }
  }
  if (onFallbackInput) return onFallbackInput();
  return [];
}

export async function collectFromDir(dirHandle, out, depth = 0) {
  if (depth > 4) return;
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') out.push(await entry.getFile());
    else if (entry.kind === 'directory') await collectFromDir(entry, out, depth + 1);
  }
}

// ---- CDN 遅延ロード ----
let _pdfjs = null;
async function getPdfjs() {
  if (_pdfjs) return _pdfjs;
  _pdfjs = await import(/* @vite-ignore */ CDN.pdfjs);
  _pdfjs.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
  return _pdfjs;
}
let _xlsx = null;
async function getXlsx() {
  if (!_xlsx) _xlsx = await import(/* @vite-ignore */ CDN.xlsx);
  return _xlsx;
}
let _tesseractWorker = null;
async function getTesseractWorker() {
  if (_tesseractWorker) return _tesseractWorker;
  const T = await import(/* @vite-ignore */ CDN.tesseract);
  _tesseractWorker = await T.createWorker('jpn');
  return _tesseractWorker;
}

async function extractPdfText(file) {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    text += content.items.map((i) => i.str).join(' ') + '\f';
  }
  return text;
}

async function ocrPdf(file) {
  const pdfjs = await getPdfjs();
  const worker = await getTesseractWorker();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = '';
  const maxPages = Math.min(doc.numPages, 30);
  for (let p = 1; p <= maxPages; p += 1) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const { data } = await worker.recognize(canvas);
    text += (data.text || '') + '\f';
  }
  return text;
}

async function ocrImage(file) {
  const worker = await getTesseractWorker();
  const { data } = await worker.recognize(file);
  return data.text || '';
}

async function parseSheet(file, ext) {
  const XLSX = await getXlsx();
  let wb;
  if (ext === 'csv' || ext === 'tsv') wb = XLSX.read(await file.text(), { type: 'string' });
  else wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  let headerIdx = matrix.findIndex((r) => r.some((c) => String(c).trim()));
  if (headerIdx < 0) headerIdx = 0;
  const headers = (matrix[headerIdx] || []).map((c) => String(c).trim());
  const rows = matrix.slice(headerIdx + 1);
  return { headers, rows };
}

// 1 ファイルを解析して collected に反映。戻り値はステータスラベル。
async function handleOneFile(file, collected, { ocr }) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  let text = '';
  let headers = [];
  let rows = [];

  if (ext === 'pdf') {
    text = await extractPdfText(file);
    if ((!text || text.trim().length < 20) && ocr) text = await ocrPdf(file);
  } else if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext)) {
    const sheet = await parseSheet(file, ext);
    headers = sheet.headers;
    rows = sheet.rows;
    text = headers.join(' ');
  } else if (['png', 'jpg', 'jpeg', 'tif', 'tiff'].includes(ext)) {
    if (!ocr) return { text: 'OCR無効のためスキップ', cls: 'skip' };
    text = await ocrImage(file);
  }

  const scrubbed = scrubText(text);
  const { type } = classifyDocument({ fileName: file.name, text: scrubbed, headers });
  collected.fileTypeCounts[type] = (collected.fileTypeCounts[type] || 0) + 1;

  if (type === 'receipt') {
    collected.receiptTexts.push(scrubbed);
    if (!collected.detectedServiceKey) collected.detectedServiceKey = detectServiceKeyFromText(scrubbed);
    return { text: 'レセプト → 加算件数を集計', cls: 'ok' };
  }
  if (type === 'user_roster' && rows.length) {
    const out = extractTabular({ type, header: headers, rows });
    if (out.userSummary) collected.userSummaries.push(out.userSummary);
    trackDropped(out, collected);
    return { text: `利用者一覧 → ${out.userSummary?.activeUserCount ?? 0}名分を集計`, cls: 'ok' };
  }
  if (type === 'staff_roster' && rows.length) {
    const out = extractTabular({ type, header: headers, rows });
    if (out.staffSummary) collected.staffSummaries.push(out.staffSummary);
    trackDropped(out, collected);
    return { text: '勤務表 → 職種別人数を集計', cls: 'ok' };
  }
  if (type === 'tenant_status') {
    collected.hasTenantStatus = true;
    return { text: '体制届（参考）', cls: 'ok' };
  }
  return { text: '未分類のためスキップ', cls: 'skip' };
}

function trackDropped(out, collected) {
  for (const c of out.droppedColumns || []) if (c.pii) collected.droppedPiiColumns.add(c.name);
}

export function newCollected() {
  return {
    receiptTexts: [],
    userSummaries: [],
    staffSummaries: [],
    detectedServiceKey: null,
    fileTypeCounts: {},
    droppedPiiColumns: new Set(),
    hasTenantStatus: false,
  };
}

// ファイル群を解析して collected に蓄積。onProgress(name, label) でファイル毎に通知。
export async function processFilesInto(files, collected, { ocr = false, onProgress = null } = {}) {
  const supported = [...files].filter((f) => SUPPORTED_RE.test(f.name));
  for (const file of supported) {
    try {
      const label = await handleOneFile(file, collected, { ocr });
      if (onProgress) onProgress(file.name, label);
    } catch (err) {
      if (onProgress) onProgress(file.name, { text: `失敗: ${err.message}`, cls: 'warn' });
    }
  }
  return collected;
}

// collected → 匿名 analysis_source 互換バンドル（PII 混入時は buildLocalBundle が throw）。
export function collectedToBundle(collected, { serviceKey, serviceMonth, facility = null } = {}) {
  const key = serviceKey || collected.detectedServiceKey;
  if (!key) throw new Error('サービス種別を判定できませんでした。プルダウンで選択してください。');
  let claimEvidence = null;
  if (collected.receiptTexts.length) {
    claimEvidence = aggregateReceiptTexts(collected.receiptTexts, { serviceKey: key, office: 'local' }).evidence;
  }
  const userSummary = mergeUserSummaries(collected.userSummaries);
  const staffSummary = mergeStaffSummaries(collected.staffSummaries);
  const dataCompleteness = {
    billing: collected.receiptTexts.length ? 'partial' : 'missing',
    users: userSummary ? 'partial' : 'missing',
    staffing: staffSummary ? 'partial' : 'missing',
  };
  const bundle = buildLocalBundle({
    serviceKey: key,
    serviceMonth,
    userSummary,
    staffSummary,
    claimEvidence,
    dataCompleteness,
    warnings: ['Pro ワークスペースで取込（集計値・フラグのみ）'],
    fileTypeCounts: collected.fileTypeCounts,
  });
  if (facility) bundle.facility = { ...bundle.facility, ...facility };
  return bundle;
}
