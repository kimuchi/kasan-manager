#!/usr/bin/env node
// ポートしたコアロジックのスモークテスト
// 使い方: npm run test:smoke

import { strict as assert } from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateCondition,
  evaluateNode,
  evaluateRequirementLogic,
  buildFactsFromStaffData,
  buildFactsFromUserSummary,
  mergeRequirementFacts,
  mergeDemoTenantFacts,
  buildEvidenceChecklist,
} from '../src/services/dsl.js';
import { analyzeText, calculateConfidence, buildEvidence } from '../src/services/receipt-pdf.js';
import {
  judgeRequirement,
  judgeKasan,
  applyEvidenceToJudgements,
  run as runJudge,
  loadRegistry,
} from '../src/services/judge.js';
import { renderMarkdown } from '../src/services/markdown-report.js';
import { listServices, loadMaster, summarizeKasansForPrompt } from '../src/services/regulator.js';
import {
  toEngineInputs as toCposEngineInputs,
  loadAddonMapping,
  resolveKasanKey,
  inferServiceKey,
  normalizeCposAnalysisPayload,
} from '../src/services/cpos/transform.js';
import { validateAnalysisSource, validateBootstrap } from '../src/services/cpos/schemas.js';
import { CposApiError, CposNotConfiguredError } from '../src/services/cpos/errors.js';
import { defaultBaseUrl } from '../src/services/cpos/client.js';
import { readFile } from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`❌ ${name}`);
    console.error(`   ${err.message}`);
    if (err.stack) console.error(`   ${err.stack.split('\n').slice(1, 4).join('\n   ')}`);
    failed += 1;
  }
}

await test('DSL: evaluateCondition equality clear', () => {
  const r = evaluateCondition({ fact: 'a.b', op: '==', value: 1 }, { a: { b: 1 } });
  assert.equal(r.status, 'clear');
});

await test('DSL: evaluateCondition missing fact → blocked', () => {
  const r = evaluateCondition({ fact: 'a.b', op: '>=', value: 0.3 }, {});
  assert.equal(r.status, 'blocked_by_missing_evidence');
  assert.deepEqual(r.missing, ['a.b']);
});

await test('DSL: evaluateCondition not_clear', () => {
  const r = evaluateCondition({ fact: 'r', op: '>=', value: 0.3 }, { r: 0.2 });
  assert.equal(r.status, 'not_clear');
});

await test('DSL: any operator clear when one child clear', () => {
  const node = {
    operator: 'any',
    children: [
      { fact: 'a', op: '==', value: 1 },
      { fact: 'b', op: '==', value: 99 },
    ],
  };
  const r = evaluateNode(node, { a: 1, b: 0 });
  assert.equal(r.status, 'clear');
});

await test('DSL: all operator not_clear when one fails', () => {
  const node = {
    operator: 'all',
    children: [
      { fact: 'a', op: '==', value: 1 },
      { fact: 'b', op: '==', value: 99 },
    ],
  };
  const r = evaluateNode(node, { a: 1, b: 0 });
  assert.equal(r.status, 'not_clear');
});

await test('DSL: evaluateRequirementLogic with logic_status=draft → not_evaluated', () => {
  const r = evaluateRequirementLogic(
    { logic_status: 'draft', operator: 'any', children: [] },
    {},
    { source_status: 'checked' },
  );
  assert.equal(r.status, 'not_evaluated_logic_unchecked');
});

await test('DSL: evaluateRequirementLogic checked + clear path', () => {
  const r = evaluateRequirementLogic(
    {
      logic_status: 'checked',
      operator: 'all',
      children: [
        { fact: 'r.x', op: '>=', value: 0.3 },
        { fact: 'r.y', op: '==', value: 'clear' },
      ],
    },
    { r: { x: 0.5, y: 'clear' } },
    { source_status: 'checked' },
  );
  assert.equal(r.status, 'clear');
  assert.equal(r.satisfied_route.length, 2);
});

