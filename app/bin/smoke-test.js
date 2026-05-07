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

console.log(`\n結果: ${passed} 件成功 / ${failed} 件失敗`);
if (failed > 0) process.exit(1);
