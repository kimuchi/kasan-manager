#!/usr/bin/env node
// CPOS analysis-source 取得 → 既存 judge.run() で加算分析を実行
//
// 使い方:
//   # live: CPOS API から取得して分析
//   npm run cpos:analyze -- --facility=facility-a --month=2026-04
//
//   # fixture: 事前に保存した JSON を使って分析（オフライン検証用）
//   npm run cpos:analyze -- --source=app/tests/fixtures/cpos_analysis_source.sample.json
//
//   # 出力先
//   npm run cpos:analyze -- --facility=facility-a --month=2026-04 \
//        --report-md=out/cpos_facility-a_2026-04.md \
//        --json=out/cpos_facility-a_2026-04.json
//
// 既存 scripts/judge_kasan.py 互換の judge.js / markdown-report.js を変更せず、
// inlineEvidence と inline 用 facts ファイルを使って分析する。

import 'dotenv/config';
import { config as dotenvConfig } from 'dotenv';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { CposClient, readClientConfig, isConfigured as isCposConfigured } from '../src/services/cpos/client.js';
import { validateAnalysisSource } from '../src/services/cpos/schemas.js';
import { CposApiError, CposNotConfiguredError } from '../src/services/cpos/errors.js';
import { toEngineInputs } from '../src/services/cpos/transform.js';
import { run as runJudge } from '../src/services/judge.js';
import { renderMarkdown } from '../src/services/markdown-report.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
dotenvConfig({ path: path.join(PROJECT_ROOT, '.env'), override: true });

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

async function fetchAnalysisSource(args) {
  if (args.source) {
    const p = path.resolve(String(args.source));
    if (!existsSync(p)) throw new Error(`--source ファイルが見つかりません: ${p}`);
    const raw = await readFile(p, 'utf-8');
    return { payload: JSON.parse(raw), origin: 'fixture', sourcePath: p };
  }
  if (!args.facility || !args.month) {
    throw new Error('--facility と --month は必須です（または --source でフィクスチャを指定）');
  }
  if (!isCposConfigured()) {
    throw new CposNotConfiguredError();
  }
  const client = new CposClient(readClientConfig());
  const payload = await client.getAnalysisSource({
    facilityId: String(args.facility),
    serviceMonth: String(args.month),
    includePii: Boolean(args['include-pii']),
  });
  return { payload, origin: 'live', sourcePath: null };
}

async function writeTempJson(prefix, data) {
  const dir = await mkdir(path.join(os.tmpdir(), `kasan-cpos-${Date.now()}`), { recursive: true });
  const file = path.join(dir || path.join(os.tmpdir(), `kasan-cpos-${Date.now()}`), `${prefix}.json`);
  await writeFile(file, JSON.stringify(data, null, 2), 'utf-8');
  return file;
}

async function main() {
  const args = parseArgs(process.argv);
  const dryRun = Boolean(args['dry-run']);

  const { payload: rawSource, origin, sourcePath } = await fetchAnalysisSource(args);
  const source = validateAnalysisSource(rawSource);
  console.log(`▶ analysis-source 取得: origin=${origin}${sourcePath ? ` (${sourcePath})` : ''}`);
  console.log(`▶ facility=${source.facility?.id} / serviceMonth=${source.serviceMonth} / schemaVersion=${source.schemaVersion}`);

  if (dryRun) {
    console.log('— dry-run のため judge は実行しません');
    return;
  }

  const inputs = await toEngineInputs(source);
  console.log(`▶ service_key=${inputs.service_key} / dataCompleteness=${JSON.stringify(inputs.metadata.dataCompleteness)}`);

  // 一時ディレクトリに inline JSON を書き出す（judge.run() は path で受け取る既存 IF）
  const tmpDir = path.join(os.tmpdir(), `kasan-cpos-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  const tenantPath = path.join(tmpDir, 'tenant_status.json');
  const staffPath = path.join(tmpDir, 'staff.json');
  const userPath = path.join(tmpDir, 'user_summary.json');
  await writeFile(tenantPath, JSON.stringify(inputs.tenant_status, null, 2), 'utf-8');
  await writeFile(staffPath, JSON.stringify(inputs.staff_data, null, 2), 'utf-8');
  await writeFile(userPath, JSON.stringify(inputs.user_summary, null, 2), 'utf-8');

  const result = await runJudge({
    service: inputs.service_key,
    office: inputs.facility?.id || null,
    applyEvidence: true,
    inlineEvidence: inputs.claim_evidence,
    demoTenantStatusPath: tenantPath,
    staffDataPath: staffPath,
    userSummaryPath: userPath,
  });

  // metadata を埋め込んでレポート側で「CPOS 由来」を表示
  result.cpos_metadata = inputs.metadata;
  result.cpos_metadata.serviceMonth = source.serviceMonth;

  if (args.json) {
    const out = String(args.json);
    await mkdir(path.dirname(path.resolve(out)), { recursive: true });
    const json = { ...result };
    if (json.tenant_status) {
      json.tenant_status_meta = json.tenant_status._meta;
      delete json.tenant_status;
    }
    await writeFile(out, JSON.stringify(json, null, 2), 'utf-8');
    console.log(`JSON 書き出し: ${out}`);
  }
  if (args['report-md']) {
    const out = String(args['report-md']);
    await mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await writeFile(out, renderMarkdown(result), 'utf-8');
    console.log(`Markdown レポート書き出し: ${out}`);
  }
  if (!args.json && !args['report-md']) {
    const s = result.summary || {};
    console.log('');
    console.log(`=== CPOS 連携 加算分析サマリ ===`);
    console.log(`  事業所: ${inputs.metadata.facilityName || inputs.facility?.id}`);
    console.log(`  対象月: ${source.serviceMonth}`);
    console.log(`  全 ${result.kasan_count} 加算中: clear=${(s.clear || []).length} / waiting=${(s.waiting || []).length} / not_clear=${(s.not_clear || []).length} / unknown=${(s.unknown || []).length}`);
    if (s.currently_claimed) console.log(`  CPOS 集計算定中: ${(s.currently_claimed || []).length} / 要件未確認: ${(s.claimed_but_requirements_unknown || []).length}`);
  }
}

main().catch((err) => {
  if (err instanceof CposApiError) {
    console.error(`❌ CPOS API エラー (HTTP ${err.statusCode}): ${err.message}`);
    if (err.hint) console.error(`   ヒント: ${err.hint}`);
    process.exit(1);
  }
  if (err instanceof CposNotConfiguredError) {
    console.error(`❌ ${err.message}`);
    console.error('   .env に CPOS_BASE_URL を設定するか、--source でフィクスチャを指定してください。');
    process.exit(2);
  }
  console.error('❌', err.message || err);
  process.exit(1);
});
