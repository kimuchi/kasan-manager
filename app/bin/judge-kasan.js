#!/usr/bin/env node
// judge_kasan.py 互換 CLI
// 使い方:
//   node app/bin/judge-kasan.js --service tsusho_kaigo --office DEMO-0004
//   node app/bin/judge-kasan.js --service kyotaku_shien --office DEMO-0006 \
//        --tenant-status tenant_data/demo_status/DEMO-0006/tenant_status.json \
//        --staff-data    tenant_data/demo_staff/DEMO-0006/staff.json \
//        --user-summary  tenant_data/demo_user_summary/DEMO-0006/user_summary.json \
//        --report-md out/report.md --json out/report.json

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { run } from '../src/services/judge.js';
import { renderMarkdown } from '../src/services/markdown-report.js';

function parseArgs(argv) {
  // --flag=value / --flag value / --flag (boolean) に対応
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const eq = key.indexOf('=');
    if (eq >= 0) {
      out[key.slice(0, eq)] = key.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next == null || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const STATUS_FILTER_CHOICES = ['implemented', 'draft', 'planned'];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.service) {
    console.error('ERROR: --service は必須です');
    process.exit(1);
  }
  if (args['status-filter'] && !STATUS_FILTER_CHOICES.includes(String(args['status-filter']))) {
    console.error(
      `ERROR: --status-filter は ${STATUS_FILTER_CHOICES.join(' | ')} のいずれかを指定してください`,
    );
    process.exit(1);
  }

  let inlineEvidence = null;
  if (args['receipt-pdf']) {
    if (!args.office) {
      console.error('ERROR: --receipt-pdf 指定時は --office 必須');
      process.exit(1);
    }
    if (args.evidence) {
      console.warn('WARN: --receipt-pdf と --evidence 両方指定。--evidence を優先します。');
    }
  }

  const result = await run({
    service: String(args.service),
    office: args.office ? String(args.office) : null,
    domain: args.domain ? String(args.domain) : null,
    statusFilter: args['status-filter'] ? String(args['status-filter']) : null,
    statusPath: args.status ? String(args.status) : null,
    evidencePath: args.evidence ? String(args.evidence) : null,
    applyEvidence: Boolean(args['apply-evidence'] || args['receipt-pdf']),
    receiptPdfPath: args['receipt-pdf'] ? String(args['receipt-pdf']) : null,
    evidenceOut: args['evidence-out'] ? String(args['evidence-out']) : null,
    inlineEvidence,
    demoTenantStatusPath: args['tenant-status'] ? String(args['tenant-status']) : null,
    staffDataPath: args['staff-data'] ? String(args['staff-data']) : null,
    userSummaryPath: args['user-summary'] ? String(args['user-summary']) : null,
  });

  if (args.json) {
    const out = String(args.json);
    await mkdir(path.dirname(path.resolve(out)), { recursive: true });
    const resultJson = { ...result };
    if (resultJson.tenant_status) {
      resultJson.tenant_status_meta = resultJson.tenant_status._meta;
      delete resultJson.tenant_status;
    }
    await writeFile(out, JSON.stringify(resultJson, null, 2), 'utf-8');
    console.log(`JSON書き出し: ${out}`);
  }

  if (args['report-md']) {
    const out = String(args['report-md']);
    await mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await writeFile(out, renderMarkdown(result), 'utf-8');
    console.log(`Markdownレポート書き出し: ${out}`);
  }

  if (!args.json && !args['report-md']) {
    const sd = result.service_def || {};
    console.log('\n=== CareLinker 加算チェッカー判定 ===');
    console.log(`サービス: ${sd.display_name} (${result.service})`);
    console.log(`事業所: ${result.office_code || '(未指定)'}`);
    if (result.draft_warning) {
      console.log(`\n⚠️  ${result.draft_warning}\n`);
      return;
    }
    const s = result.summary || {};
    console.log(`\n--- 加算判定サマリ（全${result.kasan_count}加算）---`);
    console.log(`  ✅ clear     : ${(s.clear || []).length} 件`);
    console.log(`  ⏸ waiting   : ${(s.waiting || []).length} 件`);
    console.log(`  ❌ not_clear : ${(s.not_clear || []).length} 件`);
    console.log(`  ❔ unknown   : ${(s.unknown || []).length} 件`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
