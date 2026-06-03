#!/usr/bin/env node
// 加算マネージャー Cloud Run 初回プロビジョニング
//
// このスクリプトは GCP プロジェクトを Cloud Run へ初めてデプロイする際に必要な
// 1) API の有効化
// 2) Artifact Registry リポジトリの作成
// 3) Cloud Build SA に Cloud Run / Artifact Registry の権限を付与
// を冪等に実行する。.env を読み込むため、先に `.env` を作成しておくこと。
//
// 本構成では GEMINI_API_KEY は `.env` で管理し、`npm run deploy:cloudrun` 実行時に
// `gcloud run deploy --set-env-vars=GEMINI_API_KEY=...` で Cloud Run へ渡す。
// Secret Manager は使わない（必要なら --use-secret で従来挙動）。
//
// 使い方:
//   npm run setup:gcp                       # API 有効化 + Artifact Registry + IAM
//   npm run setup:gcp -- --use-secret       # Secret Manager 連携を併用したい場合

import 'dotenv/config';
import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { execCommand, ensureInstalled } from './_lib.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
dotenvConfig({ path: path.join(PROJECT_ROOT, '.env'), override: true });

const REQUIRED_APIS = [
  'run.googleapis.com',
  'cloudbuild.googleapis.com',
  'artifactregistry.googleapis.com',
  'iamcredentials.googleapis.com',
  'compute.googleapis.com', // ロードバランサ経由の独自ドメインで使用
];
const SECRET_MANAGER_API = 'secretmanager.googleapis.com';

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

async function ensureGcloud() {
  await ensureInstalled('gcloud', 'https://cloud.google.com/sdk/docs/install');
}

async function ensureLoggedIn() {
  const r = await exec('gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'], {
    captureOutput: true,
  });
  if (!r.stdout.trim()) {
    fail('gcloud 認証セッションがありません。`gcloud auth login` を実行してから再度お試しください。');
  }
  console.log(`▶ アクティブ アカウント: ${r.stdout.trim()}`);
}

async function getProjectNumber(projectId) {
  const r = await exec('gcloud', ['projects', 'describe', projectId, '--format=value(projectNumber)'], {
    captureOutput: true,
  });
  return r.stdout.trim();
}

async function enableApis(projectId, includeSecret) {
  const apis = includeSecret ? [...REQUIRED_APIS, SECRET_MANAGER_API] : REQUIRED_APIS;
  console.log('▶ 必須 API を有効化（既に有効ならスキップされます）');
  await exec('gcloud', ['services', 'enable', ...apis, '--project', projectId]);
  console.log(`   有効化対象: ${apis.join(', ')}`);
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
  } else {
    console.log(`▶ Artifact Registry リポジトリ存在: ${repo}`);
  }
}

async function ensureSecretOptIn({ secretName, projectId, geminiKey }) {
  console.log('▶ Secret Manager 連携が要求されました（--use-secret）');
  const exists = await exec('gcloud', ['secrets', 'describe', secretName, '--project', projectId], {
    captureOutput: true,
    allowFail: true,
  });
  if (exists.code !== 0) {
    console.log(`   Secret "${secretName}" を作成`);
    await exec('gcloud', [
      'secrets', 'create', secretName,
      '--replication-policy=automatic',
      `--project=${projectId}`,
    ]);
  } else {
    console.log(`   Secret "${secretName}" 既に存在`);
  }

  let key = geminiKey;
  if (!key) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const ans = (await rl.question('   Gemini API キーを今すぐ Secret に保存しますか？ (空 Enter でスキップ): ')).trim();
    rl.close();
    if (!ans) {
      console.log('   Secret 登録をスキップしました。後で `gcloud secrets versions add` で登録してください。');
      return;
    }
    key = ans;
  }
  await exec(
    'gcloud',
    ['secrets', 'versions', 'add', secretName, '--data-file=-', '--project', projectId],
    { stdin: key },
  );
  console.log('   Secret に新しいバージョンを登録しました');
}

