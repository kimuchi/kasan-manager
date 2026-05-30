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
import { classifyDocument } from '../public/local/classify.js';
import { scrubText, isPiiHeader, findPii, assertNoPii } from '../public/local/pii.js';
import { extractTabular, parseCareLevel, parseProfession } from '../public/local/tabular.js';
import {
  detectServiceKeyFromText,
  aggregateReceiptTexts,
  mergeUserSummaries,
  mergeStaffSummaries,
} from '../public/local/aggregate.js';
import { buildLocalBundle } from '../public/local/bundle.js';
import { readFile } from 'node:fs/promises';
// --- Pro mode: 認証 / 永続化 / 匿名化 / プロフィール / ドラフト ---
import { _resetLocalStoreCache, isLocalStoreEnabled } from '../src/services/local-store.js';
import {
  anonymizeStaffRoster,
  summarizeForStorage,
  scrubString,
  anonymizeAnalysisResult,
  assertStorageSafe,
} from '../src/services/anonymize.js';
import {
  hashPassword,
  verifyPassword,
  validateEmail,
  validatePassword,
  registerLocalUser,
  loginLocalUser,
  buildSessionPayload,
  readSession,
  isLocalAuthEnabled,
} from '../src/services/auth-local.js';
import {
  ensureUser,
  getUserSummary,
  findUserByEmail,
  listUsers,
  adminSetPlan,
  getUserRecord,
} from '../src/services/users.js';
import { issueAccessCode, redeemAccessCode } from '../src/services/access-codes.js';
import {
  saveFacility,
  listFacilities,
  getFacility,
  deleteFacility,
  saveStaffRoster,
  getStaffRoster,
} from '../src/services/profiles.js';
import { createDraft, mergeIntoDraft, getDraft, draftToBundle } from '../src/services/drafts.js';
import {
  persistAnalysisIfPaid,
  listAnalysisJobsForUser,
  getAnalysisJob,
  loadAnalysisArtifact,
} from '../src/services/persistence.js';
import { getAdminAggregateStats, getUserUsageDetail } from '../src/services/admin-stats.js';
// --- CPOS app-data store (新アーキテクチャ: 全保存を CPOS に集約) ---
import { FakeCpos } from '../tests/helpers/fake-cpos.js';
import {
  _setAppCposClient as _setCposStoreClient,
  _resetAppCposClient as _resetCposStoreClient,
  isAppCposConfigured,
} from '../src/services/cpos/app-context.js';
import {
  saveAnalysis,
  listAnalyses as listCposAnalyses,
  getAnalysis as getCposAnalysis,
  aggregateAnalyses,
  recordReview,
  listReviews,
  saveFacilityProfile as cposSaveFacility,
  listFacilityProfiles as cposListFacilities,
  getFacilityProfile as cposGetFacility,
  deleteFacilityProfile as cposDeleteFacility,
  saveStaffRoster as cposSaveRoster,
  listStaffRosters as cposListRosters,
  createDraft as cposCreateDraft,
  updateDraft as cposUpdateDraft,
  getDraft as cposGetDraft,
  listDrafts as cposListDrafts,
  getEntitlement,
  setEntitlement,
  listOrganizationUsers,
  getUsageSummary,
} from '../src/services/cpos/store.js';

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

// =====================================================================
// 認証・プラン（Firebase Admin 無し環境で fallback 動作を検証）
// =====================================================================
await test('secrets: hydrateSecretsFromManager が Secret Manager 無しでも fallback', async () => {
  const { hydrateSecretsFromManager } = await import('../src/services/secrets.js');
  const orig = process.env.KASAN_SESSION_SECRET;
  // Secret Manager 名は設定しない（=直接 env を使う）
  delete process.env.KASAN_SECRET_SESSION_NAME;
  process.env.KASAN_SESSION_SECRET = 'a'.repeat(48);
  const r = await hydrateSecretsFromManager();
  assert.ok(typeof r.hydratedCount === 'number');
  // KASAN_SESSION_SECRET は既に値があったので上書きされていない
  assert.equal(process.env.KASAN_SESSION_SECRET, 'a'.repeat(48));
  process.env.KASAN_SESSION_SECRET = orig || '';
});

await test('users: isAdminEmail は KASAN_ADMIN_EMAILS で判定', async () => {
  const { isAdminEmail } = await import('../src/services/users.js');
  const orig = process.env.KASAN_ADMIN_EMAILS;
  process.env.KASAN_ADMIN_EMAILS = 'admin@example.com, OWNER@example.com';
  try {
    assert.equal(isAdminEmail('admin@example.com'), true);
    assert.equal(isAdminEmail('OWNER@example.com'), true);
    assert.equal(isAdminEmail('owner@example.com'), true); // 小文字化マッチ
    assert.equal(isAdminEmail('other@example.com'), false);
    assert.equal(isAdminEmail(null), false);
    assert.equal(isAdminEmail(''), false);
  } finally {
    if (orig) process.env.KASAN_ADMIN_EMAILS = orig;
    else delete process.env.KASAN_ADMIN_EMAILS;
  }
});

await test('firebase-admin: 未設定環境では初期化失敗を quiet に扱う', async () => {
  const { initFirebase, isFirebaseInitialized } = await import('../src/services/firebase-admin.js');
  // initFirebase は ADC が無い環境では false を返すか、何らかの理由で true 返すこともある
  const r = initFirebase();
  // どちらでも例外を投げないことが重要
  assert.equal(typeof r, 'boolean');
  assert.equal(typeof isFirebaseInitialized(), 'boolean');
});

await test('auth middleware: Bearer 無しなら req.user を populate しない', async () => {
  const { authMiddleware } = await import('../src/middleware/auth.js');
  let nextCalled = false;
  const req = { headers: {} };
  await new Promise((resolve) => {
    authMiddleware(req, {}, () => {
      nextCalled = true;
      resolve();
    });
  });
  assert.equal(nextCalled, true);
  assert.equal(req.user, undefined);
});

await test('auth middleware: requireAuth は user 無しで 401', async () => {
  const { requireAuth } = await import('../src/middleware/auth.js');
  let status = null;
  let payload = null;
  const req = {};
  const res = {
    status(c) { status = c; return this; },
    json(p) { payload = p; return this; },
  };
  requireAuth(req, res, () => {});
  assert.equal(status, 401);
  assert.equal(payload?.error, 'auth_required');
});

await test('auth middleware: requirePaid は free user で 402', async () => {
  const { requirePaid } = await import('../src/middleware/auth.js');
  let status = null;
  let payload = null;
  const req = { user: { uid: 'u', planTier: 'free' } };
  const res = {
    status(c) { status = c; return this; },
    json(p) { payload = p; return this; },
  };
  requirePaid(req, res, () => {});
  assert.equal(status, 402);
  assert.equal(payload?.error, 'paid_required');
});

await test('auth middleware: requireAdmin は非 admin で 403', async () => {
  const { requireAdmin } = await import('../src/middleware/auth.js');
  let status = null;
  const req = { user: { uid: 'u', isAdmin: false } };
  const res = {
    status(c) { status = c; return this; },
    json() { return this; },
  };
  requireAdmin(req, res, () => {});
  assert.equal(status, 403);
});

// =====================================================================
// Reviewer 集約ロジック
// =====================================================================
await test('Reviewer: aggregateReviewStatus 全 approved → approved', async () => {
  const { aggregateReviewStatus } = await import('../src/services/persistence.js');
  assert.equal(
    aggregateReviewStatus({
      a: { decision: 'approved' },
      b: { decision: 'approved' },
    }),
    'approved',
  );
});

await test('Reviewer: aggregateReviewStatus 1 件でも returned → returned', async () => {
  const { aggregateReviewStatus } = await import('../src/services/persistence.js');
  assert.equal(
    aggregateReviewStatus({
      a: { decision: 'approved' },
      b: { decision: 'returned' },
      c: { decision: 'awaiting_review' },
    }),
    'returned',
  );
});

await test('Reviewer: aggregateReviewStatus 一部のみ approved + 残 awaiting → awaiting_review', async () => {
  const { aggregateReviewStatus } = await import('../src/services/persistence.js');
  assert.equal(
    aggregateReviewStatus({
      a: { decision: 'approved' },
      b: { decision: 'awaiting_review' },
    }),
    'awaiting_review',
  );
});