await test('DSL: buildFactsFromStaffData (tsusho_kaigo)', () => {
  const sd = {
    sample_policy: 'public_demo_synthetic',
    staff: [
      { staff_id: 'a', role: 'kango', qualifications: ['看護師'], fte: 1, active: true, is_joukin: true },
      { staff_id: 'b', role: 'kaigo', qualifications: ['介護福祉士'], fte: 1, active: true, is_joukin: true },
    ],
  };
  const facts = buildFactsFromStaffData(sd, 'tsusho_kaigo');
  assert.equal(facts['staff_summary.kango_count'], 1);
  assert.equal(facts['staff_summary.kaigo_count'], 1);
  assert.equal(facts['staff_summary.kango_kaigo_total_fte'], 2);
});

await test('DSL: mergeDemoTenantFacts injects dotted keys', () => {
  const merged = mergeDemoTenantFacts({}, { facts: { 'tenant_status.foo.status': 'clear' } });
  assert.equal(merged.tenant_status.foo.status, 'clear');
});

await test('DSL: buildEvidenceChecklist gathers missing evidence', () => {
  const dslResults = {
    k1: {
      status: 'blocked_by_missing_evidence',
      missing_evidence: ['tenant_status.kango_jikantai_haichi.status'],
    },
  };
  const judge = { k1: { name: '中重度者ケア体制加算' } };
  const list = buildEvidenceChecklist(dslResults, judge, { labels: {}, default_priority: '中' });
  assert.equal(list.length, 1);
  assert.equal(list[0].kasan_name, '中重度者ケア体制加算');
});

await test('Receipt PDF: analyzeText 通所介護 detects kasan', () => {
  const sample =
    '=== PAGE 1 ===\n通所介護Ⅰ23\n中重度者ケア体制加算\n個別機能訓練加算Ⅰ1\n=== PAGE 2 ===\n通所介護Ⅰ24\n入浴介助加算Ⅰ\n';
  const r = analyzeText(sample, 'tsusho_kaigo');
  assert.equal(r.total_users_estimated, 2);
  assert.ok(r.current_kasan_counts.chujudosha_care_taisei >= 1);
  assert.ok(r.current_kasan_counts.kobetsu_kinou_I_i >= 1);
  assert.ok(r.current_kasan_counts.nyuyoku_I >= 1);
  assert.ok(r.yokaigo_3plus_ratio != null);
});

await test('Receipt PDF: analyzeText 訪問介護 detects category', () => {
  const sample = '=== PAGE 1 ===\n身体1 早朝\n=== PAGE 2 ===\n生活2 夜間\n';
  const r = analyzeText(sample, 'houmon_kaigo');
  assert.equal(r.total_users_estimated, 2);
  assert.ok(r.service_category_counts.shintai_kaigo >= 1);
  assert.ok(r.service_category_counts.seikatsu_enjyo >= 1);
  assert.ok(r.time_band_counts.soucho >= 1);
});

await test('Receipt PDF: calculateConfidence', () => {
  const conf = calculateConfidence({
    total_users_estimated: 5,
    care_level_distribution: { 要介護3: 4, 要介護4: 1 },
    current_kasan_counts: { a: 1, b: 1, c: 1 },
  });
  assert.equal(conf, 'high');
});

await test('Receipt PDF: buildEvidence has correct shape', () => {
  const ev = buildEvidence(
    'DEMO-0004',
    'tsusho_kaigo',
    'tenant',
    {
      total_users_estimated: 1,
      care_level_distribution: { 要介護3: 1 },
      yokaigo_3plus_ratio: 1.0,
      current_kasan_counts: { nyuyoku_I: 1 },
      current_kasan_ratios: { nyuyoku_I: 1.0 },
      detected_service_codes: ['155301'],
      warnings: [],
    },
    'sample.pdf',
  );
  assert.equal(ev._meta.schema, 'evidence');
  assert.equal(ev.evidence[0].service_key, 'tsusho_kaigo');
  // coverage=1.0 (≥0.5) かつ kasan種別=1 件（<3）なので medium
  assert.equal(ev.evidence[0].extraction_confidence, 'medium');
});

await test('Judge: judgeRequirement (no key bound) → unknown', () => {
  const [status, reason] = judgeRequirement({ foo: 'bar' }, {});
  assert.equal(status, 'unknown');
  assert.equal(reason, 'no tenant_status_key bound');
});

