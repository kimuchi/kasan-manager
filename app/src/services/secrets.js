// Secret Manager 経由でシークレットを取得するヘルパー。
//
// 優先順位:
//   1. Secret Manager: KASAN_SECRET_*_NAME=projects/X/secrets/Y/versions/Z を env から読む
//   2. 環境変数（KASAN_SESSION_SECRET / GEMINI_API_KEY 等）の生値
//
// Cloud Run には Secret Manager 経由でマウントする運用と、.env 直書きの両方をサポート。
// 起動時に getSecret() を呼んで初期化する想定。
//
// 設計上の都合で、Secret Manager クライアントは遅延ロード（@google-cloud/secret-manager は重い）。

let smClient = null;

async function getClient() {
  if (smClient) return smClient;
  const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
  smClient = new SecretManagerServiceClient();
  return smClient;
}

const cache = new Map(); // key=name, value=string

// name は projects/X/secrets/Y/versions/Z 形式。
async function getSecretByName(name) {
  if (cache.has(name)) return cache.get(name);
  try {
    const client = await getClient();
    const [version] = await client.accessSecretVersion({ name });
    const payload = version.payload?.data?.toString('utf-8');
    if (typeof payload === 'string') {
      cache.set(name, payload);
      return payload;
    }
    return null;
  } catch (err) {
    console.warn(`[secrets] Secret Manager access failed for ${name}: ${err.message}`);
    return null;
  }
}

// envNameRef は "KASAN_SECRET_SESSION_NAME" のような env 変数名。
// fallbackEnv は "KASAN_SESSION_SECRET" のような env 変数名で、生値が入っている前提。
export async function getSecret(envNameRef, fallbackEnv) {
  const smName = process.env[envNameRef];
  if (smName) {
    const v = await getSecretByName(smName);
    if (v) return v;
    console.warn(
      `[secrets] ${envNameRef} は設定されているが Secret Manager 取得失敗。${fallbackEnv} にフォールバック。`,
    );
  }
  const raw = process.env[fallbackEnv];
  return raw || null;
}

// 同期版 (起動前に env のみで判定したいケース用)
export function getSecretSync(_envNameRef, fallbackEnv) {
  return process.env[fallbackEnv] || null;
}

// Secrets を起動時にまとめて読み込み、env を上書きする。
// 既に env に値があり Secret Manager 参照が無ければ何もしない。
export async function hydrateSecretsFromManager() {
  const mappings = [
    ['KASAN_SECRET_SESSION_NAME', 'KASAN_SESSION_SECRET'],
    ['KASAN_SECRET_GEMINI_NAME', 'GEMINI_API_KEY'],
    ['KASAN_SECRET_RECAPTCHA_NAME', 'RECAPTCHA_SECRET_KEY'],
    ['KASAN_SECRET_FIREBASE_SA_NAME', 'FIREBASE_SERVICE_ACCOUNT_JSON'],
  ];
  let count = 0;
  for (const [ref, target] of mappings) {
    const v = await getSecret(ref, target);
    if (v && !process.env[target]) {
      process.env[target] = v;
      count += 1;
    } else if (v && process.env[target] && process.env[target] !== v && process.env[ref]) {
      // Secret Manager の値を優先（CI/CD で env を上書きされても Secret Manager 側を信頼）
      process.env[target] = v;
      count += 1;
    }
  }
  return { hydratedCount: count };
}
