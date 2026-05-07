// 全 bin スクリプトで使う共通 exec ユーティリティ。
// Windows では gcloud / npm 等の実体が .cmd / .bat なので、Node の spawn が
// PATHEXT を見ない問題に対処する（spawn ENOENT エラーの修正）。

import { spawn } from 'node:child_process';

const IS_WINDOWS = process.platform === 'win32';

// Windows で .cmd / .bat 拡張子が必要な CLI を解決する
const WIN_EXT_MAP = {
  gcloud: '.cmd',
  npm: '.cmd',
  npx: '.cmd',
  node: '.exe',
  // docker と git は通常 .exe で PATH 解決されるが念のため
  docker: '.exe',
  git: '.exe',
};

export function resolveCommand(cmd) {
  if (!IS_WINDOWS) return cmd;
  // 既に拡張子が付いていればそのまま
  if (/\.(cmd|bat|exe|ps1)$/i.test(cmd)) return cmd;
  const ext = WIN_EXT_MAP[cmd];
  return ext ? `${cmd}${ext}` : cmd;
}

// 共通 exec ヘルパー。各 bin スクリプトの重複した spawn ラッパーを置き換える。
//
// opts:
//   captureOutput  bool   stdout/stderr を文字列で返す（インライン処理用）
//   stdin          string 子プロセスの stdin に書き込む（Secret 登録等）
//   allowFail      bool   非ゼロ終了でも reject せずに code を返す
//   cwd            string 実行カレント
//   env            object 追加の環境変数
//   inherit        bool   stdio: 'inherit' を強制（既定は captureOutput / stdin で自動判定）
export async function execCommand(cmd, args, opts = {}) {
  const resolved = resolveCommand(cmd);
  const useStdin = typeof opts.stdin === 'string';

  let stdio;
  if (opts.captureOutput) stdio = ['ignore', 'pipe', 'pipe'];
  else if (useStdin) stdio = ['pipe', 'inherit', 'inherit'];
  else stdio = 'inherit';

  return new Promise((resolve, reject) => {
    const child = spawn(resolved, args, {
      stdio,
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}) },
    });

    let stdout = '';
    let stderr = '';
    if (opts.captureOutput) {
      child.stdout.on('data', (b) => { stdout += b.toString(); });
      child.stderr.on('data', (b) => { stderr += b.toString(); });
    }
    if (useStdin) {
      child.stdin.write(opts.stdin);
      child.stdin.end();
    }

    child.on('error', (err) => {
      // ENOENT (コマンド未インストール) を分かりやすいメッセージで包む
      if (err.code === 'ENOENT') {
        reject(new Error(
          `${cmd} コマンドが見つかりません（spawn ENOENT）。\n` +
          `   ${cmd} がインストールされていて PATH に通っているか確認してください。\n` +
          (cmd === 'gcloud'
            ? `   Windows の場合は Google Cloud SDK を https://cloud.google.com/sdk/docs/install からインストールし、\n` +
              `   インストーラ最後の "Run gcloud init" にチェックを入れて PATH を通してください。\n` +
              `   インストール後は PowerShell / ターミナルを再起動してください（PATH 更新を反映するため）。`
            : ''),
        ));
        return;
      }
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code: 0 });
      } else if (opts.allowFail) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(
          `${cmd} ${args.join(' ')} exited with code ${code}\n${stderr}`,
        ));
      }
    });
  });
}

// インストール状況をチェックして、なければ親切なメッセージで終了
export async function ensureInstalled(cmd, helpUrl) {
  try {
    await execCommand(cmd, ['--version'], { captureOutput: true });
  } catch (err) {
    if (err.message.includes('ENOENT') || err.message.includes('見つかりません')) {
      console.error(`❌ ${cmd} CLI が見つかりません`);
      if (helpUrl) console.error(`   インストール: ${helpUrl}`);
      console.error('   インストール後は PowerShell / ターミナルを再起動してから再度お試しください。');
      process.exit(1);
    }
    throw err;
  }
}
