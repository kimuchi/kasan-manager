// ローカル前処理エンジン（ブラウザ完結）のオーケストレーション。
//
// すべての解析（PDF テキスト抽出・Excel/CSV パース・OCR・分類・PII 除去・集計）は
// このタブの中だけで行う。クラウドへ送るのは集計バンドル（集計値・フラグのみ）。
//
// 決定的な純ロジックは /local/*.js（Node のスモークテストでも検証済み）を import する。
// ブラウザ専用の重いライブラリ（pdf.js / SheetJS / Tesseract）は CDN から遅延 import する。

import { classifyDocument } from './local/classify.js';
import { scrubText } from './local/pii.js';
import { extractTabular } from './local/tabular.js';
import {
  detectServiceKeyFromText,
  aggregateReceiptTexts,
  mergeUserSummaries,
  mergeStaffSummaries,
} from './local/aggregate.js';
import { buildLocalBundle } from './local/bundle.js';

const CDN = {
  pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs',
  pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs',
  xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm',
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js',
};

const $ = (sel) => document.querySelector(sel);

const appConfig = {
  csrf_token: null,
  csrf_header_name: 'x-csrf-token',
  recaptcha_enabled: false,
  recaptcha_site_key: null,
  recaptcha_loaded: false,
};

// このセッションで集めた集計（生データは保持しない）
const collected = {
  receiptTexts: [],
  userSummaries: [],
  staffSummaries: [],
  detectedServiceKey: null,
  fileTypeCounts: {},
  droppedPiiColumns: new Set(),
  hasTenantStatus: false,
};
let currentBundle = null;

// ───────────────────────── 起動 ─────────────────────────
init();

async function init() {
  const monthInput = $('#le-month');
  const now = new Date();
  monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  try {
    const res = await fetch('/api/health');
    const json = await res.json();
    $('#status-pill').classList.add('ok');
    $('#status-text').textContent = json.gemini_configured ? `接続OK（${json.model}）` : '判定エンジン利用可';
    if (json.csrf?.token) {
      appConfig.csrf_token = json.csrf.token;
      appConfig.csrf_header_name = json.csrf.header_name || 'x-csrf-token';
    }
    if (json.recaptcha?.enabled && json.recaptcha?.site_key) {
      appConfig.recaptcha_enabled = true;
      appConfig.recaptcha_site_key = json.recaptcha.site_key;
      $('#le-recaptcha-notice').style.display = '';
      loadRecaptchaScript(json.recaptcha.site_key);
    }
  } catch {
    $('#status-pill').classList.add('error');
    $('#status-text').textContent = '接続エラー';
  }

  $('#le-pick-dir').addEventListener('click', pickDirectory);
  $('#le-pick-files').addEventListener('change', (e) => processFiles([...e.target.files]));
  $('#le-send').addEventListener('click', sendBundle);
}

// ─────────────────── フォルダ選択 ───────────────────
async function pickDirectory() {
  if (window.showDirectoryPicker) {
    try {
      const handle = await window.showDirectoryPicker();
      const files = [];
      await collectFromDir(handle, files);
      await processFiles(files);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      // 権限拒否等はフォールバック
      $('#le-pick-files').click();
    }
  } else {
    $('#le-pick-files').click();
  }
}

async function collectFromDir(dirHandle, out, depth = 0) {
  if (depth > 4) return;
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      out.push(await entry.getFile());
    } else if (entry.kind === 'directory') {
      await collectFromDir(entry, out, depth + 1);
    }
  }
}

// ─────────────────── ファイル処理 ───────────────────
async function processFiles(files) {
  resetCollected();
  const list = $('#le-files');
  list.innerHTML = '';
  $('#le-progress-card').classList.remove('hidden');
  $('#le-preview-card').classList.add('hidden');
  $('#le-result-card').classList.add('hidden');

  const supported = files.filter((f) => /\.(pdf|xlsx|xls|csv|tsv|png|jpe?g|tiff?)$/i.test(f.name));
  $('#le-progress-note').textContent = `${supported.length} 件の対象ファイルを解析します…`;

  for (const file of supported) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = file.name;
    const badge = document.createElement('span');
    badge.className = 'le-badge';
    badge.textContent = '解析中…';
    li.append(name, badge);
    list.appendChild(li);
    try {
      const label = await handleOneFile(file);
      badge.textContent = label.text;
      badge.className = `le-badge ${label.cls}`;
    } catch (err) {
      badge.textContent = `失敗: ${err.message}`;
      badge.className = 'le-badge warn';
    }
  }

  await buildAndPreview();
}

