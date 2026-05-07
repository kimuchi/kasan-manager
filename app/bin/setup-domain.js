#!/usr/bin/env node
// 加算マネージャー カスタムドメイン マッピング
//
// 2 つのモードを提供する:
//   --mode=mapping     Cloud Run の Domain Mappings（簡易・preview/GA 地域限定）
//   --mode=loadbalancer  External HTTPS LB + Serverless NEG + Google マネージド証明書（本番推奨）
//
// 使い方:
//   npm run setup:domain -- --domain=kasan.example.jp                     # default = mapping
//   npm run setup:domain -- --domain=kasan.example.jp --mode=loadbalancer
//
// 事前条件:
//   - `npm run setup:gcp` 済
//   - `npm run deploy:cloudrun` 済（Cloud Run サービスが存在する）
//   - Cloud Run マッピング方式: Search Console で対象ドメインの所有者確認済（必要時）
//   - LB 方式: 対象ドメインの DNS をコントロールできる（A レコードを LB IP に向ける）

import 'dotenv/config';
import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';
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
    if (!m) continue;
    out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

const exec = (cmd, args, opts = {}) => execCommand(cmd, args, { cwd: PROJECT_ROOT, ...opts });

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

async function setupMapping({ projectId, region, service, domain }) {
  console.log(`▶ Cloud Run Domain Mappings を作成: ${domain} → ${service}（${region}）`);
  const r = await exec(
    'gcloud',
    [
      'beta', 'run', 'domain-mappings', 'create',
      `--service=${service}`,
      `--domain=${domain}`,
      `--region=${region}`,
      `--project=${projectId}`,
      '--platform=managed',
    ],
    { captureOutput: true, allowFail: true },
  );
  if (r.code !== 0 && !r.stderr.includes('already exists')) {
    fail(`Domain Mapping 作成失敗: ${r.stderr}`);
  }
  console.log('');
  console.log('▶ DNS レコードを設定してください（既に設定済の場合はそのまま証明書発行を待つ）:');
  const desc = await exec(
    'gcloud',
    [
      'beta', 'run', 'domain-mappings', 'describe',
      `--domain=${domain}`,
      `--region=${region}`,
      `--project=${projectId}`,
      '--platform=managed',
      '--format=value(status.resourceRecords)',
    ],
    { captureOutput: true, allowFail: true },
  );
  console.log(desc.stdout || '   ※ describe 取得失敗。`gcloud beta run domain-mappings describe` で手動確認してください。');
  console.log('');
  console.log('▶ ドメインの DNS 設定例（CNAME / A / AAAA レコードのいずれか）:');
  console.log('   - サブドメイン（kasan.example.jp 等）   : CNAME ghs.googlehosted.com.');
  console.log('   - ルートドメイン（example.jp 等）       : A 216.239.32.21 / 34.21 / 36.21 / 38.21');
  console.log('                                              AAAA 2001:4860:4802:32::15 / 34::15 / 36::15 / 38::15');
  console.log('');
  console.log('▶ DNS 反映後、Google マネージド証明書が自動発行されます（5〜60 分）');
  console.log('▶ ステータスは下記で確認:');
  console.log(`   gcloud beta run domain-mappings describe --domain=${domain} --region=${region} --project=${projectId}`);
}

