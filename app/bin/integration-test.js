#!/usr/bin/env node
// ルートレベル結合テスト（CPOS 一本化）。
//
// 本物の CPOS は不要。KASAN_CPOS_FAKE=1 でサーバをプロセス内 Fake CPOS つきで起動し、
// ログイン済みセッション cookie を（同じ KASAN_SESSION_SECRET で）自前生成して、
// 認証必須のルート（プロフィール / 名簿 / ドラフト / 解析 / 履歴 / 管理 / CPOS解析）を
// 実 HTTP で一通り叩いて検証する。
//
// 使い方: npm run test:integration

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT) || 8094;
const BASE = `http://localhost:${PORT}`;
const SECRET = 'k'.repeat(48);
const ORG = 'org_demo';
const UID = 'user_demo';

const env = {
  ...process.env,
  PORT: String(PORT),
  NODE_ENV: 'development',
  KASAN_CPOS_FAKE: '1',
  KASAN_SESSION_SECRET: SECRET,
  KASAN_DEFAULT_CPOS_BASE_URL: 'https://cpos.example.jp',
  KASAN_CPOS_FAKE_ORG: ORG,
  RATE_LIMIT_ENABLED: 'false',
  // ingest-pdf テストは「エンドポイントの配線」を見る目的。サーバOCR(poppler+tesseract)に依存
  // させず高速・決定的にするため無効化（OCR本体は別途 OCR ユニットで検証）。
  KASAN_DISABLE_SERVER_OCR: '1',
};

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`❌ ${name}\n   ${err.message}`);
    failed += 1;
  }
}

async function waitForHealth(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return r;
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error('server did not become healthy in time');
}

