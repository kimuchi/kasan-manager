#!/usr/bin/env node
// Cloud Run ログを tail
// 使い方:
//   npm run logs                # 直近10分
//   npm run logs -- --since=1h
//   npm run logs -- --severity=ERROR

import 'dotenv/config';
import { config as dotenvConfig } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execCommand } from './_lib.js';

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

const args = parseArgs(process.argv);
const projectId = process.env.GCP_PROJECT_ID;
if (!projectId) {
  console.error('GCP_PROJECT_ID が .env に未設定です');
  process.exit(1);
}
const service = process.env.CLOUD_RUN_SERVICE_NAME || 'kasan-manager';
const since = args.since || '10m';
const severity = args.severity || 'DEFAULT';

const filter = `resource.type=cloud_run_revision AND resource.labels.service_name=${service} AND severity>=${severity}`;
const cmdArgs = [
  'logging', 'read',
  filter,
  `--project=${projectId}`,
  `--freshness=${since}`,
  '--format=value(timestamp,severity,textPayload,jsonPayload.message)',
  '--order=asc',
  '--limit=200',
];
console.log(`▶ gcloud ${cmdArgs.join(' ')}`);
try {
  const r = await execCommand('gcloud', cmdArgs, { cwd: PROJECT_ROOT });
  process.exit(r.code ?? 0);
} catch (err) {
  console.error('❌', err.message || err);
  process.exit(1);
}
