// HTTP-only sealed cookie のための暗号化・復号ユーティリティ。
//
// AES-256-GCM で認証付き暗号化。鍵は KASAN_SESSION_SECRET から HKDF で導出。
// IV (12B) || ciphertext || tag (16B) を base64url で 1 つの Cookie 値にする。
//
// 設計方針（指示書 §0 / §3）:
//   - PAT を含む payload は加算マネージャ DB / ファイル / ログに永続保存しない
//   - Cookie 値だけが復号鍵を持つ（鍵が漏れない限り平文化不能）
//   - max age 経過後は復号失敗で connected=false 扱いになる

import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const MIN_SECRET_LEN = 32;

let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;
  const secret = process.env.KASAN_SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LEN) {
    throw new Error(
      `KASAN_SESSION_SECRET が未設定または短すぎます（${MIN_SECRET_LEN} 文字以上必要）。\n` +
        '本番では起動失敗にしてください（セキュリティ要件）。',
    );
  }
  // HKDF-like: SHA-256(secret) を鍵に使う（簡易）
  cachedKey = crypto.createHash('sha256').update(secret).digest();
  return cachedKey;
}

export function isSessionSecretConfigured() {
  const s = process.env.KASAN_SESSION_SECRET;
  return Boolean(s && s.length >= MIN_SECRET_LEN);
}

// payload は任意の JSON。{ exp: epochMs } を持つと自動で期限切れチェックが働く。
export function sealCookie(payload) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const json = JSON.stringify(payload);
  const enc = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const buf = Buffer.concat([iv, enc, tag]);
  return buf.toString('base64url');
}

export function unsealCookie(value) {
  if (!value || typeof value !== 'string') return null;
  const key = getKey();
  let buf;
  try {
    buf = Buffer.from(value, 'base64url');
  } catch {
    return null;
  }
  if (buf.length < IV_LEN + TAG_LEN + 1) return null;
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const enc = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  let dec;
  try {
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    dec = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return null; // tag mismatch / 改ざんなど
  }
  let payload;
  try {
    payload = JSON.parse(dec);
  } catch {
    return null;
  }
  if (payload && typeof payload === 'object' && typeof payload.exp === 'number') {
    if (payload.exp < Date.now()) return null;
  }
  return payload;
}

// PAT などの「プレビュー」を作る（先頭 14 文字 + ...REDACTED）
export function tokenPreview(token) {
  if (!token) return '';
  if (typeof token !== 'string') return '***';
  if (token.length <= 16) return `${token.slice(0, 4)}...REDACTED`;
  return `${token.slice(0, 14)}...${token.slice(-4)}`;
}

// ログ用の secret マスク（指示書 §6.2）
export function redactSecret(value) {
  if (!value) return '';
  if (typeof value !== 'string') return '***REDACTED***';
  if (value.startsWith('cpos_pat_')) return `${value.slice(0, 14)}...REDACTED`;
  return '***REDACTED***';
}