await test('Judge: judgeRequirement reads tenant_status', () => {
  const [status] = judgeRequirement(
    { tenant_status_key: 'kango_jikantai_haichi' },
    { requirement_status: { kango_jikantai_haichi: { status: 'clear' } } },
  );
  assert.equal(status, 'clear');
});

await test('Judge: applyEvidenceToJudgements upgrades status', () => {
  const j = {
    nyuyoku_I: { algorithm_judgement: 'unknown', name: '入浴介助Ⅰ' },
    chujudosha_care_taisei: { algorithm_judgement: 'clear', name: '中重度' },
  };
  const evidence = { current_kasan_counts: { nyuyoku_I: 5, chujudosha_care_taisei: 1 } };
  const out = applyEvidenceToJudgements(j, evidence);
  assert.equal(out.nyuyoku_I.algorithm_judgement, 'claimed_but_requirements_unknown');
  assert.equal(out.chujudosha_care_taisei.algorithm_judgement, 'currently_claimed');
});

await test('Judge: run() で 通所介護 + DEMO-0004 が実行できる', async () => {
  const result = await runJudge({ service: 'tsusho_kaigo', office: 'DEMO-0004' });
  assert.equal(result.service, 'tsusho_kaigo');
  assert.ok(result.kasan_count > 0);
  assert.ok(result.summary);
});

await test('Judge: run() で 就労継続支援B型 (障害福祉) が実行できる', async () => {
  const result = await runJudge({ service: 'shugyo_keizoku_b' });
  assert.equal(result.service, 'shugyo_keizoku_b');
  assert.equal(result.service_def.domain, 'disability');
  assert.ok(result.kasan_count >= 6, `kasan_count=${result.kasan_count} (expected ≥6)`);
});

await test('Judge: DEMO-0004 with tenant_status / staff / user_summary 全反映', async () => {
  const tenant = path.join(PROJECT_ROOT, 'tenant_data/demo_status/DEMO-0004/tenant_status.json');
  const staff = path.join(PROJECT_ROOT, 'tenant_data/demo_staff/DEMO-0004/staff.json');
  const user = path.join(PROJECT_ROOT, 'tenant_data/demo_user_summary/DEMO-0004/user_summary.json');
  const result = await runJudge({
    service: 'tsusho_kaigo',
    office: 'DEMO-0004',
    demoTenantStatusPath: tenant,
    staffDataPath: staff,
    userSummaryPath: user,
  });
  assert.ok(result.staff_data_loaded);
  assert.ok(result.user_summary_loaded);
  assert.ok(result.demo_tenant_status_loaded);
  assert.ok(Object.keys(result.staff_summary_display).length > 0);
  assert.ok(Object.keys(result.user_summary_display).length > 0);
});

await test('Markdown: renderMarkdown が draft でも例外を出さない', async () => {
  const result = await runJudge({ service: 'shugyo_keizoku_b' });
  const md = renderMarkdown(result);
  assert.ok(md.includes('CareLinker 加算チェッカー 判定レポート'));
  assert.ok(md.includes('就労継続支援B型'));
});

await test('Markdown: 通所介護 + DEMO-0004 で一通りセクションが出る', async () => {
  const result = await runJudge({
    service: 'tsusho_kaigo',
    office: 'DEMO-0004',
  });
  const md = renderMarkdown(result);
  for (const expected of [
    '## 📌 結論サマリ',
    '## 1. 取得可能性が高い加算',
    '## 4. ❔ 情報不足の内訳',
    '## 9. 根拠マスタのバージョン',
  ]) {
    assert.ok(md.includes(expected), `missing section: ${expected}`);
  }
});

await test('Regulator: listServices returns 10 services', async () => {
  const services = await listServices();
  assert.ok(services.length >= 10);
  const keys = services.map((s) => s.service_key);
  for (const k of [
    'tsusho_kaigo', 'houmon_kaigo', 'kyotaku_shien', 'houmon_kango_kaigo',
    'shugyo_keizoku_a', 'shugyo_keizoku_b', 'kyotaku_kaigo_shogai',
  ]) {
    assert.ok(keys.includes(k), `missing service: ${k}`);
  }
});