await test('Reviewer: aggregateReviewStatus 空 → draft', async () => {
  const { aggregateReviewStatus } = await import('../src/services/persistence.js');
  assert.equal(aggregateReviewStatus({}), 'draft');
  assert.equal(aggregateReviewStatus(null), 'draft');
});

// =====================================================================
// ポートフォリオ最適化 PoC
// =====================================================================
await test('Portfolio: 通所介護 DEMO-0004 から候補が抽出される', async () => {
  const { optimizePortfolio } = await import('../src/services/portfolio.js');
  const r = await runJudge({ service: 'tsusho_kaigo', office: 'DEMO-0004' });
  r.user_summary_display = { users_total: 40 };
  const p = optimizePortfolio({ judgeResult: r });
  assert.ok(p.recommendations.length > 0, '推奨が 1 件以上');
  // 上位は priority_score 降順
  for (let i = 0; i < p.recommendations.length - 1; i += 1) {
    assert.ok(
      (p.recommendations[i].priority_score || 0) >= (p.recommendations[i + 1].priority_score || 0),
      'priority_score が降順',
    );
  }
  // 各候補は必須キーを持つ
  for (const rec of p.recommendations) {
    assert.ok(rec.kasan_key && rec.kasan_name && rec.algorithm_judgement);
    assert.ok(Array.isArray(rec.action_items));
  }
  assert.ok(p.total_potential_yen_per_month >= 0);
  // region_grade 未指定 → 'other' に正規化されて 10.00
  assert.equal(p.assumptions.yen_per_unit, 10.0);
  assert.equal(p.assumptions.region_grade, 'other');
});

await test('Portfolio: judgements が空ならゼロ件', async () => {
  const { optimizePortfolio } = await import('../src/services/portfolio.js');
  const p = optimizePortfolio({ judgeResult: { judgements: {} } });
  assert.equal(p.recommendation_count, 0);
  assert.equal(p.total_potential_yen_per_month, 0);
});

await test('Portfolio: clear / currently_claimed / not_applicable は候補から除外', async () => {
  const { optimizePortfolio } = await import('../src/services/portfolio.js');
  const r = {
    service: 'tsusho_kaigo',
    judgements: {
      a: { algorithm_judgement: 'clear', name: 'A' },
      b: { algorithm_judgement: 'currently_claimed', name: 'B' },
      c: { algorithm_judgement: 'not_applicable', name: 'C', applicability: 'not_applicable' },
      d: { algorithm_judgement: 'waiting', name: 'D' },
    },
    evidence_checklist: [],
    user_summary_display: { users_total: 30 },
  };
  const p = optimizePortfolio({ judgeResult: r });
  assert.equal(p.recommendation_count, 1);
  assert.equal(p.recommendations[0].kasan_key, 'd');
});

// =====================================================================
// 地域単価（級地）
// =====================================================================
await test('Regional pricing: yenPerUnit が級地 × サービスで正しく計算される', async () => {
  const { yenPerUnit, normalizeGrade } = await import('../src/services/regional-pricing.js');
  // tsusho_kaigo (人件費 45%)
  assert.equal(yenPerUnit('tsusho_kaigo', '1'), 10.9); // 10 × (1 + 0.20 × 0.45) = 10.9
  assert.equal(yenPerUnit('tsusho_kaigo', '6'), 10.27); // 10 × (1 + 0.06 × 0.45) = 10.27
  assert.equal(yenPerUnit('tsusho_kaigo', 'other'), 10.0);
  // houmon_kaigo (人件費 70%)
  assert.equal(yenPerUnit('houmon_kaigo', '1'), 11.4); // 10 × (1 + 0.20 × 0.70) = 11.4
  // 未知サービス → _default (45%)
  assert.equal(yenPerUnit('unknown_service', '1'), 10.9);
  // 級地正規化
  assert.equal(normalizeGrade('1'), '1');
  assert.equal(normalizeGrade('その他'), 'other');
  assert.equal(normalizeGrade('1級地'), '1');
  assert.equal(normalizeGrade(null), 'other');
  assert.equal(normalizeGrade('9'), 'other');
});

await test('Regional pricing: listGrades が 8 件返す', async () => {
  const { listGrades } = await import('../src/services/regional-pricing.js');
  const grades = listGrades();
  assert.equal(grades.length, 8);
  const labels = grades.map((g) => g.grade);
  for (const k of ['1', '2', '3', '4', '5', '6', '7', 'other']) assert.ok(labels.includes(k));
});

// =====================================================================
// 算定対象者フィルタ
// =====================================================================
await test('Target user filter: care_level_3_or_higher_count を直接使う', async () => {
  const { evalTargetUserCount } = await import('../src/services/target-user-filter.js');
  const us = { users_total: 40, care_level_3_or_higher_count: 27 };
  const r = evalTargetUserCount('chujudosha_care_taisei', us);
  // chujudosha_care_taisei は predicate=all なので users_total
  assert.equal(r.count, 40);
  assert.equal(r.source, 'all');
});

await test('Target user filter: dementia_min:IIIa が IIIa+IIIb+IV+M を合計する', async () => {
  const { evalTargetUserCount } = await import('../src/services/target-user-filter.js');
  const us = {
    users_total: 40,
    dementia_care_level_distribution: { I: 5, IIa: 4, IIb: 5, IIIa: 6, IIIb: 5, IV: 3, M: 0 },
  };
  const r = evalTargetUserCount('ninchi_kasan', us);
  assert.equal(r.count, 14); // 6 + 5 + 3 + 0
  assert.equal(r.source, 'dementia');
});

await test('Target user filter: estimated_ratio が users_total に乗算', async () => {
  const { evalTargetUserCount } = await import('../src/services/target-user-filter.js');
  const us = { users_total: 40 };
  const r = evalTargetUserCount('nyuyoku_I', us); // estimated_ratio:0.85
  assert.equal(r.count, 34); // 40 × 0.85
  assert.equal(r.source, 'estimated');
});

await test('Target user filter: 未定義 kasan は users_total へフォールバック', async () => {
  const { evalTargetUserCount } = await import('../src/services/target-user-filter.js');
  const us = { users_total: 25 };
  const r = evalTargetUserCount('unknown_kasan_key_xyz', us);
  assert.equal(r.count, 25);
  assert.equal(r.source, 'all');
});

await test('Target user filter: user_summary 無し → 0', async () => {
  const { evalTargetUserCount } = await import('../src/services/target-user-filter.js');
  const r = evalTargetUserCount('chujudosha_care_taisei', {});
  assert.equal(r.count, 0);
  assert.equal(r.source, 'none');
});

// =====================================================================
// 連動加算（処遇改善）ヒント
// =====================================================================
await test('Interaction hints: 処遇改善加算が currently_claimed なら chained_uplift を返す', async () => {
  const { buildInteractionHint, aggregateMultiplicativeBonus } = await import(
    '../src/services/interaction-hints.js'
  );
  const judgeResult = {
    judgements: {
      shoguu_kaizen_I: { algorithm_judgement: 'currently_claimed', name: '処遇改善加算Ⅰ' },
      base_up_shien: { algorithm_judgement: 'clear', name: 'ベースアップ等支援' },
    },
  };
  const agg = aggregateMultiplicativeBonus(judgeResult);
  assert.ok(agg.rate > 0.15); // 0.137 + 0.022 = ~0.159
  const hint = buildInteractionHint({
    kasanKey: 'kobetsu_kinou_I_i',
    baseRevenuePerMonth: 100000,
    judgeResult,
  });
  assert.equal(hint.type, 'chained_uplift');
  assert.ok(hint.bonus_yen_per_month > 0);
});

await test('Interaction hints: 候補自身が乗算系なら multiplicative_self', async () => {
  const { buildInteractionHint } = await import('../src/services/interaction-hints.js');
  const hint = buildInteractionHint({
    kasanKey: 'shoguu_kaizen_I',
    baseRevenuePerMonth: 100000,
    judgeResult: { judgements: {} },
  });
  assert.equal(hint.type, 'multiplicative_self');
});

