#!/usr/bin/env node
// CPOS 接続確認 CLI（指示書 §13.2）
//
// .env の CPOS_BASE_URL / CPOS_API_TOKEN を使って /api/kasan/v1/bootstrap を叩き、
// 接続状態・ユーザ・権限・アクセス可能事業所を一覧表示する。
//
// 使い方:
//   npm run cpos:bootstrap
//   npm run cpos:bootstrap -- --base-url=https://cpos.example.jp --token=$CPOS_API_TOKEN

import 'dotenv/config';
import { config as dotenvConfig } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CposClient, readClientConfig } from '../src/services/cpos/client.js';
import { validateBootstrap } from '../src/services/cpos/schemas.js';
import { CposApiError, CposNotConfiguredError } from '../src/services/cpos/errors.js';

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

async function main() {
  const args = parseArgs(process.argv);
  let config;
  try {
    config = readClientConfig({
      overrides: {
        baseUrl: typeof args['base-url'] === 'string' ? args['base-url'] : undefined,
        accessToken: typeof args.token === 'string' ? args.token : undefined,
      },
    });
  } catch (err) {
    if (err instanceof CposNotConfiguredError) {
      console.error(`❌ ${err.message}`);
      console.error('   .env.example を参考に CPOS_BASE_URL を設定してください。');
      process.exit(2);
    }
    throw err;
  }

  console.log(`▶ CPOS: ${config.baseUrl}`);
  console.log(`▶ Token: ${config.accessToken ? '設定あり (Bearer)' : '未設定（Cookie/Session 想定）'}`);

  const client = new CposClient(config);
  try {
    const payload = validateBootstrap(await client.getBootstrap());
    console.log('');
    console.log(`✅ 接続: ${payload.connected ? 'OK' : 'NG'}`);
    if (payload.cpos) console.log(`   CPOS apiVersion: ${payload.cpos.apiVersion} / serverTime: ${payload.cpos.serverTime}`);
    if (payload.user) console.log(`   ユーザ: ${payload.user.email || payload.user.name || payload.user.userId}（role=${payload.user.role || '-'}）`);
    if (payload.organization) console.log(`   組織: ${payload.organization.name || payload.organization.organizationId}`);
    const facilities = payload.facilities || [];
    console.log(`   アクセス可能事業所: ${facilities.length} 件`);
    for (const f of facilities) {
      console.log(`     - ${f.id}: ${f.name || ''}（serviceTypeCodes=${(f.serviceTypeCodes || []).join(',') || '-'}）`);
    }
    if (payload.features) {
      const enabled = Object.entries(payload.features).filter(([, v]) => v).map(([k]) => k);
      if (enabled.length) console.log(`   有効機能: ${enabled.join(', ')}`);
    }
  } catch (err) {
    if (err instanceof CposApiError) {
      console.error(`❌ ${err.message} (HTTP ${err.statusCode})`);
      if (err.hint) console.error(`   ヒント: ${err.hint}`);
      process.exit(1);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