await test('Regulator: 障害福祉のマスタが拡充されている', async () => {
  const m = await loadMaster('shugyo_keizoku_b');
  assert.ok(Object.keys(m.master.kasans).length >= 6);
  const summary = summarizeKasansForPrompt(m);
  assert.ok(summary.includes('目標工賃達成指導員配置加算'));
  assert.ok(summary.includes('ピアサポート'));
});

// =====================================================================
// CPOS 連携: フィクスチャベース（live API は呼ばない）
// =====================================================================
const FIXTURE_PATH = path.join(__dirname, '..', 'tests', 'fixtures', 'cpos_analysis_source.sample.json');

await test('CPOS: errors / config types を読み込める', () => {
  assert.ok(CposApiError);
  assert.ok(CposNotConfiguredError);
  // 全環境変数が空なら defaultBaseUrl は null
  const orig = { def: process.env.KASAN_DEFAULT_CPOS_BASE_URL, cpos: process.env.CPOS_BASE_URL };
  delete process.env.KASAN_DEFAULT_CPOS_BASE_URL;
  delete process.env.CPOS_BASE_URL;
  try {
    assert.equal(defaultBaseUrl(), null);
  } finally {
    if (orig.def) process.env.KASAN_DEFAULT_CPOS_BASE_URL = orig.def;
    if (orig.cpos) process.env.CPOS_BASE_URL = orig.cpos;
  }
});

await test('CPOS: validateBootstrap が必須フィールドを検証', () => {
  const ok = validateBootstrap({ connected: true, user: { userId: 'u' }, facilities: [] });
  assert.equal(ok.connected, true);
  assert.throws(() => validateBootstrap({}));
  assert.throws(() => validateBootstrap({ connected: true })); // user 欠落
});

await test('CPOS: validateAnalysisSource が schema/facility/serviceMonth を検証', async () => {
  const fix = JSON.parse(await readFile(FIXTURE_PATH, 'utf-8'));
  const ok = validateAnalysisSource(fix);
  assert.equal(ok.schemaVersion, '1.0');
  assert.throws(() => validateAnalysisSource({}));
});

await test('CPOS: inferServiceKey が serviceTypeCodes から推定', () => {
  assert.equal(inferServiceKey({ serviceTypeCodes: ['15'] }), 'tsusho_kaigo');
  assert.equal(inferServiceKey({ serviceTypeCodes: ['11'] }), 'houmon_kaigo');
  assert.equal(inferServiceKey({ serviceTypeCodes: ['43'] }), 'kyotaku_shien');
  assert.equal(inferServiceKey({ serviceTypeCodes: [] }), null);
});

await test('CPOS: addon mapping が 1 件以上ロードできる', async () => {
  const mapping = await loadAddonMapping();
  assert.ok(Array.isArray(mapping.mappings));
  assert.ok(mapping.mappings.length >= 5);
});

await test('CPOS: resolveKasanKey が cpos_addon_key で kasan_key を返す', async () => {
  const mapping = await loadAddonMapping();
  const r = resolveKasanKey(mapping, { serviceKey: 'tsusho_kaigo', addOnKey: 'nyuyoku_kaijo_ii' });
  assert.ok(r);
  assert.equal(r.kasanKey, 'nyuyoku_II');
  assert.equal(r.via, 'cpos_addon_key');
});

await test('CPOS: resolveKasanKey は未登録なら null を返す', async () => {
  const mapping = await loadAddonMapping();
  const r = resolveKasanKey(mapping, { serviceKey: 'tsusho_kaigo', addOnKey: 'totally_unknown_addon_xyz' });
  assert.equal(r, null);
});