// =====================================================================
// レビュー学習
// =====================================================================
await test('Review learning: describeTendency 各分岐', async () => {
  const mod = await import('../src/services/review-learning.js');
  // 5 件以上 approved のみ → consistently_approved。少なくとも内部 describeTendency
  // は export していないので、summarize の挙動を通して確認する代わりに
  // formatTendencyLabel が known/unknown を扱えることを確認
  assert.equal(mod.formatTendencyLabel('consistently_approved'), '通常承認');
  assert.equal(mod.formatTendencyLabel('consistently_returned'), '通常差戻し');
  assert.equal(mod.formatTendencyLabel('usually_approved'), '承認傾向');
  assert.equal(mod.formatTendencyLabel('mixed'), '判断が分かれる');
  assert.equal(mod.formatTendencyLabel('something_unknown'), '');
});

await test('Review learning: attachLearningHints が recommendations にヒントを付与', async () => {
  const { attachLearningHints } = await import('../src/services/review-learning.js');
  const portfolio = {
    recommendations: [
      { kasan_key: 'a', kasan_name: 'A' },
      { kasan_key: 'b', kasan_name: 'B' },
    ],
  };
  const learning = {
    per_kasan: {
      a: { approved: 5, returned: 0, tendency: 'consistently_approved' },
    },
  };
  const out = attachLearningHints(portfolio, learning);
  assert.equal(out.recommendations[0].learning_hint.approved, 5);
  assert.equal(out.recommendations[0].learning_tendency_label, '通常承認');
  assert.equal(out.recommendations[1].learning_hint, undefined);
});

// =====================================================================
// portfolio 統合 (region_grade + target_user + interaction)
// =====================================================================
await test('Portfolio: region_grade で yen_per_unit が変わり収益が増える', async () => {
  const { optimizePortfolio } = await import('../src/services/portfolio.js');
  const r = await runJudge({ service: 'tsusho_kaigo', office: 'DEMO-0004' });
  r.user_summary_display = { users_total: 40, care_level_3_or_higher_count: 27 };
  const pOther = optimizePortfolio({ judgeResult: r, regionGrade: 'other' });
  const p1 = optimizePortfolio({ judgeResult: r, regionGrade: '1' });
  assert.equal(pOther.yen_per_unit, 10.0);
  assert.equal(p1.yen_per_unit, 10.9);
  assert.ok(p1.total_potential_yen_per_month > pOther.total_potential_yen_per_month);
});

await test('Portfolio: 推奨に target_user_count と target_user_source が乗る', async () => {
  const { optimizePortfolio } = await import('../src/services/portfolio.js');
  const r = await runJudge({ service: 'tsusho_kaigo', office: 'DEMO-0004' });
  r.user_summary_display = {
    users_total: 40,
    care_level_3_or_higher_count: 27,
    dementia_care_level_distribution: { I: 5, IIa: 4, IIb: 5, IIIa: 6, IIIb: 5, IV: 3, M: 0 },
  };
  const p = optimizePortfolio({ judgeResult: r });
  const ninchi = p.recommendations.find((x) => x.kasan_key === 'ninchi_kasan');
  if (ninchi) {
    assert.equal(ninchi.target_user_count, 14);
    assert.equal(ninchi.target_user_source, 'dementia');
  }
});

// =====================================================================
// マスタ整合性レビュー（alpha.5.9〜.5.13 packets）
// =====================================================================
await test('MasterReview: listPackets が 6 個のパケットを返す', async () => {
  const { listPackets } = await import('../src/services/master-review.js');
  const packets = listPackets();
  assert.ok(packets.length >= 6, `expected >= 6 packets, got ${packets.length}`);
  const dirs = packets.map((p) => p.dir);
  assert.ok(dirs.includes('alpha5_9_master_review_packet'));
  assert.ok(dirs.includes('alpha5_13_review_workload_reducer'));
});

await test('MasterReview: getPriorityMatrix が 38 件返す', async () => {
  const { getPriorityMatrix } = await import('../src/services/master-review.js');
  const rows = getPriorityMatrix();
  assert.equal(rows.length, 38, `expected 38 rows, got ${rows.length}`);
  for (const r of rows) {
    assert.ok(r.service, 'service set');
    assert.ok(r.kasan_key, 'kasan_key set');
    assert.ok(r.review_bucket, 'review_bucket set');
    assert.ok(['yes', 'no'].includes(r.can_be_first_batch));
  }
});

await test('MasterReview: getFirstReviewBatch が 8 件返す', async () => {
  const { getFirstReviewBatch } = await import('../src/services/master-review.js');
  const rows = getFirstReviewBatch();
  assert.equal(rows.length, 8, `expected 8 first-batch rows, got ${rows.length}`);
  for (const r of rows) {
    assert.equal(r.review_bucket, 'needs_master_review');
    assert.ok(r.recommended_initial_decision);
  }
});

await test('MasterReview: getRecommendedDecisionFor で個別加算を取得', async () => {
  const { getRecommendedDecisionFor } = await import('../src/services/master-review.js');
  const r = getRecommendedDecisionFor('tsusho_kaigo', 'chujudosha_care_taisei');
  assert.ok(r, 'tsusho_kaigo chujudosha_care_taisei should exist');
  assert.equal(r.recommended_initial_decision, 'add_receipt_alias');
});

await test('MasterReview: getMasterAuditFor が三層モデルを返す', async () => {
  const { getMasterAuditFor } = await import('../src/services/master-review.js');
  const audit = getMasterAuditFor('tsusho_kaigo', 'chujudosha_care_taisei');
  assert.ok(audit);
  assert.equal(audit.overall_mapping_status, 'needs_review');
  assert.ok(audit.service_code_audit);
  assert.ok(audit.service_code_audit.alpha_5_8_three_layer_model);
});

await test('MasterReview: summarizePerServiceWorkload', async () => {
  const { summarizePerServiceWorkload } = await import('../src/services/master-review.js');
  const summary = summarizePerServiceWorkload();
  assert.ok(summary.length >= 4, 'all four services represented');
  // alpha5_13 manifest 上、tsusho_kaigo に 4 件初回バッチ
  const tsusho = summary.find((s) => s.service === 'tsusho_kaigo');
  assert.ok(tsusho);
  assert.equal(tsusho.first_batch, 4);
});

await test('MasterReview: getCioDecisionBrief / safe-defaults Markdown が取得できる', async () => {
  const m = await import('../src/services/master-review.js');
  const cio = m.getCioDecisionBrief();
  assert.ok(cio && cio.length > 200);
  const safe = m.getSafeDefaultDecisions();
  assert.ok(safe && safe.length > 200);
});

// =====================================================================
// 強化された master JSON（alpha.5.8 三層モデル）
// =====================================================================
await test('Master JSON: 通所介護に service_code_audit / overall_mapping_status が入っている', async () => {
  const { loadMaster } = await import('../src/services/regulator.js');
  const m = await loadMaster('tsusho_kaigo');
  const kasan = m?.master?.kasans?.chujudosha_care_taisei || m?.kasans?.chujudosha_care_taisei;
  assert.ok(kasan, 'chujudosha_care_taisei should exist');
  assert.ok(kasan.service_code_audit, 'service_code_audit set');
  assert.ok(kasan.overall_mapping_status, 'overall_mapping_status set');
  assert.ok(
    kasan.service_code_audit.alpha_5_8_three_layer_model,
    'three layer model exists',
  );
});

// =====================================================================
// ローカル前処理エンジン（ブラウザ完結・WASM）の純ロジック
// =====================================================================
await test('Local/classify: ファイル名 + 本文で書類種別を判定', () => {
  assert.equal(
    classifyDocument({ fileName: '介護給付費明細書_202604.pdf', text: 'サービスコード 単位数 請求明細' }).type,
    'receipt',
  );
  assert.equal(
    classifyDocument({ fileName: '利用者一覧.xlsx', headers: ['利用者番号', '氏名', '要介護度'] }).type,
    'user_roster',
  );
  assert.equal(
    classifyDocument({ fileName: '勤務形態一覧表.xlsx', headers: ['職員名', '保有資格', '常勤換算数'] }).type,
    'staff_roster',
  );
  assert.equal(
    classifyDocument({ fileName: '体制等状況一覧.pdf', text: '介護給付費算定に係る体制 届出受理' }).type,
    'tenant_status',
  );
  assert.equal(classifyDocument({ fileName: 'メモ.txt', text: 'ただのメモ' }).type, 'unknown');
});

