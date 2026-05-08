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
import { existsSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { config as dotenvConfig } from 'dotenv';
import { execCommand, ensureInstalled } from './_lib.js';

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

const exec = (cmd, args, opts = {}) => execCommand(cmd, args, { cwd: PROJECT_ROOT, ...opts });

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

async function ensureGcloud() {
  await ensureInstalled('gcloud', 'https://cloud.google.com/sdk/docs/install');
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

// .env から Cloud Run へ転送する環境変数のキー一覧。
// プレフィックスマッチで「サーバが見るかもしれない値」を全部拾う。
// ただし GCP デプロイ用の値（GCP_* / CLOUD_RUN_* / KASAN_DEFAULT_CPOS_BASE_URL は転送するが
// CLOUD_RUN_MEMORY 等のデプロイ専用値は除外する）は別途 EXCLUDE_KEYS で除外。
const FORWARD_PREFIXES = ['KASAN_', 'CPOS_', 'RECAPTCHA_', 'RATE_LIMIT_', 'GEMINI_'];
const FORWARD_EXACT = new Set([
  'NODE_ENV',
  'TRUST_PROXY',
  'MAX_UPLOAD_BYTES',
  'HOST',
  // PORT は Cloud Run 側が固定なので転送しない
]);
const EXCLUDE_KEYS = new Set([
  // GCP のデプロイ設定はサーバ実行時に不要
  'GCP_PROJECT_ID',
  'GCP_REGION',
  'GCP_ARTIFACT_REPO',
  'CLOUD_RUN_SERVICE_NAME',
  'CLOUD_RUN_MEMORY',
  'CLOUD_RUN_CPU',
  'CLOUD_RUN_MIN_INSTANCES',
  'CLOUD_RUN_MAX_INSTANCES',
  'CLOUD_RUN_SECRET_NAME',
  'CLOUD_RUN_CUSTOM_DOMAIN',
  'CLOUD_RUN_LB_NAME',
  'CLOUD_RUN_LB_IP_NAME',
  'CLOUD_RUN_LB_CERT_NAME',
  'CLOUD_RUN_LB_NEG_NAME',
  // PORT は Cloud Run が自動で 8080 を割り当てる
  'PORT',
]);

// .env で空文字や placeholder（「your-...」「<...>」）の値は転送しない
function isMeaningfulValue(value) {
  if (value == null) return false;
  const s = String(value).trim();
  if (s === '') return false;
  if (/^your-/.test(s)) return false;
  if (/^<.+>$/.test(s)) return false;
  return true;
}

function collectForwardedEnv() {
  const result = { NODE_ENV: 'production' };
  for (const [k, v] of Object.entries(process.env)) {
    if (EXCLUDE_KEYS.has(k)) continue;
    if (!isMeaningfulValue(v)) continue;
    const matches = FORWARD_PREFIXES.some((p) => k.startsWith(p)) || FORWARD_EXACT.has(k);
    if (!matches) continue;
    result[k] = String(v);
  }
  // GEMINI_MODEL が未指定なら既定を入れる（サーバ側にも既定はあるが明示）
  if (!result.GEMINI_MODEL) result.GEMINI_MODEL = 'gemini-2.5-flash';
  return result;
}

// gcloud --env-vars-file で読める YAML を組み立てる。値に改行やコロンが入っても安全に扱う。
function toEnvVarsYaml(env) {
  const lines = [];
  for (const [k, v] of Object.entries(env)) {
    // 値は常にダブルクォートで囲み、内部の " と \ をエスケープ
    const escaped = String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    lines.push(`${k}: "${escaped}"`);
  }
  return `${lines.join('\n')}\n`;
}

function summarizeEnvForLog(env) {
  // 機密値はマスクしてログに出す
  const SECRET_KEYS = ['GEMINI_API_KEY', 'KASAN_SESSION_SECRET', 'RECAPTCHA_SECRET_KEY'];
  const view = {};
  for (const [k, v] of Object.entries(env)) {
    if (SECRET_KEYS.some((s) => k.includes(s))) {
      view[k] = `${String(v).slice(0, 4)}...***（${String(v).length}文字）`;
    } else {
      view[k] = v;
    }
  }
  return view;
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

async function deploy({ projectId, region, service, image, memory, cpu, min, max }) {
  console.log(`▶ Cloud Run へデプロイ: ${service}（${region}）`);

  // .env の KASAN_* / CPOS_* / RECAPTCHA_* / RATE_LIMIT_* / GEMINI_* を Cloud Run へ転送
  const envVars = collectForwardedEnv();
  console.log('▶ Cloud Run に転送する環境変数（機密値はマスク）:');
  for (const [k, v] of Object.entries(summarizeEnvForLog(envVars))) {
    console.log(`     ${k}=${v}`);
  }

  // YAML を一時ファイルに書き出して --env-vars-file で渡す
  // （--set-env-vars はカンマ区切りで、値にカンマや改行があると壊れるため YAML を使う）
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'kasan-env-'));
  const envFile = path.join(tmpDir, 'env.yaml');
  writeFileSync(envFile, toEnvVarsYaml(envVars), { mode: 0o600 });
  try {
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
      `--env-vars-file=${envFile}`,
      // 旧バージョンに残存していた Secret マウントを削除（.env ベースに統一）
      '--clear-secrets',
    ]);
  } finally {
    // 機密を含むファイルなので必ず削除
    try { unlinkSync(envFile); } catch {}
  }

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
    projectId, region, service, image, memory, cpu, min, max,
  });
}

main().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