await test('CPOS: toEngineInputs がフィクスチャを変換する', async () => {
  const fix = JSON.parse(await readFile(FIXTURE_PATH, 'utf-8'));
  const inputs = await toCposEngineInputs(fix);

  assert.equal(inputs.service_key, 'tsusho_kaigo');
  assert.ok(inputs.user_summary);
  assert.equal(inputs.user_summary.users_total, 42);
  assert.ok(inputs.user_summary.care_level_distribution.youkaigo_3 === 7);
  assert.equal(inputs.user_summary.care_level_3_or_higher_count, 13);

  assert.ok(inputs.staff_data.staff.length >= 14, `staff合成数=${inputs.staff_data.staff.length}`);
  assert.equal(inputs.staff_data.sample_policy, 'public_demo_synthetic');

  // claim_evidence の current_kasan_counts が CPOS addon → kasan_key にマップ済
  const counts = inputs.claim_evidence.evidence[0].current_kasan_counts;
  assert.equal(counts.nyuyoku_II, 28, `nyuyoku_II=${counts.nyuyoku_II}`);
  assert.equal(counts.kobetsu_kinou_I_i, 22);
  assert.equal(counts.eiyou_assessment, 12);

  // metadata
  assert.equal(inputs.metadata.source, 'cpos.analysis-source');
  assert.equal(inputs.metadata.facilityId, 'facility-a');
  assert.equal(inputs.metadata.dataCompleteness.provision, 'missing');
  assert.equal(inputs.metadata.hasExternalPtOtSt, true);
});

await test('CPOS: 変換結果で judge.run() が落ちずに通る', async () => {
  const fix = JSON.parse(await readFile(FIXTURE_PATH, 'utf-8'));
  const inputs = await toCposEngineInputs(fix);
  const { run } = await import('../src/services/judge.js');
  const result = await run({
    service: inputs.service_key,
    office: inputs.facility?.id || null,
    applyEvidence: true,
    inlineEvidence: inputs.claim_evidence,
  });
  assert.ok(result);
  assert.equal(result.service, 'tsusho_kaigo');
  // PDF 検出（CPOS 由来 evidence）が反映され、claimed_but_requirements_unknown が出る
  const claimedUnknown = (result.summary.claimed_but_requirements_unknown || []).length;
  assert.ok(claimedUnknown >= 1, `claimed_but_requirements_unknown=${claimedUnknown}`);
});

await test('CPOS: Markdown レポートに「CPOS データ整備状況」セクションが入る', async () => {
  const fix = JSON.parse(await readFile(FIXTURE_PATH, 'utf-8'));
  const inputs = await toCposEngineInputs(fix);
  const { run } = await import('../src/services/judge.js');
  const result = await run({
    service: inputs.service_key,
    office: inputs.facility?.id,
    applyEvidence: true,
    inlineEvidence: inputs.claim_evidence,
  });
  result.cpos_metadata = inputs.metadata;
  const md = renderMarkdown(result);
  assert.ok(md.includes('🔗 CPOS データ整備状況'), 'CPOS セクション欠落');
  assert.ok(md.includes('給付管理'), '給付管理項目欠落');
  assert.ok(md.includes('外部 PT/OT/ST'), '外部 PT/OT/ST 注記欠落');
});

// =====================================================================
// PAT 関連: Cookie 暗号化・CSRF・PAT セッション
// =====================================================================
process.env.KASAN_SESSION_SECRET = process.env.KASAN_SESSION_SECRET || 'a'.repeat(48);

await test('Cookie seal: 暗号化 → 復号 で payload が戻る', async () => {
  const { sealCookie, unsealCookie, isSessionSecretConfigured, tokenPreview, redactSecret } = await import(
    '../src/utils/cookie-seal.js'
  );
  assert.equal(isSessionSecretConfigured(), true);
  const sealed = sealCookie({ token: 'cpos_pat_abcdefghijklmnop', exp: Date.now() + 60_000 });
  const decoded = unsealCookie(sealed);
  assert.ok(decoded);
  assert.equal(decoded.token, 'cpos_pat_abcdefghijklmnop');
  // tokenPreview / redactSecret も
  assert.match(tokenPreview('cpos_pat_abcdefghij1234567890'), /^cpos_pat_.+\.\.\..+$/);
  assert.equal(redactSecret('cpos_pat_xxx_secret_long_value'), 'cpos_pat_xxx_s...REDACTED');
});

await test('Cookie seal: 改ざんされた値は復号失敗で null', async () => {
  const { sealCookie, unsealCookie } = await import('../src/utils/cookie-seal.js');
  const sealed = sealCookie({ token: 'cpos_pat_test', exp: Date.now() + 60_000 });
  const tampered = `A${sealed.slice(1)}`;
  const r = unsealCookie(tampered);
  assert.equal(r, null);
});

