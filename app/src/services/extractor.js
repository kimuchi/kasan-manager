import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const MAX_EXCERPT_CHARS = 6000;

export async function extractTextFromUpload(file) {
  const mimetype = file.mimetype || '';
  const filename = file.originalname || 'upload';
  const size = file.size || (file.buffer ? file.buffer.length : 0);

  let kind = 'binary';
  let text = '';

  if (mimetype === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
    kind = 'pdf';
    text = await extractPdf(file.buffer);
  } else if (
    mimetype.startsWith('text/') ||
    mimetype === 'application/json' ||
    mimetype === 'application/csv' ||
    mimetype === 'text/csv' ||
    /\.(txt|csv|tsv|md|json|log)$/i.test(filename)
  ) {
    kind = 'text';
    text = file.buffer.toString('utf-8');
  } else {
    kind = mimetype || 'unknown';
    text = '（このファイル形式はテキスト抽出に対応していません。ファイル名のみが渡されます）';
  }

  const trimmed = text.length > MAX_EXCERPT_CHARS ? `${text.slice(0, MAX_EXCERPT_CHARS)}\n…（以降省略）` : text;

  return {
    filename,
    kind,
    size_bytes: size,
    text_excerpt: trimmed,
  };
}

async function extractPdf(buffer) {
  try {
    // pdf-parse の index.js は debug 用にサンプル PDF を読み込もうとするため、
    // 直接ライブラリ本体を require する。
    const pdfParse = require('pdf-parse/lib/pdf-parse.js');
    const result = await pdfParse(buffer);
    return result.text || '（PDF からテキストを抽出できませんでした）';
  } catch (err) {
    return `（PDF テキスト抽出に失敗: ${err.message}）`;
  }
}