async function main() {
  // セッション cookie を生成（同一 SECRET なのでサーバ側が復号できる）
  process.env.KASAN_SESSION_SECRET = SECRET;
  const { buildSessionPayload, setSessionCookie } = await import('../src/services/cpos/app-auth.js');
  const future = new Date(Date.now() + 86400000).toISOString();
  const sess = buildSessionPayload({
    user: { id: UID, email: 'demo@example.com', name: 'Demo Admin', role: 'admin' },
    organizationId: ORG,
    planTier: 'paid',
    planExpiresAt: future,
  });
  let sessionCookie = null;
  setSessionCookie(
    { getHeader: () => undefined, setHeader: (_k, v) => (sessionCookie = Array.isArray(v) ? v[0] : v) },
    sess,
  );
  sessionCookie = sessionCookie.split(';')[0]; // kasan_session=...

  const child = spawn('node', ['src/server.js'], { cwd: APP_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));

  try {
    const health = await waitForHealth();
    const hj = await health.json();
    const csrf = hj.csrf.token;
    const cookie = `${sessionCookie}; kasan_csrf=${csrf}`;
    const H = { 'content-type': 'application/json', 'x-csrf-token': csrf, cookie };
    const api = async (method, p, body) => {
      const r = await fetch(`${BASE}${p}`, {
        method,
        headers: H,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const j = await r.json().catch(() => ({}));
      return { status: r.status, j };
    };

    await check('health: cpos_login_enabled + backend=cpos_app_data', () => {
      assert.equal(hj.auth.cpos_login_enabled, true);
      assert.equal(hj.persistence.backend, 'cpos_app_data');
    });

    await check('GET /api/me: セッションが org/role/plan を返す', async () => {
      const { j } = await api('GET', '/api/me');
      assert.equal(j.authenticated, true);
      assert.equal(j.organizationId, ORG);
      assert.equal(j.role, 'admin');
      assert.equal(j.planTier, 'paid');
      assert.equal(j.isAdmin, true);
    });

    let facilityId;
    await check('施設プロフィール: 保存→一覧', async () => {
      const { j } = await api('POST', '/api/profiles/facilities', {
        name: 'デイほっと',
        officeCode: 'DEMO-0004',
        serviceKey: 'tsusho_kaigo',
        regionGrade: '2',
      });
      assert.ok(j.facility?.id, JSON.stringify(j));
      facilityId = j.facility.id;
      const list = await api('GET', '/api/profiles/facilities');
      assert.equal(list.j.facilities.length, 1);
      assert.equal(list.j.facilities[0].name, 'デイほっと');
    });

    await check('従業員名簿: 氏名を保存せず職種別集計', async () => {
      const { j } = await api('POST', '/api/profiles/staff-rosters', {
        label: '本体職員',
        serviceKey: 'tsusho_kaigo',
        entries: [
          { label: '山田太郎', qualification: '介護福祉士', fte: 1, joukin: true },
          { name: '佐藤花子', qualifications: ['看護師'], fte: 1 },
        ],
      });
      assert.equal(j.roster.headcount, 2);
      assert.equal(j.roster.qualifiedPersonCountByProfession.care_worker, 1);
      assert.equal(j.roster.qualifiedPersonCountByProfession.nurse, 1);
      assert.equal(/山田太郎|佐藤花子/.test(JSON.stringify(j.roster)), false);
    });

    let draftId;
    await check('ドラフト: 作成→merge→解析（CPOS app-data に保存）', async () => {
      const c = await api('POST', '/api/drafts', { serviceKey: 'tsusho_kaigo', serviceMonth: '2026-04' });
      draftId = c.j.draft.id;
      assert.ok(draftId);
      await api('POST', `/api/drafts/${draftId}/merge`, {
        userSummary: { activeUserCount: 10, careLevelDistribution: { youkaigo_3: 6 }, care3PlusCount: 6, care3PlusRatio: 0.6 },
        claimEvidence: { _meta: { schema: 'evidence' }, evidence: [{ current_kasan_counts: { nyuyoku_I: 3 }, detected_service_codes: ['155301'], total_pages: 3 }] },
      });
      const a = await api('POST', `/api/drafts/${draftId}/analyze`, {});
      assert.equal(a.j.ok, true, JSON.stringify(a.j));
      assert.equal(a.j.source_type, 'local_engine');
      assert.equal(a.j.persisted, true);
      assert.equal(a.j.resultJson.service, 'tsusho_kaigo');
    });

    await check('ドラフト: PDFをサーバ解析して反映（ingest-pdf / multipart）', async () => {
      const { readFileSync } = await import('node:fs');
      const buf = readFileSync(new URL('../../tests/fixtures/tsusho_receipt_sample.pdf', import.meta.url));
      // 正常系: serviceKey 付きドラフトに PDF を送る → ok + ingested に該当ファイル
      const c = await api('POST', '/api/drafts', { serviceKey: 'tsusho_kaigo', serviceMonth: '2026-04' });
      const fd = new FormData();
      fd.append('pdf', new Blob([buf], { type: 'application/pdf' }), 'tsusho_receipt_sample.pdf');
      fd.append('serviceKey', 'tsusho_kaigo');
      const r = await fetch(`${BASE}/api/drafts/${c.j.draft.id}/ingest-pdf`, {
        method: 'POST',
        headers: { 'x-csrf-token': csrf, cookie },
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      assert.equal(r.status, 200, JSON.stringify(j));
      assert.equal(j.ok, true, JSON.stringify(j));
      assert.equal(j.draft.id, c.j.draft.id);
      assert.ok(Array.isArray(j.ingested) && j.ingested.length === 1, JSON.stringify(j.ingested));
      assert.equal(j.ingested[0].file, 'tsusho_receipt_sample.pdf');
      // ガード: serviceKey 不明のドラフトでは 400 service_required
      const c2 = await api('POST', '/api/drafts', {});
      const fd2 = new FormData();
      fd2.append('pdf', new Blob([buf], { type: 'application/pdf' }), 'x.pdf');
      const r2 = await fetch(`${BASE}/api/drafts/${c2.j.draft.id}/ingest-pdf`, {
        method: 'POST',
        headers: { 'x-csrf-token': csrf, cookie },
        body: fd2,
      });
      assert.equal(r2.status, 400);
    });

    await check('履歴: /api/analyses が保存済み解析を返す', async () => {
      const { j } = await api('GET', '/api/analyses');
      assert.ok(j.jobs.length >= 1);
      assert.equal(j.jobs.some((x) => x.service === 'tsusho_kaigo'), true);
    });

    await check('CPOS 解析（App Token + fake analysis-source）→ 保存', async () => {
      const { j } = await api('POST', '/api/analyze/from-cpos', {
        facilityId: 'fac_a',
        serviceMonth: '2026-04',
        serviceKey: 'tsusho_kaigo',
      });
      assert.equal(j.ok, true, JSON.stringify(j));
      assert.equal(j.source_type, 'cpos_analysis_source');
      assert.equal(j.persisted, true);
      assert.equal(j.cpos.sourceEndpoint, '/api/kasan/v1/analysis-source');
    });

    await check('CPOS 事業所一覧（App Token）', async () => {
      const { j } = await api('GET', '/api/cpos/facilities');
      assert.ok(j.facilities.length >= 1);
      assert.equal(j.facilities[0].id, 'fac_a');
    });

    await check('管理: users / stats / エンタイトルメント付与', async () => {
      const u = await api('GET', '/api/admin/users');
      assert.ok(u.j.users.some((x) => x.email === 'demo@example.com'));
      const s = await api('GET', '/api/admin/stats');
      assert.ok(s.j.stats.analyses.total >= 2); // local + cpos
      const g = await api('POST', `/api/admin/users/${UID}/plan`, { action: 'grant', days: 30 });
      assert.equal(g.j.ok, true);
      assert.equal(g.j.planTier, 'paid');
    });

    await check('未ログインは 401（cookie 無し）', async () => {
      const r = await fetch(`${BASE}/api/profiles/facilities`);
      assert.equal(r.status, 401);
    });

    await check('logout でセッション cookie を破棄', async () => {
      const r = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: H });
      assert.equal(r.status, 200);
    });
  } finally {
    child.kill('SIGTERM');
  }

  console.log(`\n結果(integration): ${passed} 件成功 / ${failed} 件失敗`);
  if (failed > 0) {
    console.error('--- server logs (tail) ---\n' + logs.join('').split('\n').slice(-15).join('\n'));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
