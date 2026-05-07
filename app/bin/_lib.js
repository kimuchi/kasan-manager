// 全 bin スクリプトで使う共通 exec ユーティリティ。
//
// Windows の問題を 1 ライブラリで解決するため cross-spawn を使う:
//   1) PATHEXT 解決 (gcloud → gcloud.cmd) を Node の spawn は行わない
//   2) Node 18.20.2+/20.12.2+/21.7.2+ では .cmd/.bat を shell: true 無しで
//      spawn すると EINVAL を投げる（CVE-2024-27980 対策）
//   3) cmd.exe での引数エスケープ
// cross-spawn は 上記すべてを自動でハンドルする。

import crossSpawn from 'cross-spawn';

// 共通 exec ヘルパー。各 bin スクリプトの spawn ラッパーとして使う。
//
// opts:
//   captureOutput  bool   stdout/stderr を文字列で返す（インライン処理用）
//   stdin          string 子プロセスの stdin に書き込む（Secret 登録等）
//   allowFail      bool   非ゼロ終了でも reject せずに code を返す
//   cwd            string 実行カレント
//   env            object 追加の環境変数
export async function execCommand(cmd, args, opts = {}) {
  const useStdin = typeof opts.stdin === 'string';

  let stdio;
  if (opts.captureOutput) stdio = ['ignore', 'pipe', 'pipe'];
  else if (useStdin) stdio = ['pipe', 'inherit', 'inherit'];
  else stdio = 'inherit';

  return new Promise((resolve, reject) => {
    const child = crossSpawn(cmd, args, {
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
      if (err.code === 'ENOENT') {
        reject(new Error(
          `${cmd} コマンドが見つかりません（spawn ENOENT）。\n` +
          `   ${cmd} がインストールされていて PATH に通っているか確認してください。\n` +
          (cmd === 'gcloud'
            ? `   Windows の場合は Google Cloud SDK を https://cloud.google.com/sdk/docs/install からインストールし、\n` +
              `   インストーラ最後の "Add gcloud to PATH" にチェックを入れてください。\n` +
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
