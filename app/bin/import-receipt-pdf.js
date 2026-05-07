#!/usr/bin/env node
// import_receipt_pdf.py 互換 CLI
// 使い方:
//   node app/bin/import-receipt-pdf.js --service tsusho_kaigo --office DEMO-0004 \
//        --pdf path/to/receipt.pdf --evidence-out tenant_data/evidence/DEMO-0004/

import path from 'node:path';
import { runExtraction } from '../src/services/receipt-pdf.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.service) {
    console.error('ERROR: --service は必須');
    process.exit(1);
  }
  if (!args.office) {
    console.error('ERROR: --office は必須');
    process.exit(1);
  }
  if (!args['evidence-out']) {
    console.error('ERROR: --evidence-out は必須');
    process.exit(1);
  }
  if (!args.pdf && !args['sample-text']) {
    console.error('ERROR: --pdf または --sample-text のいずれか必須');
    process.exit(1);
  }

  const { evidence, savedPath } = await runExtraction({
    office: String(args.office),
    service: String(args.service),
    tenant: args.tenant ? String(args.tenant) : null,
    pdfPath: args.pdf ? path.resolve(String(args.pdf)) : null,
    sampleTextPath: args['sample-text'] ? path.resolve(String(args['sample-text'])) : null,
    evidenceOut: String(args['evidence-out']),
  });

  console.log(`evidence書き出し: ${savedPath}`);
  const e = evidence.evidence[0];
  console.log(`  service_key: ${e.service_key}`);
  console.log(`  office_code: ${e.office_code}`);
  console.log(`  total_users_estimated: ${e.total_users_estimated}`);
  console.log(`  yokaigo_3plus_ratio: ${e.yokaigo_3plus_ratio}`);
  console.log(`  current_kasan_counts: ${Object.keys(e.current_kasan_counts).length}件検出`);
  console.log(`  extraction_confidence: ${e.extraction_confidence}`);
  if ((e.warnings || []).length) {
    console.log('  warnings:');
    for (const w of e.warnings) console.log(`    - ${w}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
