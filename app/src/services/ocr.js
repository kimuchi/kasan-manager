// サーバ側 OCR（スキャンPDF対応）。
//
// poppler の `pdftoppm` でPDFページをPNG画像にし、`tesseract`（日本語）で文字認識する。
// バイナリが無い環境では ocrAvailable() が false を返し、呼び出し側はOCRをスキップする
// （デジタルPDFは従来どおり pdf-parse のテキスト抽出で処理される）。
//
// プライバシー: 生PDF・中間PNG・OCRテキストはディスクに永続化しない。
// 一時ディレクトリ（os.tmpdir 配下）に出して finally で必ず削除し、テキストは呼び出し元へ
// 返すだけ（呼び出し元 receipt-pdf.js が PII スクラブ → 集計値のみを evidence 化する）。

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFileP = promisify(execFile);

const OCR_DPI = Number(process.env.KASAN_OCR_DPI || 300);
const OCR_LANG = process.env.KASAN_OCR_LANG || 'jpn';
const OCR_MAX_PAGES = Number(process.env.KASAN_OCR_MAX_PAGES || 20);
const BIN_TIMEOUT_MS = Number(process.env.KASAN_OCR_TIMEOUT_MS || 120000);

let _availPromise = null;

async function binPresent(bin, args) {
  try {
    await execFileP(bin, args, { timeout: 5000 });
    return true;
  } catch (err) {
    // ENOENT = バイナリ未インストール。それ以外（非ゼロ終了など）は「存在する」とみなす。
    return err.code !== 'ENOENT';
  }
}

// テスト用にキャッシュをリセット
export function resetOcrAvailabilityCache() {
  _availPromise = null;
}

// pdftoppm / tesseract が両方使えるか（結果はキャッシュ）。
// KASAN_DISABLE_SERVER_OCR=1 で強制無効化（高速なテスト等）。
export async function ocrAvailable() {
  if (process.env.KASAN_DISABLE_SERVER_OCR === '1') return false;
  if (!_availPromise) {
    _availPromise = (async () => {
      const [pdf, tess] = await Promise.all([
        binPresent('pdftoppm', ['-v']),
        binPresent('tesseract', ['--version']),
      ]);
      return pdf && tess;
    })();
  }
  return _availPromise;
}

// スキャンPDF（画像PDF）をOCRしてテキスト化。バイナリ未導入なら null を返す。
// ページ区切りは \f（analyzeText のページ分割と整合）。
export async function ocrPdfBuffer(buffer, { maxPages = OCR_MAX_PAGES } = {}) {
  if (!buffer || !buffer.length) return null;
  if (!(await ocrAvailable())) return null;

  const dir = await mkdtemp(path.join(os.tmpdir(), 'kasan-ocr-'));
  try {
    const pdfPath = path.join(dir, 'src.pdf');
    await writeFile(pdfPath, buffer);

    // PDF → PNG（1..maxPages ページ）。プレフィックス page-1.png, page-2.png ...
    await execFileP(
      'pdftoppm',
      ['-png', '-r', String(OCR_DPI), '-f', '1', '-l', String(maxPages), pdfPath, path.join(dir, 'page')],
      { timeout: BIN_TIMEOUT_MS, maxBuffer: 128 * 1024 * 1024 },
    );

    const pages = (await readdir(dir)).filter((f) => /\.png$/i.test(f)).sort(pageSort);
    const parts = [];
    for (const f of pages) {
      const { stdout } = await execFileP(
        'tesseract',
        [path.join(dir, f), 'stdout', '-l', OCR_LANG],
        { timeout: BIN_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
      );
      parts.push(stdout || '');
    }
    return parts.join('\f');
  } finally {
    // 生PDF・中間PNGを必ず破棄（保存しない）
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// page-2.png < page-10.png となるよう数値順にソート
function pageSort(a, b) {
  const na = Number((a.match(/(\d+)/) || [])[1] || 0);
  const nb = Number((b.match(/(\d+)/) || [])[1] || 0);
  return na - nb;
}