async function grantCloudBuildRoles({ projectId, projectNumber, includeSecret, secretName }) {
  const cbServiceAccount = `${projectNumber}@cloudbuild.gserviceaccount.com`;
  const computeServiceAccount = `${projectNumber}-compute@developer.gserviceaccount.com`;
  console.log(`▶ Cloud Build SA (${cbServiceAccount}) に Cloud Run デプロイ権限を付与`);

  const roles = [
    ['roles/run.admin', cbServiceAccount],
    ['roles/iam.serviceAccountUser', cbServiceAccount],
    ['roles/artifactregistry.writer', cbServiceAccount],
  ];
  for (const [role, sa] of roles) {
    const r = await exec(
      'gcloud',
      [
        'projects', 'add-iam-policy-binding', projectId,
        `--member=serviceAccount:${sa}`,
        `--role=${role}`,
        '--condition=None',
      ],
      { captureOutput: true, allowFail: true },
    );
    if (r.code !== 0) console.warn(`   ⚠️  ${role} の付与に失敗: ${r.stderr.trim()}`);
  }

  if (includeSecret) {
    const r = await exec(
      'gcloud',
      [
        'secrets', 'add-iam-policy-binding', secretName,
        `--member=serviceAccount:${computeServiceAccount}`,
        '--role=roles/secretmanager.secretAccessor',
        '--project', projectId,
      ],
      { captureOutput: true, allowFail: true },
    );
    if (r.code !== 0) {
      console.warn(`   ⚠️  Secret アクセス権の付与に失敗: ${r.stderr.trim()}`);
    } else {
      console.log(`   Secret 読み取り権限を ${computeServiceAccount} に付与済`);
    }
  }
}

async function main() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (!existsSync(envPath)) {
    fail(`.env が見つかりません（${envPath}）。\n   .env.example をコピーして編集してください: cp .env.example .env`);
  }
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) fail('GCP_PROJECT_ID が .env で未設定です');
  const region = process.env.GCP_REGION || 'asia-northeast1';
  const repo = process.env.GCP_ARTIFACT_REPO || 'kasan-manager';

  const args = parseArgs(process.argv);
  const useSecret = Boolean(args['use-secret']);
  const secretName = process.env.CLOUD_RUN_SECRET_NAME || 'gemini-api-key';

  console.log(`▶ プロジェクト: ${projectId} / リージョン: ${region}`);
  console.log(`▶ Gemini API キー管理: ${useSecret ? 'Secret Manager（--use-secret 指定）' : '.env による直接渡し'}`);

  await ensureGcloud();
  await ensureLoggedIn();
  await exec('gcloud', ['config', 'set', 'project', projectId], { captureOutput: true });
  const projectNumber = await getProjectNumber(projectId);
  console.log(`▶ プロジェクト番号: ${projectNumber}`);

  await enableApis(projectId, useSecret);
  await ensureRepo({ repo, region, projectId });
  if (useSecret) {
    const geminiKeyArg = typeof args['gemini-key'] === 'string' ? args['gemini-key'] : null;
    await ensureSecretOptIn({ secretName, projectId, geminiKey: geminiKeyArg });
  }
  await grantCloudBuildRoles({ projectId, projectNumber, includeSecret: useSecret, secretName });

  console.log('');
  console.log('✅ プロビジョニング完了。次のコマンドでデプロイできます:');
  console.log('   npm run deploy:cloudrun');
  console.log('');
  if (!useSecret) {
    console.log('ℹ  GEMINI_API_KEY は .env から読み込み、デプロイ時に Cloud Run の環境変数として渡されます。');
    console.log('   .env を最新の値にしてから deploy を実行してください。');
  } else {
    console.log('ℹ  Secret Manager 連携モードです。デプロイ時に --use-secret フラグを併用してください。');
  }
  console.log('');
  console.log('カスタムドメインを設定する場合は:');
  console.log('   npm run setup:domain -- --domain=kasan.example.jp');
}

main().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
