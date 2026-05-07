#!/usr/bin/env node
// 加算マネージャー Cloud Run 初回プロビジョニング
//
// このスクリプトは GCP プロジェクトを Cloud Run へ初めてデプロイする際に必要な
// 1) API の有効化
// 2) Artifact Registry リポジトリの作成
// 3) Secret Manager に GEMINI_API_KEY を登録（既存値があればスキップ）
// 4) Cloud Build の Cloud Run デプロイ権限の付与
// を冪等に実行する。.env を読み込むため、先に `.env` を作成しておくこと。
//
// 使い方:
//   npm run setup:gcp
//   npm run setup:gcp -- --gemini-key=<api-key>     # Secret 登録もまとめて
//   npm run setup:gcp -- --skip-secret              # Secret 登録は別途手動

import 'dotenv/config';
import { spawn } from 'node:child_process';
import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
dotenvConfig({ path: path.join(PROJECT_ROOT, '.env'), override: true });

const REQUIRED_APIS = [
  'run.googleapis.com',
  'cloudbuild.googleapis.com',
  'artifactregistry.googleapis.com',
  'secretmanager.googleapis.com',
  'iamcredentials.googleapis.com',
  'compute.googleapis.com', // ロードバランサ経由の独自ドメインで使用
];

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

async function exec(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: opts.captureOutput ? ['ignore', 'pipe', 'pipe'] : (opts.stdin ? ['pipe', 'inherit', 'inherit'] : 'inherit'),
      cwd: opts.cwd || PROJECT_ROOT,
      env: { ...process.env, ...(opts.env || {}) },
    });
    let stdout = '';
    let stderr = '';
    if (opts.captureOutput) {
      child.stdout.on('data', (b) => { stdout += b.toString(); });
      child.stderr.on('data', (b) => { stderr += b.toString(); });
    }
    if (opts.stdin) {
      child.stdin.write(opts.stdin);
      child.stdin.end();
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
  const r = await exec('gcloud', ['--version'], { captureOutput: true, allowFail: true });
  if (r.code) fail('gcloud CLI が見つかりません。https://cloud.google.com/sdk/docs/install から導入してください。');
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

async function enableApis(projectId) {
  console.log('▶ 必須 API を有効化（既に有効ならスキップされます）');
  await exec('gcloud', ['services', 'enable', ...REQUIRED_APIS, '--project', projectId]);
  console.log(`   有効化対象: ${REQUIRED_APIS.join(', ')}`);
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

async function ensureSecret({ secretName, projectId, geminiKey, skipSecret }) {
  if (skipSecret) {
    console.log('▶ --skip-secret 指定により Secret Manager の処理をスキップ');
    return;
  }
  const exists = await exec('gcloud', ['secrets', 'describe', secretName, '--project', projectId], {
    captureOutput: true,
    allowFail: true,
  });
  if (exists.code !== 0) {
    console.log(`▶ Secret Manager に "${secretName}" を作成`);
    await exec('gcloud', [
      'secrets', 'create', secretName,
      '--replication-policy=automatic',
      `--project=${projectId}`,
    ]);
  } else {
    console.log(`▶ Secret Manager に "${secretName}" 既に存在`);
  }

  let key = geminiKey;
  if (!key) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const ans = (await rl.question(
      `Gemini API キーを今すぐ Secret Manager に保存しますか？ (空 Enter でスキップ): `,
    )).trim();
    rl.close();
    if (!ans) {
      console.log('   Secret 登録をスキップしました。後で `gcloud secrets versions add` で登録してください。');
      return;
    }
    key = ans;
  }
  console.log('▶ Secret に新しいバージョンを登録');
  await exec(
    'gcloud',
    ['secrets', 'versions', 'add', secretName, '--data-file=-', '--project', projectId],
    { stdin: key },
  );
}

async function grantCloudBuildRoles({ projectId, projectNumber, secretName }) {
  // Cloud Build SA に Cloud Run / SA User / Secret アクセス権を付与
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

  // Secret アクセス権（Cloud Run の実行 SA = compute SA に付与）
  const secretAccessor = await exec(
    'gcloud',
    [
      'secrets', 'add-iam-policy-binding', secretName,
      `--member=serviceAccount:${computeServiceAccount}`,
      '--role=roles/secretmanager.secretAccessor',
      '--project', projectId,
    ],
    { captureOutput: true, allowFail: true },
  );
  if (secretAccessor.code !== 0) {
    console.warn(`   ⚠️  Secret アクセス権の付与に失敗。デプロイ後に Cloud Run が Secret を参照できない場合は手動で付与してください: ${secretAccessor.stderr.trim()}`);
  } else {
    console.log(`   Secret 読み取り権限を ${computeServiceAccount} に付与済`);
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
  const secretName = process.env.CLOUD_RUN_SECRET_NAME || 'gemini-api-key';

  const args = parseArgs(process.argv);

  console.log(`▶ プロジェクト: ${projectId} / リージョン: ${region}`);

  await ensureGcloud();
  await ensureLoggedIn();
  await exec('gcloud', ['config', 'set', 'project', projectId], { captureOutput: true });
  const projectNumber = await getProjectNumber(projectId);
  console.log(`▶ プロジェクト番号: ${projectNumber}`);

  await enableApis(projectId);
  await ensureRepo({ repo, region, projectId });
  await ensureSecret({
    secretName,
    projectId,
    geminiKey: typeof args['gemini-key'] === 'string' ? args['gemini-key'] : null,
    skipSecret: Boolean(args['skip-secret']),
  });
  await grantCloudBuildRoles({ projectId, projectNumber, secretName });

  console.log('');
  console.log('✅ プロビジョニング完了。次のコマンドでデプロイできます:');
  console.log('   npm run deploy:cloudrun');
  console.log('');
  console.log('カスタムドメインを設定する場合は:');
  console.log('   npm run setup:domain -- --domain=kasan.example.jp');
}

main().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