await test('Local/pii: scrubText が被保険者番号・電話・メールを伏字化', () => {
  const scrubbed = scrubText('被保険者番号 1234567890 電話 03-1234-5678 mail a@b.co');
  assert.ok(!/1234567890/.test(scrubbed), '被保険者番号が残っている');
  assert.ok(!/03-1234-5678/.test(scrubbed), '電話が残っている');
  assert.ok(!/a@b\.co/.test(scrubbed), 'メールが残っている');
});

await test('Local/pii: isPiiHeader が氏名・被保険者番号列を判定', () => {
  assert.equal(isPiiHeader('氏名'), true);
  assert.equal(isPiiHeader('被保険者番号'), true);
  assert.equal(isPiiHeader('フリガナ'), true);
  assert.equal(isPiiHeader('要介護度'), false);
  assert.equal(isPiiHeader('保有資格'), false);
});

await test('Local/pii: assertNoPii は ISO日付/サービスコードで誤検知しない', () => {
  const clean = { serviceMonth: '2026-04', extracted_at: '2026-05-29T12:34:56', codes: ['155302', '155051'] };
  assert.equal(assertNoPii(clean), true);
  assert.throws(() => assertNoPii({ note: '連絡先 test@example.com' }));
  assert.throws(() => assertNoPii({ leak: '被保険者 1234567890' }));
});

await test('Local/tabular: user_roster は PII 列を破棄し要介護度を集計', () => {
  const out = extractTabular({
    type: 'user_roster',
    header: ['利用者番号', '氏名', '要介護度', '認知症高齢者の日常生活自立度'],
    rows: [
      ['0000000001', '介護 太郎', '要介護3', 'IIa'],
      ['0000000002', '介護 花子', '要介護4', 'IIIa'],
      ['0000000003', '支援 一郎', '要支援1', 'I'],
    ],
  });
  assert.equal(out.userSummary.activeUserCount, 3);
  assert.equal(out.userSummary.careLevelDistribution.youkaigo_3, 1);
  assert.equal(out.userSummary.careLevelDistribution.youkaigo_4, 1);
  assert.equal(out.userSummary.careLevelDistribution.youshien_1, 1);
  assert.equal(out.userSummary.care3PlusCount, 2);
  // 氏名・被保険者番号列は破棄され、出力に個人値が一切入らない
  const json = JSON.stringify(out);
  assert.ok(!json.includes('太郎') && !json.includes('花子'), '氏名が混入');
  assert.ok(!json.includes('0000000001'), '被保険者番号が混入');
  const piiDropped = out.droppedColumns.filter((c) => c.pii).map((c) => c.name);
  assert.ok(piiDropped.includes('氏名'), '氏名がPII破棄列にない');
});

await test('Local/tabular: staff_roster は職種別人数と常勤換算を集計（氏名は破棄）', () => {
  const out = extractTabular({
    type: 'staff_roster',
    header: ['職員名', '保有資格', '常勤換算数'],
    rows: [
      ['山田', '看護師', '1.0'],
      ['佐藤', '介護福祉士', '0.8'],
      ['鈴木', '介護福祉士', '1.0'],
    ],
  });
  assert.equal(out.staffSummary.qualifiedPersonCountByProfession.nurse, 1);
  assert.equal(out.staffSummary.qualifiedPersonCountByProfession.care_worker, 2);
  assert.equal(out.staffSummary.fteByProfession.care_worker, 1.8);
  assert.ok(!JSON.stringify(out).includes('山田'), '氏名が混入');
});

await test('Local/tabular: parseCareLevel / parseProfession の基本', () => {
  assert.equal(parseCareLevel('要介護５'), 'youkaigo_5');
  assert.equal(parseCareLevel('要支援2'), 'youshien_2');
  assert.equal(parseCareLevel('自立'), null);
  assert.equal(parseProfession('主任介護支援専門員'), 'chief_care_manager');
  assert.equal(parseProfession('准看護師'), 'assistant_nurse');
});

await test('Local/aggregate: detectServiceKeyFromText が通所介護を推定', () => {
  const text = '通所介護Ⅰ31 入浴介助加算Ⅱ 155302 個別機能訓練加算Ⅰ1 155051';
  assert.equal(detectServiceKeyFromText(text), 'tsusho_kaigo');
});

await test('Local/aggregate: aggregateReceiptTexts が kasan 件数つき evidence を作る', () => {
  const pageA = '通所介護Ⅰ31 入浴介助加算Ⅱ 155302';
  const pageB = '通所介護Ⅰ41 入浴介助加算Ⅱ 155302 個別機能訓練加算Ⅰ1 155051';
  const { extracted, evidence } = aggregateReceiptTexts([pageA, pageB], {
    serviceKey: 'tsusho_kaigo',
    office: 'local',
  });
  assert.equal(extracted.current_kasan_counts.nyuyoku_II, 2);
  assert.equal(extracted.current_kasan_counts.kobetsu_kinou_I_i, 1);
  assert.equal(evidence.evidence[0].service_key, 'tsusho_kaigo');
  assert.equal(evidence.evidence[0].source_type, 'receipt_pdf');
});

await test('Local/aggregate: merge ヘルパが複数集計を加算', () => {
  const u = mergeUserSummaries([
    { activeUserCount: 2, careLevelDistribution: { youkaigo_3: 1, youkaigo_2: 1 } },
    { activeUserCount: 1, careLevelDistribution: { youkaigo_3: 1 } },
  ]);
  assert.equal(u.activeUserCount, 3);
  assert.equal(u.careLevelDistribution.youkaigo_3, 2);
  assert.equal(u.care3PlusCount, 2);
  const s = mergeStaffSummaries([
    { qualifiedPersonCountByProfession: { nurse: 1 }, fteByProfession: { nurse: 1 } },
    { qualifiedPersonCountByProfession: { nurse: 1, care_worker: 2 }, fteByProfession: { nurse: 0.5 } },
  ]);
  assert.equal(s.qualifiedPersonCountByProfession.nurse, 2);
  assert.equal(s.fteByProfession.nurse, 1.5);
});

await test('Local/bundle: buildLocalBundle が analysis_source 互換で validateAnalysisSource を通る', () => {
  const { evidence } = aggregateReceiptTexts(['通所介護Ⅰ31 入浴介助加算Ⅱ 155302'], {
    serviceKey: 'tsusho_kaigo',
    office: 'local',
  });
  const bundle = buildLocalBundle({
    serviceKey: 'tsusho_kaigo',
    serviceMonth: '2026-04',
    userSummary: {
      activeUserCount: 10,
      careLevelDistribution: { youkaigo_2: 4, youkaigo_3: 4, youkaigo_4: 2 },
      care3PlusCount: 6,
      care3PlusRatio: 0.6,
    },
    staffSummary: { qualifiedPersonCountByProfession: { care_worker: 5, nurse: 1 }, fteByProfession: {} },
    claimEvidence: evidence,
    dataCompleteness: { billing: 'partial', staffing: 'missing' },
    warnings: ['ローカル取込（集計値のみ）'],
    fileTypeCounts: { receipt: 1, user_roster: 1 },
  });
  const ok = validateAnalysisSource(bundle);
  assert.equal(ok.schemaVersion, '1.0');
  assert.equal(bundle.privacy.includePii, false);
  assert.equal(bundle.facility.serviceTypeCodes[0], '15');
  assert.ok(bundle.claimEvidence.evidence.length >= 1);
});

await test('Local/bundle: buildLocalBundle は PII 混入時に throw', () => {
  assert.throws(() =>
    buildLocalBundle({
      serviceKey: 'tsusho_kaigo',
      serviceMonth: '2026-04',
      warnings: ['担当 090-1234-5678 まで'],
    }),
  );
});