async function handleOneFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  let text = '';
  let headers = [];
  let rows = [];

  if (ext === 'pdf') {
    text = await extractPdfText(file);
    if ((!text || text.trim().length < 20) && $('#le-ocr').checked) {
      text = await ocrPdf(file);
    }
  } else if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext)) {
    const sheet = await parseSheet(file, ext);
    headers = sheet.headers;
    rows = sheet.rows;
    text = headers.join(' ');
  } else if (['png', 'jpg', 'jpeg', 'tif', 'tiff'].includes(ext)) {
    if (!$('#le-ocr').checked) return { text: 'OCR無効のためスキップ', cls: 'skip' };
    text = await ocrImage(file);
  }

  const scrubbed = scrubText(text);
  const { type, confidence } = classifyDocument({ fileName: file.name, text: scrubbed, headers });
  collected.fileTypeCounts[type] = (collected.fileTypeCounts[type] || 0) + 1;

  if (type === 'receipt') {
    collected.receiptTexts.push(scrubbed);
    if (!collected.detectedServiceKey) collected.detectedServiceKey = detectServiceKeyFromText(scrubbed);
    return { text: 'レセプト → 加算件数を集計', cls: 'ok' };
  }
  if (type === 'user_roster' && rows.length) {
    const out = extractTabular({ type, header: headers, rows });
    if (out.userSummary) collected.userSummaries.push(out.userSummary);
    trackDropped(out);
    return { text: `利用者一覧 → ${out.userSummary?.activeUserCount ?? 0}名分を集計`, cls: 'ok' };
  }
  if (type === 'staff_roster' && rows.length) {
    const out = extractTabular({ type, header: headers, rows });
    if (out.staffSummary) collected.staffSummaries.push(out.staffSummary);
    trackDropped(out);
    return { text: '勤務表 → 職種別人数を集計', cls: 'ok' };
  }
  if (type === 'tenant_status') {
    collected.hasTenantStatus = true;
    return { text: '体制届（参考）', cls: 'ok' };
  }
  return { text: '未分類のためスキップ', cls: 'skip' };
}

function trackDropped(out) {
  for (const c of out.droppedColumns || []) {
    if (c.pii) collected.droppedPiiColumns.add(c.name);
  }
}

// ─────────────────── バンドル組み立て + プレビュー ───────────────────
async function buildAndPreview() {
  const month = $('#le-month').value;
  let serviceKey = $('#le-service').value || collected.detectedServiceKey;
  const note = $('#le-progress-note');

  if (!serviceKey) {
    note.textContent =
      'サービス種別を判定できませんでした。上のプルダウンで対象サービスを選んでください。';
    return;
  }
  if (!month) {
    note.textContent = '対象月を入力してください。';
    return;
  }

  let claimEvidence = null;
  if (collected.receiptTexts.length) {
    claimEvidence = aggregateReceiptTexts(collected.receiptTexts, { serviceKey, office: 'local' }).evidence;
  }
  const userSummary = mergeUserSummaries(collected.userSummaries);
  const staffSummary = mergeStaffSummaries(collected.staffSummaries);

  const dataCompleteness = {
    billing: collected.receiptTexts.length ? 'partial' : 'missing',
    users: userSummary ? 'partial' : 'missing',
    staffing: staffSummary ? 'partial' : 'missing',
  };

  try {
    currentBundle = buildLocalBundle({
      serviceKey,
      serviceMonth: month,
      userSummary,
      staffSummary,
      claimEvidence,
      dataCompleteness,
      warnings: ['ローカル前処理エンジンで取り込み（集計値・フラグのみ）'],
      fileTypeCounts: collected.fileTypeCounts,
    });
  } catch (err) {
    note.textContent = `送信を中止しました: ${err.message}`;
    return;
  }

  $('#le-preview').textContent = JSON.stringify(currentBundle, null, 2);
  const dropped = [...collected.droppedPiiColumns];
  $('#le-dropped').textContent = dropped.length
    ? `破棄した個人情報の列: ${dropped.join(' / ')}`
    : '';
  $('#le-preview-card').classList.remove('hidden');
  note.textContent = '解析が完了しました。下のプレビューを確認して送信してください。';
}

