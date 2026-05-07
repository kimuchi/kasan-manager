#!/usr/bin/env node
// 加算マネージャー Web版 → Cloud Run デプロイスクリプト（Node.js 版）
//
// このスクリプトは:
//   1) `.env` から GEMINI_API_KEY と GCP 関連の値を読み込み
//   2) Cloud Build または ローカル docker でイメージをビルド & push
//   3) `gcloud run deploy` で Cloud Run へデプロイし、`.env` の値を環境変数として渡す
//
// 使い方:
//   npm run deploy:cloudrun         # Cloud Build を使ってビルド & push、その後 deploy
//   npm run deploy:cloudrun:local   # ローカル docker build → push、その後 deploy
//   npm run deploy:cloudrun -- --skip-build  # ビルドせず、最新イメージで env 更新だけ実行
//
// 必要なツール: gcloud (認証済み), docker (--mode=local 時のみ)
// 必要な事前準備:
//   1) ルート直下の .env を作成（.env.example をコピー）
//   2) GCP_PROJECT_ID / GCP_REGION / CLOUD_RUN_SERVICE_NAME / GEMINI_API_KEY を設定
//   3) `npm run setup:gcp` で API 有効化と Artifact Registry を作成済み

import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as dotenvConfig } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(APP_ROOT, '..');

// PROJECT_ROOT 直下の .env を再読込（dotenv はカレント依存）
dotenvConfig({ path: path.join(PROJECT_ROOT, '.env'), override: true });

function parseFlags(argv) {
  const out = { mode: 'cloudbuild', skipBuild: false };
  for (const a of argv.slice(2)) {
    if (a === 'local' || a === '--local' || a === '--mode=local') out.mode = 'local';
    else if (a === 'cloudbuild' || a === '--cloudbuild') out.mode = 'cloudbuild';
    else if (a === '--skip-build') out.skipBuild = true;
  }
  return out;
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

async function ensureRepo({ repo, region, projectId }) {
  const r = await exec(
    'gcloud',
    ['artifacts', 'repositories', 'describe', repo, '--location', region, '--project', projectId],
    { captureOutput: true, allowFail: true },
  );
  if (r.code !== 0) {
    console.log(`▶ Artifact Registry リポジトリを作成: ${repo}（${region}）`);
    await exec('gcloud', [
      'artifacts', 'repositories', 'create', repo,
      '--repository-format=docker',
      `--location=${region}`,
      `--project=${projectId}`,
      '--description=kasan-manager web container',
    ]);
  }
}

function ts() {
  return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}

function buildEnvVars({ geminiKey, geminiModel, extraEnv }) {
  // gcloud --set-env-vars はカンマ区切りなので、値にカンマが含まれていないか検証
  const pairs = [
    ['NODE_ENV', 'production'],
    ['GEMINI_MODEL', geminiModel],
    ['GEMINI_API_KEY', geminiKey],
    ...Object.entries(extraEnv || {}),
  ];
  for (const [k, v] of pairs) {
    if (v == null) continue;
    if (String(v).includes(',')) {
      fail(`環境変数 ${k} の値にカンマが含まれています。--set-env-vars はカンマ区切りのため使用不可です。`);
    }
  }
  return pairs.filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join(',');
}

async function buildAndPushViaCloudBuild({ projectId, region, repo, service }) {
  const tag = ts();
  const image = `${region}-docker.pkg.dev/${projectId}/${repo}/${service}:${tag}`;
  console.log(`▶ Cloud Build でビルド & push: ${image}`);
  await exec('gcloud', [
    'builds', 'submit',
    '--project', projectId,
    '--config', 'cloudbuild.yaml',
    `--substitutions=_REGION=${region},_REPO=${repo},_SERVICE=${service},_TAG=${tag}`,
  ]);
  return image;
}

async function buildAndPushLocally({ projectId, region, repo, service }) {
  const tag = ts();
  const image = `${region}-docker.pkg.dev/${projectId}/${repo}/${service}:${tag}`;
  const latest = `${region}-docker.pkg.dev/${projectId}/${repo}/${service}:latest`;
  console.log(`▶ ローカル docker build & push: ${image}`);
  await exec('gcloud', ['auth', 'configure-docker', `${region}-docker.pkg.dev`, '--quiet']);
  await exec('docker', ['build', '-t', image, '-t', latest, '.']);
  await exec('docker', ['push', image]);
  await exec('docker', ['push', latest]);
  return image;
}

async function getLatestImage({ projectId, region, repo, service }) {
  const r = await exec(
    'gcloud',
    [
      'artifacts', 'docker', 'images', 'list',
      `${region}-docker.pkg.dev/${projectId}/${repo}/${service}`,
      '--include-tags',
      '--sort-by=~UPDATE_TIME',
      '--limit=1',
      '--format=value(version)',
      `--project=${projectId}`,
    ],
    { captureOutput: true, allowFail: true },
  );
  if (r.code !== 0 || !r.stdout.trim()) return null;
  const digest = r.stdout.trim();
  return `${region}-docker.pkg.dev/${projectId}/${repo}/${service}@${digest}`;
}

async function deploy({ projectId, region, service, image, memory, cpu, min, max, geminiKey, geminiModel }) {
  console.log(`▶ Cloud Run へデプロイ: ${service}（${region}）`);
  // GEMINI_API_KEY は --set-env-vars で渡す（.env ベース運用）
  // ※ 値はコマンドライン引数として spawn() に直接渡すため、シェル履歴・echo 等には残らない
  const envVars = buildEnvVars({ geminiKey, geminiModel });
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
    `--set-env-vars=${envVars}`,
    // 旧バージョンに残存していた Secret マウントを削除（.env ベースに統一）
    '--clear-secrets',
  ]);
  const url = await exec(
    'gcloud',
    ['run', 'services', 'describe', service, '--region', region, '--project', projectId, '--format=value(status.url)'],
    { captureOutput: true },
  );
  console.log('');
  console.log(`✅ デプロイ完了: ${url.stdout.trim()}`);
}

