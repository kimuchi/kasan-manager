#!/usr/bin/env node
// CPOS 接続確認 CLI
//
// 使い方:
//   npm run cpos:bootstrap -- --base-url=https://cpos.example.jp --token=$CPOS_PAT
//
// 注意: PAT はサーバの .env では管理しません（個人ごとに渡す方式）。
// よってこの CLI は引数または環境変数 CPOS_PAT で都度指定してください。

import 'dotenv/config';
import { config as dotenvConfig } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CposClient, defaultBaseUrl, isAllowedBaseUrl } from '../src/services/cpos/client.js';
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
  const baseUrl =
    typeof args['base-url'] === 'string' ? args['base-url'] : defaultBaseUrl();
  const token =
    typeof args.token === 'string'
      ? args.token
      : process.env.CPOS_PAT || process.env.CPOS_API_TOKEN || null;

  if (!baseUrl) {
    console.error('❌ CPOS URL が指定されていません');
    console.error('   --base-url=https://cpos.example.jp または KASAN_DEFAULT_CPOS_BASE_URL を指定してください');
    process.exit(2);
  }
  if (!token) {
    console.error('❌ CPOS PAT が指定されていません');
    console.error('   --token=cpos_pat_... または環境変数 CPOS_PAT を指定してください');
    process.exit(2);
  }
  if (!isAllowedBaseUrl(baseUrl)) {
    console.error(`❌ 指定された CPOS URL は許可されていません: ${baseUrl}`);
    process.exit(2);
  }

  console.log(`▶ CPOS: ${baseUrl}`);
  console.log(`▶ Token: ${token.slice(0, 14)}...REDACTED`);

  const client = new CposClient({ baseUrl, token });
  try {
    const me = await client.getMe();
    console.log('');
    console.log(`✅ /api/platform/me OK`);
    const user = me?.user || me;
    console.log(`   ユーザ: ${user?.email || user?.name || user?.id || '-'}（role=${user?.role || '-'}）`);
    if (me?.token) {
      console.log(`   authMethod: ${me.token.authMethod || '-'}`);
      console.log(`   scopes: ${(me.token.scopes || []).join(', ') || '-'}`);
      console.log(`   allowedFacilityIds: ${(me.token.allowedFacilityIds || []).join(', ') || '（全事業所）'}`);
      console.log(`   expiresAt: ${me.token.expiresAt || '（指定なし）'}`);
    }
    try {
      const r = await client.getPlatformFacilities();
      const list = Array.isArray(r?.facilities) ? r.facilities : Array.isArray(r) ? r : [];
      console.log('');
      console.log(`▶ /api/platform/facilities: ${list.length} 件`);
      for (const f of list) {
        console.log(`     - ${f.id}: ${f.name || ''}（serviceTypeCodes=${(f.serviceTypeCodes || []).join(',') || '-'}）`);
      }
    } catch (err) {
      console.log(`   /api/platform/facilities は取得できませんでした: ${err.message}`);
    }
  } catch (err) {
    if (err instanceof CposApiError) {
      console.error(`❌ ${err.message} (HTTP ${err.statusCode})`);
      if (err.hint) console.error(`   ヒント: ${err.hint}`);
      process.exit(1);
    }
    if (err instanceof CposNotConfiguredError) {
      console.error(`❌ ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