await test('Local/e2e: ローカルバンドル → toEngineInputs → judge.run が通る', async () => {
  const { evidence } = aggregateReceiptTexts(
    ['通所介護Ⅰ31 入浴介助加算Ⅱ 155302 個別機能訓練加算Ⅰ1 155051'],
    { serviceKey: 'tsusho_kaigo', office: 'local' },
  );
  const bundle = buildLocalBundle({
    serviceKey: 'tsusho_kaigo',
    serviceMonth: '2026-04',
    userSummary: {
      activeUserCount: 10,
      careLevelDistribution: { youkaigo_2: 4, youkaigo_3: 4, youkaigo_4: 2 },
      care3PlusCount: 6,
      care3PlusRatio: 0.6,
    },
    claimEvidence: evidence,
  });
  const inputs = await toCposEngineInputs(bundle);
  assert.equal(inputs.service_key, 'tsusho_kaigo');
  assert.equal(inputs.user_summary.care_level_3_or_higher_count, 6);
  const result = await runJudge({
    service: inputs.service_key,
    office: inputs.facility?.id || 'local',
    applyEvidence: true,
    inlineEvidence: bundle.claimEvidence,
  });
  assert.equal(result.service, 'tsusho_kaigo');
  const claimedUnknown = (result.summary.claimed_but_requirements_unknown || []).length;
  assert.ok(claimedUnknown >= 1, `claimed_but_requirements_unknown=${claimedUnknown}`);
});

// =====================================================================
// 総合事業（sogoubu_tsusho）+ 要支援/事業対象者 + 事業所番号 false-positive
// =====================================================================

await test('Local/receipt-core: sogoubu_tsusho 要支援2 PDF（画像由来テキスト）から加算3件＋要支援を抽出', () => {
  // ユーザー添付画像（A6 コード・通所型独自サービス・要支援2）相当のテキスト
  const text = [
    '要介護状態区分 事業対象者・要支援1・要支援2',
    '3. 介護予防支援事業者・地域包括支援センター作成',
    '事業所番号 1300600077 事業所名称 ほうらい',
    '通所型独自サービス12 A61121 362 1 362 1 362',
    '通所型独自サービス処遇改善加算Ⅰ A66100 350 1 350',
    '通所型独自サービス提供体制加算Ⅱ2 A66108 144 1 144 1 144',
    '通所型独自サービス科学的介護推進体制加算 A66311 40 1 40',
  ].join('\n');
  const r = analyzeText(text, 'sogoubu_tsusho');
  assert.equal(r.care_level_distribution['要支援'], 1, 'A-prefix から要支援を推定');
  assert.equal(r.current_kasan_counts.sogoubu_tsusho_shougu_kaizen, 1);
  assert.equal(r.current_kasan_counts.sogoubu_tsusho_taisei_kyouka, 1);
  assert.equal(r.current_kasan_counts.sogoubu_tsusho_kagakuteki, 1);
  // 市町村別コードは "unknown" 扱いせず detected に入れる
  assert.equal(r.unknown_service_codes.length, 0, 'sogoubu では unknown_service_codes 警告を出さない');
  assert.ok(r.detected_service_codes.length >= 3, 'A6 コードが detected に複数件入る');
  // 事業所番号 1300600077 から "130060" が誤検出されない（境界保護）
  assert.equal(r.detected_service_codes.includes('130060'), false);
});

await test('Local/detectServiceKey: 通所型独自サービス + A-codes から sogoubu_tsusho を推定', () => {
  const text = '通所型独自サービス12 A61121 通所型独自サービス処遇改善加算Ⅰ A66100';
  assert.equal(detectServiceKeyFromText(text), 'sogoubu_tsusho');
});

await test('Local/receipt-core: 事業所番号 1300600077 は 130060 として service_code 誤検出されない', () => {
  const text = '事業所番号 1300600077 事業所名称 テスト 131111 訪問看護(I)イ';
  const r = analyzeText(text, 'houmon_kango_kaigo');
  assert.equal(r.unknown_service_codes.includes('130060'), false, '事業所番号からの誤検出が無い');
  assert.ok(
    r.unknown_service_codes.includes('131111') || r.detected_service_codes.includes('131111'),
    '正しいコードは検出される',
  );
});

await test('Local/receipt-core: 要介護状態区分の選択肢列ラベルから care_level を誤検出しない', () => {
  // フォーム選択肢列のみで selected value が無いケース。サービスコード "通所介護Ⅱ32" から要介護2 を取れる。
  const text = '要介護状態区分 事業対象者・要支援1・要支援2 通所介護Ⅱ32 個別機能訓練加算Ⅰ1';
  const r = analyzeText(text, 'tsusho_kaigo');
  assert.equal(r.care_level_distribution['要介護2'], 1);
  assert.equal(r.care_level_distribution['要支援1'], undefined, 'ラベル列から要支援1は拾わない');
  assert.equal(r.care_level_distribution['要支援2'], undefined, 'ラベル列から要支援2は拾わない');
});

await test('Local/receipt-core: テキスト中の "要介護3" を care_level fallback で抽出', () => {
  // サービスコード regex がマッチしないケース。ラベル列も無い場合は text fallback が動く。
  const text = '認定情報: 要介護3 通所介護 個別機能訓練加算Ⅰ1';
  const r = analyzeText(text, 'tsusho_kaigo');
  assert.equal(r.care_level_distribution['要介護3'], 1);
});

await test('Local/receipt-core: unknown_service_codes は10件で打ち切られて末尾に件数表示', () => {
  // 12件の "未知" 13xxxx コードを並べる（131500〜は加算マスタに無い）
  const codes = ['131500', '131501', '131502', '131503', '131504', '131505', '131506', '131507', '131508', '131509', '131510', '131511'];
  const text = codes.join(' ');
  const r = analyzeText(text, 'houmon_kango_kaigo');
  const warn = (r.warnings || []).find((w) => w.startsWith('unknown_service_code'));
  assert.ok(warn, 'unknown_service_code 警告が出る');
  assert.ok(warn.includes('+2件'), `末尾に +2件 表示: ${warn}`);
});

// =====================================================================
// Pro mode: ローカルストア / 認証 / 匿名化 / プロフィール / ドラフト / 永続化
// =====================================================================

// テスト用: in-memory ローカルストア + セッション秘密鍵
process.env.KASAN_LOCAL_STORE_DIR = ':memory:';
process.env.KASAN_SESSION_SECRET = process.env.KASAN_SESSION_SECRET || 'a'.repeat(48);
_resetLocalStoreCache();

await test('LocalStore: 有効・getDb 経由で set/get/query/transaction が動く', async () => {
  assert.equal(isLocalStoreEnabled(), true);
  // ensureUser → getUserSummary（getDb 経由でローカルストアに書ける）
  await ensureUser({ uid: 'u_ls1', email: 'ls1@example.com', emailVerified: true, displayName: 'LS1' });
  const sum = await getUserSummary('u_ls1');
  assert.equal(sum.planTier, 'free');
  const rec = await getUserRecord('u_ls1');
  assert.equal(rec.email, 'ls1@example.com');
  assert.equal(rec.authProvider, 'firebase');
});

await test('Anonymize: scrubString が被保険者番号・電話・メールを伏字化', () => {
  const s = scrubString('氏名 山田太郎 電話 03-1234-5678 メール a@b.com 被保険者番号 1234567890');
  assert.equal(/03-1234-5678/.test(s), false);
  assert.equal(/a@b\.com/.test(s), false);
  assert.equal(/1234567890/.test(s), false);
});

await test('Anonymize: summarizeForStorage が PII キーを破棄し文字列をスクラブ', () => {
  const out = summarizeForStorage({
    氏名: '山田太郎',
    name: 'Taro',
    住所: '東京都...',
    note: '連絡先 090-1111-2222',
    count: 5,
    nested: { 電話番号: '03-0000-0000', ok: true },
  });
  assert.equal(out.氏名, undefined);
  assert.equal(out.name, undefined);
  assert.equal(out.住所, undefined);
  assert.equal(out.count, 5);
  assert.equal(out.nested.電話番号, undefined);
  assert.equal(out.nested.ok, true);
  assert.equal(/090-1111-2222/.test(out.note), false);
});