await test('Cookie seal: exp 切れの payload は null を返す', async () => {
  const { sealCookie, unsealCookie } = await import('../src/utils/cookie-seal.js');
  const sealed = sealCookie({ token: 'cpos_pat_test', exp: Date.now() - 1_000 });
  const r = unsealCookie(sealed);
  assert.equal(r, null);
});

await test('CPOS auth: buildSessionPayload と toPublicSessionView が PAT 平文を返さない', async () => {
  const { buildSessionPayload, toPublicSessionView } = await import('../src/services/cpos/auth.js');
  const payload = buildSessionPayload({
    cposBaseUrl: 'https://cpos.example.jp',
    token: 'cpos_pat_secretvalue1234567890',
    me: {
      user: { id: 'u1', email: 'a@b', name: 'A B' },
      token: { authMethod: 'personal_access_token', scopes: ['x'], allowedFacilityIds: ['f1'] },
    },
  });
  // payload には平文 token が含まれる（cookie 暗号化前なので）
  assert.equal(payload.token, 'cpos_pat_secretvalue1234567890');
  // public view には含まれない
  const view = toPublicSessionView(payload);
  assert.equal(view.token.tokenPreview, 'cpos_pat_secre...7890');
  assert.equal(JSON.stringify(view).includes('cpos_pat_secretvalue1234567890'), false);
});

await test('CPOS client: isAllowedBaseUrl が production で http を拒否', async () => {
  const { isAllowedBaseUrl } = await import('../src/services/cpos/client.js');
  // dev 環境（既定）
  assert.equal(isAllowedBaseUrl('https://cpos.example.jp'), true);
  assert.equal(isAllowedBaseUrl('http://localhost:8080'), true); // dev では OK
  // production 切替
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.equal(isAllowedBaseUrl('http://example.jp'), false);
    assert.equal(isAllowedBaseUrl('https://example.jp'), true);
  } finally {
    process.env.NODE_ENV = original || 'development';
  }
});

await test('CPOS client: allowlist 外を拒否', async () => {
  const { isAllowedBaseUrl } = await import('../src/services/cpos/client.js');
  process.env.KASAN_CPOS_ALLOWLIST = 'cpos.example.jp,trusted.example.jp';
  try {
    assert.equal(isAllowedBaseUrl('https://cpos.example.jp'), true);
    assert.equal(isAllowedBaseUrl('https://other.example.jp'), false);
  } finally {
    delete process.env.KASAN_CPOS_ALLOWLIST;
  }
});

// =====================================================================
// 改修指示書 §11.1: normalizeCposAnalysisPayload テスト
// =====================================================================
await test('normalize: analysis-source 形式はそのまま返す', () => {
  const p = { schemaVersion: '1.0', facility: { id: 'fa' }, serviceMonth: '2026-05' };
  assert.strictEqual(normalizeCposAnalysisPayload(p), p);
});

await test('normalize: platform export 形式 → analysis-source 互換', () => {
  const p = {
    formatVersion: '1',
    organizationId: 'default',
    facility: { id: 'fa', serviceTypeCodes: ['15'] },
    serviceMonth: '2026-05',
    serviceKey: 'tsusho_kaigo',
    claimSummary: { currentKasanCounts: { nyuyoku_1: 10 } },
    benefitManagementSummary: { managedUsers: 5 },
  };
  const r = normalizeCposAnalysisPayload(p);
  assert.equal(r.schemaVersion, '1.0');
  assert.deepEqual(r.claimSummary.currentAddOnCounts, { nyuyoku_1: 10 });
  assert.deepEqual(r.provisionSummary, { managedUsers: 5 });
});

await test('normalize: null/不正値はそのまま返す', () => {
  assert.equal(normalizeCposAnalysisPayload(null), null);
  assert.equal(normalizeCposAnalysisPayload('string'), 'string');
});

