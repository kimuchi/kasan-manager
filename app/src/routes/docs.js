// Markdown ドキュメント配信ルート
//
// リポジトリ直下の docs/ にある Markdown を、http://host/docs/<path> で HTML 配信する。
// 同時に http://host/docs/raw/<path> で生 Markdown も取得可能（CLI/コピペ用）。
//
// 依存: marked（軽量 Markdown → HTML 変換ライブラリ）
//
// セキュリティ:
//   - パスは sandbox 化して docs/ ディレクトリ外を読まない
//   - .md ファイルのみ HTML レンダリング、それ以外は静的配信
//   - HTML 出力時は marked の sanitize 機能で XSS を抑制

import express from 'express';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..', '..');
const PROJECT_ROOT = path.resolve(APP_ROOT, '..');
const DOCS_ROOT = path.join(PROJECT_ROOT, 'docs');

// marked の設定: GitHub 風 + ヘッディング自動ID
marked.use({
  gfm: true,
  breaks: false,
  headerIds: true,
});

export function isDocsAvailable() {
  return existsSync(DOCS_ROOT);
}

function safeJoin(base, target) {
  // パストラバーサル対策: 解決後のパスが base 配下であることを確認
  const resolved = path.resolve(base, target);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

const HTML_LAYOUT = (title, body, { breadcrumb = '', tocLinks = '' } = {}) => `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}｜加算マネージャ ドキュメント</title>
  <link rel="stylesheet" href="/styles.css" />
  <style>
    .docs-shell { max-width: 920px; margin: 0 auto; padding: 32px 20px 80px; }
    .docs-breadcrumb { color: var(--ink-mute); font-size: 14px; margin-bottom: 18px; }
    .docs-breadcrumb a { color: var(--accent); }
    .docs-content { background: #fff; border: 1px solid var(--border); border-radius: 14px; padding: 32px 36px; box-shadow: var(--shadow); }
    .docs-content h1, .docs-content h2, .docs-content h3 { color: var(--ink); border-bottom: 1px solid var(--border); padding-bottom: 6px; margin-top: 32px; }
    .docs-content h1 { font-size: 30px; margin-top: 0; }
    .docs-content h2 { font-size: 24px; }
    .docs-content h3 { font-size: 19px; border-bottom: none; }
    .docs-content code { background: #eef2fa; padding: 1px 6px; border-radius: 4px; font-size: 0.95em; }
    .docs-content pre { background: #f3f5fa; padding: 14px; border-radius: 8px; overflow-x: auto; font-size: 14px; }
    .docs-content pre code { background: transparent; padding: 0; }
    .docs-content table { border-collapse: collapse; margin: 14px 0; font-size: 15px; }
    .docs-content th, .docs-content td { border: 1px solid var(--border); padding: 6px 12px; }
    .docs-content th { background: #eef2fa; }
    .docs-content blockquote { border-left: 4px solid var(--accent); background: var(--accent-soft); padding: 8px 14px; margin: 12px 0; color: var(--ink-soft); }
    .docs-toc { font-size: 14px; color: var(--ink-soft); margin-bottom: 12px; }
    .docs-toc a { color: var(--ink-mute); margin-right: 14px; }
    .docs-toc a:hover { color: var(--accent); }
    .docs-meta { color: var(--ink-mute); font-size: 13px; margin-top: 24px; }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="brand">
      <span class="brand-mark">📚</span>
      <div class="brand-text">
        <h1>加算マネージャ ドキュメント</h1>
        <p>使い方・JSON 形式・CPOS 連携・データ取扱方針</p>
      </div>
    </div>
    <div><a href="/" style="color: var(--accent);">← アプリに戻る</a></div>
  </header>
  <main class="docs-shell">
    <div class="docs-breadcrumb">${breadcrumb}</div>
    <div class="docs-toc">${tocLinks}</div>
    <article class="docs-content">${body}</article>
    <p class="docs-meta">このドキュメントはリポジトリ <code>docs/</code> 配下の Markdown を配信しています。</p>
  </main>
</body>
</html>`;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildBreadcrumb(relPath) {
  const parts = relPath.split('/').filter(Boolean);
  const out = ['<a href="/docs/">ドキュメント トップ</a>'];
  let acc = '';
  for (let i = 0; i < parts.length; i += 1) {
    acc += `/${parts[i]}`;
    const isLast = i === parts.length - 1;
    const label = parts[i].replace(/\.md$/, '');
    if (isLast) out.push(`<span>${escapeHtml(label)}</span>`);
    else out.push(`<a href="/docs${acc}/">${escapeHtml(label)}</a>`);
  }
  return out.join(' / ');
}

const TOC_LINKS = [
  { href: '/docs/USER_GUIDE.md', label: '使い方' },
  { href: '/docs/AUTH_AND_PLANS.md', label: 'ログイン / プラン' },
  { href: '/docs/REVIEWER_GUIDE.md', label: 'レビュアー' },
  { href: '/docs/PORTFOLIO.md', label: 'ポートフォリオ最適化' },
  { href: '/docs/MASTER_REVIEW.md', label: 'マスタ整合性レビュー' },
  { href: '/docs/CPOS_TOKEN.md', label: 'CPOS 連携 (PAT)' },
  { href: '/docs/json/', label: 'JSON 形式' },
  { href: '/docs/DATA_SAFETY.md', label: 'データ取扱方針' },
  { href: '/docs/DEPLOYMENT.md', label: 'デプロイ' },
  { href: '/docs/CLI.md', label: 'CLI' },
  { href: '/docs/TECHNICAL.md', label: '技術' },
];

function tocHtml() {
  return TOC_LINKS.map((l) => `<a href="${l.href}">${escapeHtml(l.label)}</a>`).join('');
}

async function renderIndex(req, res) {
  // docs/ 直下の README 風の一覧を作る
  const items = await safeListDir(DOCS_ROOT);
  const links = items
    .filter((it) => it.kind === 'file' && it.name.endsWith('.md'))
    .map((it) => `<li><a href="/docs/${encodeURIComponent(it.name)}">${escapeHtml(it.name.replace(/\.md$/, ''))}</a></li>`)
    .join('\n');
  const dirs = items
    .filter((it) => it.kind === 'dir')
    .map((it) => `<li>📁 <a href="/docs/${encodeURIComponent(it.name)}/">${escapeHtml(it.name)}/</a></li>`)
    .join('\n');
  const body = `<h1>加算マネージャ ドキュメント</h1>
<p>このアプリの使い方・JSON 入力形式・CPOS 連携 (PAT 認証)・データ取扱方針などをまとめています。</p>
<h2>主要トピック</h2>
<ul>
  <li>📘 <a href="/docs/USER_GUIDE.md">使い方ガイド</a></li>
  <li>🔐 <a href="/docs/CPOS_TOKEN.md">CPOS PAT を使った接続手順</a></li>
  <li>🛡 <a href="/docs/DATA_SAFETY.md">データ取扱方針</a></li>
  <li>📋 <a href="/docs/json/">JSON 入力形式リファレンス</a></li>
  <li>🚀 <a href="/docs/DEPLOYMENT.md">デプロイ</a></li>
  <li>⚙ <a href="/docs/CLI.md">CLI コマンド</a></li>
  <li>🧠 <a href="/docs/TECHNICAL.md">技術リファレンス</a></li>
</ul>
${dirs ? `<h3>その他フォルダ</h3><ul>${dirs}</ul>` : ''}
${links ? `<h3>その他のドキュメント</h3><ul>${links}</ul>` : ''}`;
  res.set('content-type', 'text/html; charset=utf-8');
  res.send(HTML_LAYOUT('ドキュメント', body, { breadcrumb: '<span>ドキュメント トップ</span>', tocLinks: tocHtml() }));
}

async function safeListDir(dir) {
  if (!existsSync(dir)) return [];
  const items = await readdir(dir);
  const out = [];
  for (const name of items) {
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    try {
      const s = await stat(full);
      out.push({ name, kind: s.isDirectory() ? 'dir' : 'file' });
    } catch {}
  }
  return out;
}

async function renderDirIndex(req, res, relDir) {
  const dir = safeJoin(DOCS_ROOT, relDir);
  if (!dir || !existsSync(dir)) {
    res.status(404).send('Not Found');
    return;
  }
  // dir に index.md があれば優先
  const indexMd = path.join(dir, 'index.md');
  if (existsSync(indexMd)) {
    return renderMarkdownFile(req, res, path.join(relDir, 'index.md'));
  }
  const items = await safeListDir(dir);
  const links = items
    .map((it) => {
      const href = `/docs/${path.posix.join(relDir, it.name)}${it.kind === 'dir' ? '/' : ''}`;
      const icon = it.kind === 'dir' ? '📁' : '📄';
      return `<li>${icon} <a href="${href}">${escapeHtml(it.name)}</a></li>`;
    })
    .join('\n');
  const body = `<h1>${escapeHtml(relDir)}/</h1>
<p>このフォルダのファイル一覧です。</p>
<ul>${links}</ul>`;
  res.set('content-type', 'text/html; charset=utf-8');
  res.send(HTML_LAYOUT(relDir, body, { breadcrumb: buildBreadcrumb(relDir + '/'), tocLinks: tocHtml() }));
}

async function renderMarkdownFile(req, res, relPath) {
  const full = safeJoin(DOCS_ROOT, relPath);
  if (!full || !existsSync(full)) {
    res.status(404).send('Not Found');
    return;
  }
  const stats = await stat(full);
  if (stats.isDirectory()) return renderDirIndex(req, res, relPath);
  if (!relPath.endsWith('.md')) {
    // 非 Markdown は静的配信（サンプル JSON 等）
    res.sendFile(full);
    return;
  }
  const md = await readFile(full, 'utf-8');
  let html;
  try {
    html = marked.parse(md, { async: false });
  } catch (err) {
    res.status(500).send(`Markdown render error: ${escapeHtml(err.message)}`);
    return;
  }
  // 内部の相対リンク（*.md / ディレクトリ）は /docs/ 起点に変換
  html = html.replace(
    /href="(?!https?:|mailto:|#|\/docs\/|\/static\/|\/)([^"]+)"/g,
    (m, p) => `href="/docs/${path.posix.join(path.posix.dirname(relPath), p)}"`,
  );
  const title = path.basename(relPath, '.md');
  res.set('content-type', 'text/html; charset=utf-8');
  res.send(HTML_LAYOUT(title, html, { breadcrumb: buildBreadcrumb(relPath), tocLinks: tocHtml() }));
}

const router = express.Router();

router.get(/^\/raw\/(.+)$/, async (req, res) => {
  const rel = req.params[0];
  const full = safeJoin(DOCS_ROOT, rel);
  if (!full || !existsSync(full)) {
    res.status(404).send('Not Found');
    return;
  }
  res.type('text/plain; charset=utf-8');
  res.sendFile(full);
});

router.get(/.*/, async (req, res) => {
  if (!isDocsAvailable()) {
    res.status(503).send('docs ディレクトリが見つかりません');
    return;
  }
  const rel = decodeURIComponent(req.path.replace(/^\/+/, ''));
  if (!rel || rel === '' || rel === '/') {
    return renderIndex(req, res);
  }
  if (rel.endsWith('/')) {
    return renderDirIndex(req, res, rel.replace(/\/+$/, ''));
  }
  return renderMarkdownFile(req, res, rel);
});

export const docsRouter = router;