await test('Anonymize: anonymizeStaffRoster は氏名を捨て職種別に集計', () => {
  const r = anonymizeStaffRoster([
    { label: '山田太郎', qualification: '介護福祉士', fte: 1.0, joukin: true },
    { name: '佐藤花子', qualifications: ['看護師'], fte: 0.5, joukin: false },
    { qualification: '理学療法士', fte: 1.0 },
  ]);
  assert.equal(r.headcount, 3);
  assert.equal(r.joukinCount, 1);
  assert.equal(r.qualifiedPersonCountByProfession.care_worker, 1);
  assert.equal(r.qualifiedPersonCountByProfession.nurse, 1);
  assert.equal(r.qualifiedPersonCountByProfession.physical_therapist, 1);
  // 個人エントリに氏名（name）が残っていない
  const json = JSON.stringify(r.entries);
  assert.equal(/山田太郎|佐藤花子|name/.test(json), false);
});

await test('Anonymize: anonymizeAnalysisResult + assertStorageSafe が PII 残存で throw', () => {
  // 被保険者番号 10桁が残るオブジェクトは保存前チェックで弾く
  assert.throws(() => assertStorageSafe({ leak: '被保番 1234567890 です' }));
  // 通常の judge result 風（集計のみ）は通る
  const safe = anonymizeAnalysisResult({ service: 'tsusho_kaigo', summary: { clear: ['a'] }, kasan_count: 3 });
  assert.equal(safe.service, 'tsusho_kaigo');
  assertStorageSafe(safe);
});

await test('AuthLocal: hashPassword / verifyPassword（正誤）', () => {
  const h = hashPassword('Abcd1234');
  assert.notEqual(h, 'Abcd1234');
  assert.equal(verifyPassword('Abcd1234', h), true);
  assert.equal(verifyPassword('wrongpass1', h), false);
});

await test('AuthLocal: email / password バリデーション', () => {
  assert.equal(validateEmail('a@b.com'), true);
  assert.equal(validateEmail('nope'), false);
  assert.equal(validatePassword('Abcd1234'), true);
  assert.equal(validatePassword('short'), false); // 8文字未満
  assert.equal(validatePassword('allletters'), false); // 数字なし
});

await test('AuthLocal: register → login → セッション復元', async () => {
  assert.equal(isLocalAuthEnabled(), true);
  const { user, session } = await registerLocalUser({
    email: 'pro1@example.com',
    password: 'Secret123',
    displayName: '事業所太郎',
  });
  assert.equal(user.authProvider, 'local');
  assert.ok(session.uid.startsWith('local_'));
  // findUserByEmail で引ける
  const found = await findUserByEmail('PRO1@example.com'); // 大文字でも引ける
  assert.equal(found.uid, user.uid);
  // 重複登録は弾く
  await assert.rejects(() => registerLocalUser({ email: 'pro1@example.com', password: 'Other123' }));
  // login 成功・失敗
  const ok = await loginLocalUser({ email: 'pro1@example.com', password: 'Secret123' });
  assert.equal(ok.user.uid, user.uid);
  await assert.rejects(() => loginLocalUser({ email: 'pro1@example.com', password: 'badpass99' }));
  // セッション Cookie → readSession で復元
  const sealed = (await import('../src/utils/cookie-seal.js')).sealCookie(session);
  const fakeReq = { headers: { cookie: `kasan_session=${encodeURIComponent(sealed)}` } };
  const restored = readSession(fakeReq);
  assert.equal(restored.uid, user.uid);
});

await test('Admin: listUsers / adminSetPlan grant→paid→revoke→free', async () => {
  await ensureUser({ uid: 'u_admin_t', email: 'plan@example.com', emailVerified: true });
  let r = await adminSetPlan('u_admin_t', { action: 'grant', days: 30 });
  assert.equal(r.planTier, 'paid');
  let sum = await getUserSummary('u_admin_t');
  assert.equal(sum.planTier, 'paid');
  r = await adminSetPlan('u_admin_t', { action: 'revoke' });
  assert.equal(r.planTier, 'free');
  sum = await getUserSummary('u_admin_t');
  assert.equal(sum.planTier, 'free');
  const users = await listUsers({ limit: 100 });
  assert.ok(users.find((u) => u.uid === 'u_admin_t'));
});

await test('AccessCode: issue → redeem が plan を paid に（ローカルストア）', async () => {
  await ensureUser({ uid: 'u_code', email: 'code@example.com', emailVerified: true });
  const issued = await issueAccessCode({ durationDays: 14, note: 'test', issuedBy: 'admin', issuedByEmail: 'a@x.com' });
  assert.ok(/^[A-Z0-9]{4}-/.test(issued.code));
  const redeemed = await redeemAccessCode(issued.code, { uid: 'u_code', email: 'code@example.com' });
  assert.ok(redeemed.planExpiresAt);
  const sum = await getUserSummary('u_code');
  assert.equal(sum.planTier, 'paid');
  // 二重 redeem は弾く
  await assert.rejects(() => redeemAccessCode(issued.code, { uid: 'u_code', email: 'code@example.com' }));
});

await test('Profiles: 施設プロフィールの保存・取得・更新・削除', async () => {
  const uid = 'u_prof';
  await ensureUser({ uid, email: 'prof@example.com', emailVerified: true });
  const saved = await saveFacility(uid, { name: 'デイほっと', officeCode: 'DEMO-0004', serviceKey: 'tsusho_kaigo', regionGrade: '2' });
  assert.ok(saved.id);
  const list = await listFacilities(uid);
  assert.equal(list.length, 1);
  const updated = await saveFacility(uid, { id: saved.id, name: 'デイほっと改', serviceKey: 'tsusho_kaigo' });
  assert.equal(updated.name, 'デイほっと改');
  // 他人の uid からは見えない
  assert.equal(await getFacility('someone_else', saved.id), null);
  assert.equal(await deleteFacility(uid, saved.id), true);
  assert.equal((await listFacilities(uid)).length, 0);
});

await test('Profiles: 従業員名簿は氏名を保存せず職種集計で保持・流用できる', async () => {
  const uid = 'u_roster';
  await ensureUser({ uid, email: 'roster@example.com', emailVerified: true });
  const saved = await saveStaffRoster(uid, {
    label: '本体職員',
    serviceKey: 'tsusho_kaigo',
    entries: [
      { label: '田中', qualification: '介護福祉士', fte: 1, joukin: true },
      { name: '鈴木一郎', qualifications: ['看護師'], fte: 1, joukin: true },
    ],
  });
  assert.equal(saved.headcount, 2);
  assert.equal(saved.qualifiedPersonCountByProfession.care_worker, 1);
  assert.equal(saved.qualifiedPersonCountByProfession.nurse, 1);
  const got = await getStaffRoster(uid, saved.id);
  assert.equal(/鈴木一郎|name/.test(JSON.stringify(got)), false);
});

await test('Drafts: createDraft → 2回 merge で集計が合算される', async () => {
  const uid = 'u_draft';
  await ensureUser({ uid, email: 'draft@example.com', emailVerified: true });
  const draft = await createDraft(uid, { serviceKey: 'tsusho_kaigo', serviceMonth: '2026-04' });
  // 1 回目: 利用者集計
  await mergeIntoDraft(uid, draft.id, {
    userSummary: { activeUserCount: 10, careLevelDistribution: { youkaigo_3: 6 }, care3PlusCount: 6, care3PlusRatio: 0.6 },
    fileTypeCounts: { user_roster: 1 },
  });
  // 2 回目: レセプト由来 evidence + 職員
  const merged = await mergeIntoDraft(uid, draft.id, {
    staffSummary: { qualifiedPersonCountByProfession: { care_worker: 5 }, fteByProfession: {} },
    claimEvidence: { _meta: { schema: 'evidence' }, evidence: [{ current_kasan_counts: { nyuyoku_I: 3 }, detected_service_codes: ['155301'], total_pages: 3 }] },
    fileTypeCounts: { receipt: 1, staff_roster: 1 },
  });
  assert.equal(merged.contributedCount, 2);
  assert.equal(merged.userSummary.activeUserCount, 10);
  assert.equal(merged.staffSummary.qualifiedPersonCountByProfession.care_worker, 5);
  assert.equal(merged.claimEvidence.evidence[0].current_kasan_counts.nyuyoku_I, 3);
  assert.equal(merged.fileTypeCounts.receipt, 1);
  // draftToBundle が analysis_source 互換になる
  const bundle = draftToBundle(merged);
  assert.equal(bundle.schemaVersion, '1.0');
  assert.equal(bundle.serviceKey, 'tsusho_kaigo');
  assert.ok(bundle.userSummary && bundle.claimEvidence);
});