// =====================================================================
// §11.4: formatCposAnalyzeError のロジック検証（クライアント側関数を再現してテスト）
// =====================================================================
function formatCposAnalyzeErrorImpl(status, payload) {
  const code = payload?.error;
  if (status === 401 && code === 'not_connected') {
    return 'CPOS 接続情報が見つかりません。PAT を再入力して接続してください。';
  }
  if (code === 'cpos_upstream_error') {
    const upstream = payload.upstream_status_code;
    if (upstream === 401) {
      return 'CPOS が分析 API の PAT 認証を受け付けませんでした。\nPAT の期限切れ・失効、または CPOS 側の分析 API で Bearer 認証が通っていない可能性があります。';
    }
    if (upstream === 403) {
      return 'CPOS PAT の権限が不足しているか、この事業所へのアクセスが許可されていません。';
    }
    if (upstream === 404) {
      return 'CPOS の分析エンドポイントが見つかりません。';
    }
  }
  return null;
}

await test('formatCposAnalyzeError: not_connected', () => {
  const m = formatCposAnalyzeErrorImpl(401, { error: 'not_connected' });
  assert.match(m, /PAT を再入力/);
});

await test('formatCposAnalyzeError: cpos_upstream_error 401', () => {
  const m = formatCposAnalyzeErrorImpl(502, {
    error: 'cpos_upstream_error',
    upstream_status_code: 401,
  });
  assert.match(m, /分析 API の PAT 認証を受け付け/);
  assert.doesNotMatch(m, /セッションが切れ/);
});

await test('formatCposAnalyzeError: cpos_upstream_error 403', () => {
  const m = formatCposAnalyzeErrorImpl(502, {
    error: 'cpos_upstream_error',
    upstream_status_code: 403,
  });
  assert.match(m, /権限が不足/);
});

// =====================================================================
// §11.2 / §11.3: ライブラリ層の動作検証（fetch をモックして不要に触れず、CposApiError の
// statusCode/responseBody/responseHeaders/requestUrl が伝播することを確認）
// =====================================================================
await test('CposApiError: requestUrl / responseJson / responseHeaders を保持', async () => {
  const { CposApiError } = await import('../src/services/cpos/errors.js');
  const e = new CposApiError(401, '認証が必要です', {
    responseJson: { error: '認証が必要です' },
    responseHeaders: { 'content-type': 'application/json' },
    requestPath: '/api/kasan/v1/analysis-source',
    requestUrl: 'https://cpos.example.jp/api/kasan/v1/analysis-source?facilityId=fa',
  });
  assert.equal(e.statusCode, 401);
  assert.equal(e.requestPath, '/api/kasan/v1/analysis-source');
  assert.match(e.requestUrl, /facilityId=fa/);
  assert.deepEqual(e.responseHeaders, { 'content-type': 'application/json' });
  assert.equal(e.responseJson?.error, '認証が必要です');
});

// §11.4: cookie diagnose
await test('Cookie seal: unsealCookieDetailed が reason を返す', async () => {
  const { unsealCookieDetailed, sealCookie } = await import('../src/utils/cookie-seal.js');
  // missing
  assert.equal(unsealCookieDetailed(null).reason, 'missing_cookie');
  assert.equal(unsealCookieDetailed('').reason, 'missing_cookie');
  // bad base64 / too short → too_short か bad_base64url
  const bad = unsealCookieDetailed('xxx');
  assert.equal(bad.ok, false);
  assert.ok(['too_short', 'bad_base64url'].includes(bad.reason));
  // expired
  const sealed = sealCookie({ token: 'cpos_pat_expired', exp: Date.now() - 1000 });
  const r = unsealCookieDetailed(sealed);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'expired');
  assert.ok(r.expiredAt);
  // valid
  const ok = sealCookie({ token: 'cpos_pat_test', exp: Date.now() + 60_000 });
  const r2 = unsealCookieDetailed(ok);
  assert.equal(r2.ok, true);
  assert.equal(r2.payload.token, 'cpos_pat_test');
});

await test('readCposSessionDetailed: cookie 無し時は missing_cookie', async () => {
  const { readCposSessionDetailed } = await import('../src/services/cpos/auth.js');
  const fakeReq = { headers: {} };
  const r = readCposSessionDetailed(fakeReq);
  assert.equal(r.session, null);
  assert.equal(r.reason, 'missing_cookie');
});

// =====================================================================
// 改修指示書: P0/P1 追加項目
// =====================================================================