async function setupLoadBalancer({ projectId, region, service, domain, lbName, ipName, certName, negName }) {
  // 1) Serverless NEG
  console.log(`▶ Serverless NEG を作成: ${negName}`);
  await runIdempotent('compute', ['network-endpoint-groups', 'describe', negName, `--region=${region}`, `--project=${projectId}`],
    () => exec('gcloud', [
      'compute', 'network-endpoint-groups', 'create', negName,
      `--region=${region}`,
      '--network-endpoint-type=serverless',
      `--cloud-run-service=${service}`,
      `--project=${projectId}`,
    ]));

  // 2) Backend service
  const backend = `${lbName}-backend`;
  console.log(`▶ Backend service を作成: ${backend}`);
  await runIdempotent('compute', ['backend-services', 'describe', backend, '--global', `--project=${projectId}`],
    () => exec('gcloud', [
      'compute', 'backend-services', 'create', backend,
      '--load-balancing-scheme=EXTERNAL_MANAGED',
      '--global',
      `--project=${projectId}`,
    ]));
  await exec('gcloud', [
    'compute', 'backend-services', 'add-backend', backend,
    '--global',
    `--network-endpoint-group=${negName}`,
    `--network-endpoint-group-region=${region}`,
    `--project=${projectId}`,
  ], { allowFail: true });

  // 3) URL map
  const urlMap = `${lbName}-urlmap`;
  console.log(`▶ URL map を作成: ${urlMap}`);
  await runIdempotent('compute', ['url-maps', 'describe', urlMap, `--project=${projectId}`],
    () => exec('gcloud', [
      'compute', 'url-maps', 'create', urlMap,
      `--default-service=${backend}`,
      `--project=${projectId}`,
    ]));

  // 4) Managed cert
  console.log(`▶ Google マネージド証明書を作成: ${certName} (${domain})`);
  await runIdempotent('compute', ['ssl-certificates', 'describe', certName, '--global', `--project=${projectId}`],
    () => exec('gcloud', [
      'compute', 'ssl-certificates', 'create', certName,
      '--global',
      `--domains=${domain}`,
      `--project=${projectId}`,
    ]));

  // 5) HTTPS proxy
  const httpsProxy = `${lbName}-https-proxy`;
  console.log(`▶ HTTPS target proxy を作成: ${httpsProxy}`);
  await runIdempotent('compute', ['target-https-proxies', 'describe', httpsProxy, `--project=${projectId}`],
    () => exec('gcloud', [
      'compute', 'target-https-proxies', 'create', httpsProxy,
      `--url-map=${urlMap}`,
      `--ssl-certificates=${certName}`,
      `--project=${projectId}`,
    ]));

  // 6) Reserve static IP
  console.log(`▶ 静的 IP を確保: ${ipName}`);
  await runIdempotent('compute', ['addresses', 'describe', ipName, '--global', `--project=${projectId}`],
    () => exec('gcloud', [
      'compute', 'addresses', 'create', ipName,
      '--global',
      '--ip-version=IPV4',
      `--project=${projectId}`,
    ]));

  // 7) Forwarding rule
  const fwRule = `${lbName}-fw-https`;
  console.log(`▶ HTTPS フォワーディング ルールを作成: ${fwRule}`);
  await runIdempotent('compute', ['forwarding-rules', 'describe', fwRule, '--global', `--project=${projectId}`],
    () => exec('gcloud', [
      'compute', 'forwarding-rules', 'create', fwRule,
      '--load-balancing-scheme=EXTERNAL_MANAGED',
      '--global',
      `--target-https-proxy=${httpsProxy}`,
      `--address=${ipName}`,
      '--ports=443',
      `--project=${projectId}`,
    ]));

  const ipResult = await exec(
    'gcloud',
    ['compute', 'addresses', 'describe', ipName, '--global', `--project=${projectId}`, '--format=value(address)'],
    { captureOutput: true },
  );
  const ip = ipResult.stdout.trim();
  console.log('');
  console.log('✅ ロードバランサ構成完了');
  console.log(`   IP: ${ip}`);
  console.log('');
  console.log('▶ DNS で対象ドメインの A レコードを上記 IP に向けてください:');
  console.log(`   ${domain}   A   ${ip}`);
  console.log('');
  console.log('▶ DNS 反映後、Google マネージド証明書がプロビジョニングされます（最大 60 分）');
  console.log('▶ ステータスは下記で確認:');
  console.log(`   gcloud compute ssl-certificates describe ${certName} --global --project=${projectId}`);
}

async function runIdempotent(group, describeArgs, createFn) {
  const r = await exec('gcloud', [group, ...describeArgs], { captureOutput: true, allowFail: true });
  if (r.code === 0) {
    console.log('   既に存在 → スキップ');
    return;
  }
  await createFn();
}

async function main() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (!existsSync(envPath)) fail('.env が見つかりません');

  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) fail('GCP_PROJECT_ID が .env で未設定');
  const region = process.env.GCP_REGION || 'asia-northeast1';
  const service = process.env.CLOUD_RUN_SERVICE_NAME || 'kasan-manager';

  const args = parseArgs(process.argv);
  const domain = args.domain || process.env.CLOUD_RUN_CUSTOM_DOMAIN;
  if (!domain || domain === true) fail('--domain=<ドメイン名> を指定してください');
  const mode = (args.mode || 'mapping').toLowerCase();

  console.log(`▶ プロジェクト: ${projectId} / リージョン: ${region} / サービス: ${service}`);
  console.log(`▶ ドメイン: ${domain} / モード: ${mode}`);
  console.log('');

  if (mode === 'mapping') {
    await setupMapping({ projectId, region, service, domain });
  } else if (mode === 'loadbalancer' || mode === 'lb') {
    const slug = service.replace(/[^a-z0-9-]/g, '-');
    const lbName = process.env.CLOUD_RUN_LB_NAME || `${slug}-lb`;
    const ipName = process.env.CLOUD_RUN_LB_IP_NAME || `${slug}-lb-ip`;
    const certName = process.env.CLOUD_RUN_LB_CERT_NAME || `${slug}-lb-cert`;
    const negName = process.env.CLOUD_RUN_LB_NEG_NAME || `${slug}-neg`;
    await setupLoadBalancer({ projectId, region, service, domain, lbName, ipName, certName, negName });
  } else {
    fail(`不明な mode: ${mode}（mapping または loadbalancer を指定）`);
  }
}

main().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