await test('Persistence: 有料ユーザーは履歴保存・取得・匿名アーティファクト取得できる', async () => {
  const uid = 'u_paid';
  await ensureUser({ uid, email: 'paid@example.com', emailVerified: true });
  await adminSetPlan(uid, { action: 'grant', days: 30 });
  const req = { user: { uid, email: 'paid@example.com', planTier: 'paid' } };
  const analysisId = 'an_test_1';
  const judgeResult = {
    service: 'tsusho_kaigo',
    office: 'DEMO',
    kasan_count: 3,
    summary: { clear: ['a'], waiting: [], not_clear: [], unknown: [], currently_claimed: [], claimed_but_requirements_unknown: [] },
    mapping_warnings: [],
  };
  const r = await persistAnalysisIfPaid({ req, analysisId, judgeResult, markdown: '# レポート', sourceType: 'local_engine' });
  assert.equal(r.persisted, true);
  const jobs = await listAnalysisJobsForUser(uid, { limit: 10 });
  assert.ok(jobs.find((j) => j.analysis_id === analysisId));
  const job = await getAnalysisJob({ analysisId, uid });
  assert.equal(job.service, 'tsusho_kaigo');
  // GCS 非設定 → ローカルアーティファクト
  const result = await loadAnalysisArtifact({ analysisId, uid, kind: 'result' });
  assert.ok(result && JSON.parse(result).service === 'tsusho_kaigo');
  const md = await loadAnalysisArtifact({ analysisId, uid, kind: 'report' });
  assert.ok(md.includes('レポート'));
});

await test('Persistence: 無料ユーザーは保存しない', async () => {
  const req = { user: { uid: 'u_free', email: 'free@example.com', planTier: 'free' } };
  const r = await persistAnalysisIfPaid({ req, analysisId: 'an_free', judgeResult: { service: 'x', summary: {} }, sourceType: 'local_engine' });
  assert.equal(r.persisted, false);
});

await test('AdminStats: 全体集計（ユーザー総数・有料アクティブ・サービス別件数）', async () => {
  const stats = await getAdminAggregateStats();
  assert.ok(stats, 'stats が取れる');
  // 前段のテストで複数ユーザーを作っているので >0
  assert.ok(stats.users.total >= 3, `users.total=${stats.users.total}`);
  // u_admin_t は revoke 済み、u_code/u_paid は paid 付与済み → 有料アクティブが 1 以上
  assert.ok(stats.users.paid_active >= 1, `paid_active=${stats.users.paid_active}`);
  // 有料 u_paid の解析が tsusho_kaigo で 1件保存されている
  assert.ok((stats.analyses.by_service.tsusho_kaigo || 0) >= 1, 'by_service.tsusho_kaigo >= 1');
  assert.ok(stats.analyses.total >= 1);
});

await test('AdminStats: ユーザー詳細（解析数・サービス別・最終解析時刻・直近10件・redeemed コード）', async () => {
  // 別ユーザーを作ってからのテストでも安定させるため、u_paid を対象に詳細を取る
  const d = await getUserUsageDetail('u_paid');
  assert.ok(d, 'detail が取れる');
  assert.equal(d.user.uid, 'u_paid');
  assert.equal(d.user.planTier, 'paid');
  assert.ok(d.counts.analyses >= 1);
  assert.ok(d.last_analysis_at);
  assert.equal(d.analyses_by_service.tsusho_kaigo, d.counts.analyses);
  assert.ok(d.recent_analyses.length >= 1);
  assert.equal(d.recent_analyses[0].service, 'tsusho_kaigo');
  // u_paid 自身は code redeem していないので 0
  assert.equal(d.counts.redeemed_codes, 0);
  // u_code は redeem 済み → 1
  const d2 = await getUserUsageDetail('u_code');
  assert.equal(d2.counts.redeemed_codes, 1);
  assert.ok(d2.redeemed_codes[0].code);
});

await test('AdminStats: 存在しないユーザーは null', async () => {
  const d = await getUserUsageDetail('not_a_user_xxx');
  assert.equal(d, null);
});

// =====================================================================
// CPOS app-data ストア — 新アーキテクチャの基盤（FakeCpos で検証）
// =====================================================================

const FAKE_ORG = 'org_demo';
const FAKE_USER = { id: 'user_demo', email: 'demo@example.com', name: 'Demo', role: 'admin' };

function withFakeCpos() {
  const fake = new FakeCpos({ organizationId: FAKE_ORG, user: FAKE_USER });
  _setCposStoreClient(fake);
  return fake;
}

await test('CposStore: CPOS 未設定なら 503 系のエラー（cpos_not_configured）', async () => {
  _resetCposStoreClient();
  // App Token を持たないので isAppCposConfigured=false
  assert.equal(isAppCposConfigured(), false);
  await assert.rejects(() => listCposAnalyses({ organizationId: FAKE_ORG }), /cpos_not_configured/);
});

await test('CposStore: 解析サマリの保存・一覧・取得・集計（fallback 集計含む）', async () => {
  withFakeCpos();
  const judge = {
    service: 'tsusho_kaigo',
    kasan_count: 3,
    summary: { clear: ['a'], waiting: [], not_clear: [], unknown: [], currently_claimed: [], claimed_but_requirements_unknown: [] },
    mapping_warnings: [],
  };
  const saved = await saveAnalysis({ organizationId: FAKE_ORG, createdBy: FAKE_USER.id, payload: { ...judge, facilityId: 'fac_a', serviceMonth: '2026-04' } });
  assert.ok(saved.id);
  assert.equal(saved.organizationId, FAKE_ORG);
  // list
  const list = await listCposAnalyses({ organizationId: FAKE_ORG });
  assert.equal(list.length, 1);
  assert.equal(list[0].data.service, 'tsusho_kaigo');
  // get
  const got = await getCposAnalysis(saved.id);
  assert.equal(got.id, saved.id);
  // 集計（CPOS aggregate は FakeCpos で 501 → list 集計フォールバック）
  const agg = await aggregateAnalyses({ organizationId: FAKE_ORG });
  assert.equal(agg.total, 1);
  assert.equal(agg.byService.tsusho_kaigo, 1);
  assert.ok(agg.byMonth['2026-04'] >= 1 || Object.keys(agg.byMonth).length >= 1);
});

await test('CposStore: 解析の自由文に PII を入れても保存後の data 上から除去される（多層防御）', async () => {
  withFakeCpos();
  const saved = await saveAnalysis({
    organizationId: FAKE_ORG, createdBy: FAKE_USER.id,
    payload: { service: 'tsusho_kaigo', summary: { clear: [] }, kasan_count: 1, leak: '電話 03-1234-5678 メール a@b.com' },
  });
  const json = JSON.stringify(saved.data);
  assert.equal(/03-1234-5678/.test(json), false, '電話番号は scrubbing される');
  assert.equal(/a@b\.com/.test(json), false, 'メールは scrubbing される');
});

await test('CposStore: review の保存・一覧（analysisId / kasanKey で絞り込み）', async () => {
  withFakeCpos();
  await recordReview({ organizationId: FAKE_ORG, createdBy: FAKE_USER.id, analysisId: 'an_x', kasanKey: 'nyuyoku_I', decision: 'approved' });
  await recordReview({ organizationId: FAKE_ORG, createdBy: FAKE_USER.id, analysisId: 'an_x', kasanKey: 'koukuu_I', decision: 'returned', comment: '要再確認' });
  await recordReview({ organizationId: FAKE_ORG, createdBy: FAKE_USER.id, analysisId: 'an_y', kasanKey: 'nyuyoku_I', decision: 'awaiting_review' });
  const allX = await listReviews({ organizationId: FAKE_ORG, analysisId: 'an_x' });
  assert.equal(allX.length, 2);
  const nyu = await listReviews({ organizationId: FAKE_ORG, analysisId: 'an_x', kasanKey: 'nyuyoku_I' });
  assert.equal(nyu.length, 1);
  assert.equal(nyu[0].data.decision, 'approved');
});