async function main() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (!existsSync(envPath)) {
    fail(
      `.env が見つかりません（${envPath}）。\n   .env.example をコピーして作成してください: cp .env.example .env`,
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
  const geminiKey = process.env.GEMINI_API_KEY;
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  if (!geminiKey || geminiKey === 'your-gemini-api-key-here') {
    fail(
      `.env の GEMINI_API_KEY が未設定です。\n` +
      `   Google AI Studio で発行したキーを .env に書き込んでください:\n` +
      `   https://aistudio.google.com/app/apikey`,
    );
  }

  const flags = parseFlags(process.argv);

  console.log(`▶ プロジェクト: ${projectId} / リージョン: ${region} / サービス: ${service}`);
  console.log(`▶ Artifact Registry リポジトリ: ${repo}`);
  console.log(`▶ ビルドモード: ${flags.skipBuild ? 'skip-build（既存イメージで再デプロイ）' : flags.mode}`);

  await ensureGcloud();
  await exec('gcloud', ['config', 'set', 'project', projectId], { captureOutput: true });
  await ensureRepo({ repo, region, projectId });

  let image;
  if (flags.skipBuild) {
    image = await getLatestImage({ projectId, region, repo, service });
    if (!image) {
      fail('--skip-build を指定しましたが Artifact Registry に既存イメージが見つかりません。先に通常ビルドしてください。');
    }
    console.log(`▶ 既存イメージを再利用: ${image}`);
  } else if (flags.mode === 'local') {
    image = await buildAndPushLocally({ projectId, region, repo, service });
  } else {
    image = await buildAndPushViaCloudBuild({ projectId, region, repo, service });
  }

  await deploy({
    projectId, region, service, image,
    memory, cpu, min, max, geminiKey, geminiModel,
  });
}

main().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