// ─────────────────── 送信 ───────────────────
async function sendBundle() {
  if (!currentBundle) return;
  const sendBtn = $('#le-send');
  const sendNote = $('#le-send-note');
  sendBtn.disabled = true;
  sendNote.textContent = appConfig.recaptcha_enabled ? '安全確認中…' : '加算チェック中…';

  try {
    const body = { ...currentBundle };
    if (appConfig.recaptcha_enabled) {
      body.recaptcha_token = await getRecaptchaToken('local_analyze');
    }
    const headers = { 'content-type': 'application/json' };
    if (appConfig.csrf_token) headers[appConfig.csrf_header_name] = appConfig.csrf_token;

    const res = await fetch('/api/analyze/from-local', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
    const payload = await res.json();
    if (!res.ok || payload.error) {
      throw new Error(payload.message || payload.error || `HTTP ${res.status}`);
    }
    $('#le-report').innerHTML = renderMarkdownLite(payload.reportMarkdown || '(レポートなし)');
    $('#le-result-card').classList.remove('hidden');
    $('#le-result-card').scrollIntoView({ behavior: 'smooth' });
    sendNote.textContent = '完了しました。';
  } catch (err) {
    sendNote.textContent = `エラー: ${err.message}`;
  } finally {
    sendBtn.disabled = false;
  }
}

// ─────────────────── CDN ライブラリの遅延ロード ───────────────────
let _pdfjs = null;
async function getPdfjs() {
  if (_pdfjs) return _pdfjs;
  _pdfjs = await import(/* @vite-ignore */ CDN.pdfjs);
  _pdfjs.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
  return _pdfjs;
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

let _xlsx = null;
async function getXlsx() {
  if (!_xlsx) _xlsx = await import(/* @vite-ignore */ CDN.xlsx);
  return _xlsx;
}

async function parseSheet(file, ext) {
  const XLSX = await getXlsx();
  let wb;
  if (ext === 'csv' || ext === 'tsv') {
    wb = XLSX.read(await file.text(), { type: 'string' });
  } else {
    wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  // 先頭の空行を飛ばしてヘッダ行を見つける
  let headerIdx = matrix.findIndex((r) => r.some((c) => String(c).trim()));
  if (headerIdx < 0) headerIdx = 0;
  const headers = (matrix[headerIdx] || []).map((c) => String(c).trim());
  const rows = matrix.slice(headerIdx + 1);
  return { headers, rows };
}

let _tesseractWorker = null;
async function getTesseractWorker() {
  if (_tesseractWorker) return _tesseractWorker;
  const T = await import(/* @vite-ignore */ CDN.tesseract);
  _tesseractWorker = await T.createWorker('jpn');
  return _tesseractWorker;
}

async function ocrImage(file) {
  const worker = await getTesseractWorker();
  const { data } = await worker.recognize(file);
  return data.text || '';
}

async function ocrPdf(file) {
  // テキスト層の無い PDF: 各ページを canvas にレンダリングして OCR
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

// ─────────────────── reCAPTCHA ───────────────────
function loadRecaptchaScript(siteKey) {
  if (appConfig.recaptcha_loaded) return;
  appConfig.recaptcha_loaded = true;
  const s = document.createElement('script');
  s.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
  s.async = true;
  s.defer = true;
  document.head.appendChild(s);
}

async function getRecaptchaToken(action) {
  if (!appConfig.recaptcha_enabled) return null;
  for (let i = 0; i < 50; i += 1) {
    if (window.grecaptcha && window.grecaptcha.execute) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!window.grecaptcha || !window.grecaptcha.execute) {
    throw new Error('reCAPTCHA を読み込めませんでした。ページを再読込してください。');
  }
  return new Promise((resolve, reject) => {
    window.grecaptcha.ready(() => {
      window.grecaptcha.execute(appConfig.recaptcha_site_key, { action }).then(resolve).catch(reject);
    });
  });
}

// ─────────────────── 補助 ───────────────────
function resetCollected() {
  collected.receiptTexts = [];
  collected.userSummaries = [];
  collected.staffSummaries = [];
  collected.detectedServiceKey = null;
  collected.fileTypeCounts = {};
  collected.droppedPiiColumns = new Set();
  collected.hasTenantStatus = false;
  currentBundle = null;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// サーバ返却の Markdown を軽量 HTML に（見出し/箇条書き/強調/コード/テーブルのみ）
function renderMarkdownLite(md) {
  const lines = String(md).split('\n');
  const html = [];
  let inList = false;
  let tableBuf = [];
  const flushList = () => {
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
  };
  const flushTable = () => {
    if (!tableBuf.length) return;
    const rows = tableBuf.filter((r) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(r));
    const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    html.push('<table style="border-collapse:collapse;">');
    rows.forEach((r, i) => {
      const tag = i === 0 ? 'th' : 'td';
      const tds = cells(r).map((c) => `<${tag} style="border:1px solid #ccc;padding:4px 8px;">${inline(c)}</${tag}>`).join('');
      html.push(`<tr>${tds}</tr>`);
    });
    html.push('</table>');
    tableBuf = [];
  };
  const inline = (t) =>
    escapeHtml(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushList();
      tableBuf.push(line.trim());
      continue;
    }
    flushTable();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      const level = h[1].length;
      html.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    flushList();
    if (line.trim() === '') html.push('');
    else html.push(`<p>${inline(line)}</p>`);
  }
  flushList();
  flushTable();
  return html.join('\n');
}
