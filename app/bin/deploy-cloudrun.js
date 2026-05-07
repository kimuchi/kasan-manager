#!/usr/bin/env node
// 加算マネージャー Web版 → Cloud Run デプロイスクリプト（Node.js 版）
//
// 使い方:
//   npm run deploy:cloudrun         # Cloud Build を使ってフルデプロイ
//   npm run deploy:cloudrun -- local   # ローカル docker build → push → deploy
//
// 必要なツール: gcloud (認証済み), docker (--mode=local 時のみ)
// 必要な事前準備:
//   1) ルート直下の .env を作成（.env.example をコピー）
//   2) GCP_PROJECT_ID / GCP_REGION / CLOUD_RUN_SERVICE_NAME を設定
//   3) Gemini API キーを Secret Manager に登録（推奨）:
//        gcloud secrets create gemini-api-key --replication-policy=automatic
//        printf '%s' "<api-key>" | gcloud secrets versions add gemini-api-key --data-file=-

import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(APP_ROOT, '..');

// .env を PROJECT_ROOT 直下から再読込（dotenv は cwd 依存）
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: path.join(PROJECT_ROOT, '.env'), override: true });

function getMode(argv) {
  for (const a of argv.slice(2)) {
    if (a === 'local' || a === '--local' || a === '--mode=local') return 'local';
    if (a === 'cloudbuild' || a === '--cloudbuild') return 'cloudbuild';
  }
  return 'cloudbuild';
}

async function exec(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: opts.captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      cwd: opts.cwd || PROJECT_ROOT,
      env: { ...process.env, ...(opts.env || {}) },
    });
    let stdout = '';
    let stderr = '';
    if (opts.captureOutput) {
      child.stdout.on('data', (b) => { stdout += b.toString(); });
      child.stderr.on('data', (b) => { stderr += b.toString(); });
    }
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else if (opts.allowFail) resolve({ stdout, stderr, code });
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}\n${stderr}`));
    });
  });
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

async function ensureGcloud() {
  try {
    await exec('gcloud', ['--version'], { captureOutput: true });
  } catch {
    fail('gcloud CLI が見つかりません。https://cloud.google.com/sdk/docs/install から導入してください。');
  }
}

async function ensureRepo({ repo, region }) {
  const r = await exec(
    'gcloud',
    ['artifacts', 'repositories', 'describe', repo, '--location', region],
    { captureOutput: true, allowFail: true },
  );
  if (r.code !== 0) {
    console.log(`▶ Artifact Registry リポジトリを作成: ${repo}（${region}）`);
    await exec('gcloud', [
      'artifacts', 'repositories', 'create', repo,
      '--repository-format=docker',
      `--location=${region}`,
      '--description=kasan-manager web container',
    ]);
  }
}

async function ensureSecret({ secretName }) {
  const r = await exec('gcloud', ['secrets', 'describe', secretName], {
    captureOutput: true,
    allowFail: true,
  });
  if (r.code !== 0) {
    fail(
      `Secret Manager に "${secretName}" が見つかりません。\n` +
      `  先に下記コマンドで登録してください:\n` +
      `    gcloud secrets create ${secretName} --replication-policy=automatic\n` +
      `    printf '%s' "<api-key>" | gcloud secrets versions add ${secretName} --data-file=-`,
    );
  }
}

function ts() {
  return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}

async function deployCloudBuild({ projectId, region, repo, service, secret, memory, cpu, min, max, model }) {
  console.log('▶ Cloud Build でビルド & デプロイ');
  await exec('gcloud', [
    'builds', 'submit',
    '--project', projectId,
    '--config', 'cloudbuild.yaml',
    `--substitutions=_REGION=${region},_REPO=${repo},_SERVICE=${service},_GEMINI_SECRET_NAME=${secret},_MEMORY=${memory},_CPU=${cpu},_MIN_INSTANCES=${min},_MAX_INSTANCES=${max}`,
  ]);
  const url = await exec(
    'gcloud',
    ['run', 'services', 'describe', service, '--region', region, '--project', projectId, '--format=value(status.url)'],
    { captureOutput: true },
  );
  console.log(`✅ デプロイ完了: ${url.stdout.trim()}`);
}

async function deployLocal({ projectId, region, repo, service, secret, memory, cpu, min, max, model }) {
  const tag = ts();
  const image = `${region}-docker.pkg.dev/${projectId}/${repo}/${service}:${tag}`;
  const latest = `${region}-docker.pkg.dev/${projectId}/${repo}/${service}:latest`;
  console.log(`▶ ローカルで docker build → push → deploy: ${image}`);
  await exec('gcloud', ['auth', 'configure-docker', `${region}-docker.pkg.dev`, '--quiet']);
  await exec('docker', ['build', '-t', image, '-t', latest, '.']);
  await exec('docker', ['push', image]);
  await exec('docker', ['push', latest]);

  console.log('▶ Cloud Run へデプロイ');
  await exec('gcloud', [
    'run', 'deploy', service,
    `--image=${image}`,
    '--project', projectId,
    `--region=${region}`,
    '--platform=managed',
    '--allow-unauthenticated',
    `--memory=${memory}`,
    `--cpu=${cpu}`,
    `--min-instances=${min}`,
    `--max-instances=${max}`,
    '--port=8080',
    `--set-env-vars=NODE_ENV=production,GEMINI_MODEL=${model}`,
    `--update-secrets=GEMINI_API_KEY=${secret}:latest`,
  ]);
  const url = await exec(
    'gcloud',
    ['run', 'services', 'describe', service, '--region', region, '--project', projectId, '--format=value(status.url)'],
    { captureOutput: true },
  );
  console.log(`✅ デプロイ完了: ${url.stdout.trim()}`);
}

async function main() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (!existsSync(envPath)) {
    fail(
      `.env が見つかりません（${envPath}）。\n` +
      `   .env.example をコピーして作成してください:\n` +
      `     cp .env.example .env`,
    );
  }

  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) fail('GCP_PROJECT_ID が .env で未設定です');
  const region = process.env.GCP_REGION || 'asia-northeast1';
  const service = process.env.CLOUD_RUN_SERVICE_NAME || 'kasan-manager';
  const repo = process.env.GCP_ARTIFACT_REPO || 'kasan-manager';
  const memory = process.env.CLOUD_RUN_MEMORY || '1Gi';
  const cpu = process.env.CLOUD_RUN_CPU || '1';
  const min = process.env.CLOUD_RUN_MIN_INSTANCES || '0';
  const max = process.env.CLOUD_RUN_MAX_INSTANCES || '3';
  const secret = process.env.CLOUD_RUN_SECRET_NAME || 'gemini-api-key';
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  console.log(`▶ プロジェクト: ${projectId} / リージョン: ${region} / サービス: ${service}`);
  console.log(`▶ Artifact Registry リポジトリ: ${repo}`);

  await ensureGcloud();
  await exec('gcloud', ['config', 'set', 'project', projectId], { captureOutput: true });
  await ensureRepo({ repo, region });
  await ensureSecret({ secretName: secret });

  const mode = getMode(process.argv);
  const params = { projectId, region, repo, service, secret, memory, cpu, min, max, model };
  if (mode === 'local') await deployLocal(params);
  else await deployCloudBuild(params);
}

main().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