await test('CposStore: 施設プロフィールの作成・更新・取得・削除', async () => {
  withFakeCpos();
  const created = await cposSaveFacility({ organizationId: FAKE_ORG, createdBy: FAKE_USER.id, data: { name: 'デイほっと', officeCode: 'DEMO-0004', serviceKey: 'tsusho_kaigo' } });
  assert.ok(created.id);
  // 更新
  const upd = await cposSaveFacility({ id: created.id, organizationId: FAKE_ORG, createdBy: FAKE_USER.id, data: { name: 'デイほっと改' } });
  assert.equal(upd.data.name, 'デイほっと改');
  assert.equal(upd.data.officeCode, 'DEMO-0004', '更新は data を merge する');
  // 一覧
  const list = await cposListFacilities({ organizationId: FAKE_ORG });
  assert.equal(list.length, 1);
  // 取得
  const got = await cposGetFacility(created.id);
  assert.equal(got.data.name, 'デイほっと改');
  // 削除
  assert.equal(await cposDeleteFacility(created.id), true);
  assert.equal((await cposListFacilities({ organizationId: FAKE_ORG })).length, 0);
});

await test('CposStore: 名簿の自由文中の被保番は保存時に除去される（保存自体は通る）', async () => {
  withFakeCpos();
  const ok = await cposSaveRoster({
    organizationId: FAKE_ORG,
    createdBy: FAKE_USER.id,
    data: { label: '本体職員', qualifiedPersonCountByProfession: { care_worker: 5, nurse: 1 }, fteByProfession: {}, headcount: 6 },
  });
  assert.ok(ok.id);
  // 自由文中の 10桁被保番はサーバ側 scrubbing で除去（保存後の data に残らない）
  const withLeak = await cposSaveRoster({
    organizationId: FAKE_ORG,
    createdBy: FAKE_USER.id,
    data: { label: '担当外', notes: '被保 1234567890', headcount: 1 },
  });
  assert.equal(/1234567890/.test(JSON.stringify(withLeak.data)), false, '被保番は scrubbing される');
  const list = await cposListRosters({ organizationId: FAKE_ORG });
  assert.equal(list.length, 2);
});

await test('CposStore: ドラフトの作成・更新・一覧', async () => {
  withFakeCpos();
  const d = await cposCreateDraft({ organizationId: FAKE_ORG, createdBy: FAKE_USER.id, data: { serviceKey: 'tsusho_kaigo', serviceMonth: '2026-04', contributedCount: 0 } });
  assert.ok(d.id);
  const upd = await cposUpdateDraft(d.id, { contributedCount: 2, userSummary: { activeUserCount: 10 } });
  assert.equal(upd.data.contributedCount, 2);
  assert.equal(upd.data.userSummary.activeUserCount, 10);
  const list = await cposListDrafts({ organizationId: FAKE_ORG, createdBy: FAKE_USER.id });
  assert.equal(list.length, 1);
});

await test('CposStore: エンタイトルメント grant→active / revoke→revoked', async () => {
  withFakeCpos();
  let e = await getEntitlement({ organizationId: FAKE_ORG, userId: FAKE_USER.id });
  assert.equal(e.status, 'none');
  await setEntitlement({ organizationId: FAKE_ORG, userId: FAKE_USER.id, action: 'grant', days: 30 });
  e = await getEntitlement({ organizationId: FAKE_ORG, userId: FAKE_USER.id });
  assert.equal(e.status, 'active');
  assert.ok(e.expiresAt);
  await setEntitlement({ organizationId: FAKE_ORG, userId: FAKE_USER.id, action: 'revoke' });
  e = await getEntitlement({ organizationId: FAKE_ORG, userId: FAKE_USER.id });
  assert.equal(e.status, 'revoked');
  // grant→extend が既存期限を加算するか
  await setEntitlement({ organizationId: FAKE_ORG, userId: FAKE_USER.id, action: 'grant', days: 10 });
  const e2 = await getEntitlement({ organizationId: FAKE_ORG, userId: FAKE_USER.id });
  assert.equal(e2.status, 'active');
});

await test('CposStore: 利用状況サマリ（ユーザー数 + 解析集計）', async () => {
  const fake = withFakeCpos();
  // ユーザーを追加
  await fake.addOrganizationUser(FAKE_ORG, { email: 'sub@example.com', name: 'Sub', role: 'staff' });
  // 解析を 2 件
  await saveAnalysis({ organizationId: FAKE_ORG, createdBy: FAKE_USER.id, payload: { service: 'tsusho_kaigo', summary: { clear: [] }, kasan_count: 1 } });
  await saveAnalysis({ organizationId: FAKE_ORG, createdBy: FAKE_USER.id, payload: { service: 'houmon_kaigo', summary: { clear: [] }, kasan_count: 2 } });
  const s = await getUsageSummary({ organizationId: FAKE_ORG });
  assert.equal(s.users.total >= 2, true);
  assert.equal(s.analyses.total, 2);
  assert.equal(s.analyses.byService.tsusho_kaigo, 1);
  assert.equal(s.analyses.byService.houmon_kaigo, 1);
});

await test('CposStore: 組織プロビジョニング（B2）と専用組織への保存隔離', async () => {
  const fake = withFakeCpos();
  // 専用組織を払い出し
  const prov = await fake.createOrganization({ displayName: 'デイほっと', type: 'kasan_app', admin: { email: 'owner@example.com', name: '山田' } });
  const newOrg = prov.organizationId;
  // 新組織への解析保存は新組織にしか入らない
  await saveAnalysis({ organizationId: newOrg, createdBy: prov.adminUserId, payload: { service: 'tsusho_kaigo', summary: { clear: [] }, kasan_count: 1 } });
  const inNew = await listCposAnalyses({ organizationId: newOrg });
  const inDefault = await listCposAnalyses({ organizationId: FAKE_ORG });
  assert.equal(inNew.length, 1);
  // FAKE_ORG 側に侵入していない
  const leaked = inDefault.find((d) => d.organizationId === newOrg);
  assert.equal(leaked, undefined);
});

_resetCposStoreClient();

// =====================================================================
// 回帰: CPOS の analysis-source で facility.regionClass=null のとき通る
// =====================================================================

await test('CPOS: facility.regionClass=null / 他オプショナル null でも validate + transform を通る', async () => {
  const payload = {
    schemaVersion: '1.0',
    organizationId: 'org_x',
    serviceMonth: '2026-04',
    facility: {
      id: 'fac_a',
      name: null,             // ← null でも通る
      businessNumber: null,
      serviceTypeCodes: null, // ← null は配列省略扱い
      facilityCategoryCode: null,
      regionClass: null,      // ← ユーザー報告のケース
    },
    userSummary: {},
    staffSummary: {},
    claimSummary: { currentAddOnCounts: {} },
    dataCompleteness: {},
  };
  const normalized = normalizeCposAnalysisPayload(payload);
  // null 系はキーごと落ちている
  assert.equal(normalized.facility.regionClass, undefined);
  assert.equal(normalized.facility.name, undefined);
  assert.equal(normalized.facility.serviceTypeCodes, undefined);
  // 必須の id は残る
  assert.equal(normalized.facility.id, 'fac_a');
  // schema 検証も通る
  validateAnalysisSource(normalized);
});

await test('CPOS: facility.regionClass="2" のような数値文字列でもそのまま通る', () => {
  const ok = {
    schemaVersion: '1.0',
    serviceMonth: '2026-04',
    facility: { id: 'fac_a', name: 'デイほっと', regionClass: '2' },
  };
  const r = normalizeCposAnalysisPayload(ok);
  assert.equal(r.facility.regionClass, '2');
  validateAnalysisSource(r);
});

await test('CPOS: facility.regionClass=2 (number) でも文字列化されて通る', () => {
  const payload = {
    schemaVersion: '1.0',
    serviceMonth: '2026-04',
    facility: { id: 'fac_a', regionClass: 2 },
  };
  const r = normalizeCposAnalysisPayload(payload);
  assert.equal(r.facility.regionClass, '2');
  validateAnalysisSource(r);
});

console.log(`\n結果: ${passed} 件成功 / ${failed} 件失敗`);
if (failed > 0) process.exit(1);