await test('Schema: validateAnalysisSource が schemaVersion 違反を検出', async () => {
  // 必須フィールド facility.id が無いケース
  assert.throws(() => validateAnalysisSource({ schemaVersion: '1.0', serviceMonth: '2026-04' }));
  // serviceMonth が YYYY-MM パターンに合わないケース
  assert.throws(() =>
    validateAnalysisSource({
      schemaVersion: '1.0',
      facility: { id: 'fa' },
      serviceMonth: '20260401',
    }),
  );
  // dataCompleteness 値が enum 外
  assert.throws(() =>
    validateAnalysisSource({
      schemaVersion: '1.0',
      facility: { id: 'fa' },
      serviceMonth: '2026-04',
      dataCompleteness: { facility: 'totally_unknown' },
    }),
  );
});

await test('Schema: deriveCompletenessWarnings が missing/partial を日本語化', async () => {
  const { deriveCompletenessWarnings } = await import('../src/services/cpos/schemas.js');
  const ws = deriveCompletenessWarnings({
    dataCompleteness: { facility: 'complete', users: 'partial', billing: 'missing' },
  });
  assert.equal(ws.length, 2);
  assert.ok(ws.some((w) => w.includes('利用者マスタ') && w.includes('一部のみ登録')));
  assert.ok(ws.some((w) => w.includes('請求明細') && w.includes('未登録')));
});

await test('Mapping: cpos_addon_mapping は 4 サービス × 主要加算をカバー', async () => {
  const mapping = await loadAddonMapping();
  const byService = {};
  for (const m of mapping.mappings) {
    byService[m.service_key] = (byService[m.service_key] || 0) + 1;
  }
  for (const k of ['tsusho_kaigo', 'houmon_kaigo', 'kyotaku_shien', 'houmon_kango_kaigo']) {
    assert.ok((byService[k] || 0) >= 5, `service_key=${k} のマッピング数=${byService[k] || 0}（5 以上を期待）`);
  }
});

await test('Judge: judgeKasan が per-kasan mapping meta を返す', async () => {
  const result = await runJudge({ service: 'tsusho_kaigo', office: 'DEMO-0004' });
  const judgements = result.judgements || {};
  const keys = Object.keys(judgements);
  assert.ok(keys.length > 0, 'judgements が空');
  let foundChecked = false;
  let foundUnverified = false;
  for (const k of keys) {
    const j = judgements[k];
    // すべての判定に source_status / service_code_mapping_status が必ず付与されている
    assert.ok(j.source_status, `${k}: source_status missing`);
    assert.ok(j.service_code_mapping_status, `${k}: service_code_mapping_status missing`);
    if (j.service_code_mapping_status === 'verified_against_official_master') foundChecked = true;
    if (j.service_code_mapping_status === 'pattern_based_unverified') foundUnverified = true;
  }
  // tsusho_kaigo マスタには両ステータスが混在しているはず（regulatory_master の検証）
  assert.ok(foundChecked || foundUnverified, '少なくとも 1 つは mapping ステータスを持つ');
});

// =====================================================================
// API contract: buildAnalysisEnvelope（指示書 §6 共通エンベロープ）
// =====================================================================
await test('Envelope: buildAnalysisEnvelope が必須キーを揃える', async () => {
  const { buildAnalysisEnvelope } = await import('../src/utils/analysis-envelope.js');
  const env = buildAnalysisEnvelope({ sourceType: 'manual_pdf' });
  assert.ok(env.analysis_id, 'analysis_id 必須');
  assert.match(env.analysis_id, /^[0-9a-f-]{36}$/i);
  assert.equal(env.source_type, 'manual_pdf');
  assert.equal(env.review_status, 'draft');
  assert.ok(Array.isArray(env.mapping_warnings));
});

await test('Envelope: extraWarnings + cposMetadata.warnings が重複排除される', async () => {
  const { buildAnalysisEnvelope } = await import('../src/utils/analysis-envelope.js');
  const env = buildAnalysisEnvelope({
    sourceType: 'cpos_analysis_source',
    cposMetadata: { warnings: ['A', 'B'], claimSummaryWarnings: ['B', 'C'] },
    extraWarnings: ['C', 'D'],
  });
  assert.deepEqual(env.mapping_warnings, ['A', 'B', 'C', 'D']);
});

console.log(`\n結果: ${passed} 件成功 / ${failed} 件失敗`);
if (failed > 0) process.exit(1);
