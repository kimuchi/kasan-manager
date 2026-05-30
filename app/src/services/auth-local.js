// ネイティブ（ユーザー名/パスワード）認証。
//
// Firebase を使わずに「メールアドレス + パスワード」でログインできるようにする。
// - パスワードは scrypt でハッシュ化して保存（平文は保持しない）
// - ログイン成功時、AES-256-GCM で封入したセッション Cookie（kasan_session）を発行
//   （CPOS セッションと同じ cookie-seal 基盤を共有。KASAN_SESSION_SECRET が必要）
//
// OAuth（Google 等）は引き続き Firebase 側で処理する。ネイティブと OAuth は併存する。

import crypto from 'node:crypto';

import { sealCookie, unsealCookieDetailed, isSessionSecretConfigured } from '../utils/cookie-seal.js';
import { createLocalUser, findUserByEmail, getUserRecord, touchLastLogin } from './users.js';

export const SESSION_COOKIE_NAME = 'kasan_session';
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 日
const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

// ---- パスワードハッシュ ----

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[2], 'base64');
    expected = Buffer.from(parts[3], 'base64');
  } catch {
    return false;
  }
  let dk;
  try {
    dk = crypto.scryptSync(String(password), salt, expected.length, { ...SCRYPT_PARAMS, N });
  } catch {
    return false;
  }
  if (dk.length !== expected.length) return false;
  return crypto.timingSafeEqual(dk, expected);
}

// ---- バリデーション ----

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

// パスワードは 8 文字以上・英字と数字を含む
export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 200) return false;
  return /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);
}

// ---- セッション Cookie ----

export function isLocalAuthEnabled() {
  return isSessionSecretConfigured();
}

export function buildSessionPayload({ uid, email }) {
  const now = Date.now();
  return {
    v: 1,
    kind: 'kasan_session',
    uid,
    email: email || null,
    createdAt: new Date(now).toISOString(),
    exp: now + SESSION_MAX_AGE_SEC * 1000,
  };
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

// セッション Cookie を検証して payload を返す（無効なら null）
export function readSession(req) {
  if (!isLocalAuthEnabled()) return null;
  const value = readCookie(req, SESSION_COOKIE_NAME);
  if (!value) return null;
  const r = unsealCookieDetailed(value);
  if (!r.ok) return null;
  const p = r.payload;
  if (!p || p.kind !== 'kasan_session' || !p.uid) return null;
  return p;
}

function appendSetCookie(res, value) {
  const prev = res.getHeader('Set-Cookie');
  const arr = Array.isArray(prev) ? prev : prev ? [prev] : [];
  res.setHeader('Set-Cookie', [...arr, value]);
}

export function setSessionCookie(res, payload) {
  const sealed = sealCookie(payload);
  const secure = process.env.KASAN_COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production';
  const sameSite = process.env.KASAN_COOKIE_SAMESITE || 'Lax';
  const maxAgeSec = Math.max(60, Math.floor((payload.exp - Date.now()) / 1000));
  const cookie =
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sealed)}; HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=${maxAgeSec}` +
    (secure ? '; Secure' : '');
  appendSetCookie(res, cookie);
}

export function clearSessionCookie(res) {
  const secure = process.env.KASAN_COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production';
  const sameSite = process.env.KASAN_COOKIE_SAMESITE || 'Lax';
  const cookie =
    `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=0` + (secure ? '; Secure' : '');
  appendSetCookie(res, cookie);
}

// ---- 登録 / ログイン ----

function genLocalUid() {
  return `local_${crypto.randomBytes(12).toString('hex')}`;
}

// 新規ネイティブ登録。成功で { user, session } を返す。
// throw: 'local_auth_disabled' | 'invalid_email' | 'weak_password' | 'email_taken'
export async function registerLocalUser({ email, password, displayName }) {
  if (!isLocalAuthEnabled()) throw new Error('local_auth_disabled');
  if (!validateEmail(email)) throw new Error('invalid_email');
  if (!validatePassword(password)) throw new Error('weak_password');
  const existing = await findUserByEmail(email);
  if (existing) throw new Error('email_taken');
  const uid = genLocalUid();
  const passwordHash = hashPassword(password);
  const user = await createLocalUser({ uid, email, displayName, passwordHash });
  const session = buildSessionPayload({ uid, email: user.email });
  return { user, session };
}

// ネイティブログイン。成功で { user, session } を返す。
// throw: 'local_auth_disabled' | 'invalid_credentials'
export async function loginLocalUser({ email, password }) {
  if (!isLocalAuthEnabled()) throw new Error('local_auth_disabled');
  if (!validateEmail(email) || typeof password !== 'string') throw new Error('invalid_credentials');
  const found = await findUserByEmail(email);
  // タイミング差を減らすため、ユーザー不在でもダミー検証を行う
  const stored = found?.passwordHash || 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAA';
  const ok = verifyPassword(password, stored);
  if (!found || found.authProvider !== 'local' || !ok) throw new Error('invalid_credentials');
  await touchLastLogin(found.uid);
  const session = buildSessionPayload({ uid: found.uid, email: found.email });
  return { user: found, session };
}

// セッション Cookie から req.user 相当の最小情報を復元（middleware 用）。
export async function resolveUserFromSession(session) {
  if (!session?.uid) return null;
  const rec = await getUserRecord(session.uid);
  if (!rec) return null;
  return rec;
}
