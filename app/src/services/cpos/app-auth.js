// CPOS ログイン（案Y: 別ドメイン運用 + B1 受け渡し）。
//
// フロー:
//   1. GET /api/auth/cpos/start    → CPOS の `/api/apps/kasan/connect` へ 302（state を署名 cookie に保存）
//   2. CPOS 同意後 GET /api/auth/cpos/callback?code&state
//   3. App Token で exchangeAppSessionCode(code) → { user, organizationId, allowedFacilityIds }
//   4. CPOS エンタイトルメントを取得して planTier を確定
//   5. 加算マネージャ独自の **サーバ側セッション cookie**（AES-GCM 封入）を発行
//
// Cookie には CPOS の token は入れない（s2s は App Token、ユーザー識別は CPOS から取得した値）。

import crypto from 'node:crypto';

import { sealCookie, unsealCookieDetailed, isSessionSecretConfigured } from '../../utils/cookie-seal.js';
import { defaultBaseUrl } from './client.js';
import { APP_ID, getAppCposClient, isAppCposConfigured } from './app-context.js';
import { getEntitlement } from './store.js';
import { isAdminEmail } from '../admin-emails.js';

export const SESSION_COOKIE_NAME = 'kasan_session';
const STATE_COOKIE_NAME = 'kasan_oauth_state';
const SESSION_MAX_AGE_SEC = 12 * 60 * 60; // 12 時間
const STATE_MAX_AGE_SEC = 10 * 60; // 10 分

export function isCposLoginEnabled() {
  return isSessionSecretConfigured() && isAppCposConfigured();
}

// ───────── 認可開始（B1 connect への URL） ─────────
export function buildConnectUrl({ redirectUri, state, baseUrl = defaultBaseUrl() }) {
  if (!baseUrl) throw new Error('cpos_base_url_unset');
  const u = new URL(`${baseUrl.replace(/\/+$/, '')}/api/apps/${encodeURIComponent(APP_ID)}/connect`);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  return u.toString();
}

export function newState() {
  return crypto.randomBytes(16).toString('hex');
}

// ───────── code → セッション ─────────
export async function loginWithCode(code) {
  const c = getAppCposClient();
  if (!c) {
    const e = new Error('cpos_not_configured');
    e.statusCode = 503;
    throw e;
  }
  const r = await c.exchangeAppSessionCode(APP_ID, code); // { user, organizationId, allowedFacilityIds, expiresIn }
  if (!r?.user?.id || !r.organizationId) {
    const e = new Error('invalid_exchange_response');
    e.statusCode = 502;
    throw e;
  }
  let ent = { status: 'none', expiresAt: null };
  try {
    ent = await getEntitlement({ organizationId: r.organizationId, userId: r.user.id });
  } catch {
    /* エンタイトルメント取得失敗時は free 扱い */
  }
  const planTier = ent.status === 'active' ? 'paid' : 'free';
  const session = buildSessionPayload({
    user: r.user,
    organizationId: r.organizationId,
    allowedFacilityIds: r.allowedFacilityIds || null,
    planTier,
    planExpiresAt: ent.expiresAt || null,
  });
  return { session, user: r.user, organizationId: r.organizationId };
}

export function buildSessionPayload({ user, organizationId, allowedFacilityIds, planTier, planExpiresAt }) {
  const now = Date.now();
  return {
    v: 1,
    kind: 'kasan_cpos_session',
    uid: user.id,
    email: user.email || null,
    name: user.name || null,
    role: user.role || 'staff',
    organizationId,
    allowedFacilityIds: allowedFacilityIds || null,
    planTier: planTier || 'free',
    planExpiresAt: planExpiresAt || null,
    createdAt: new Date(now).toISOString(),
    exp: now + SESSION_MAX_AGE_SEC * 1000,
  };
}

// セッション payload → req.user（plan 期限をローカル再評価）
export function resolveUser(session) {
  if (!session || session.kind !== 'kasan_cpos_session' || !session.uid) return null;
  let planTier = session.planTier || 'free';
  if (planTier === 'paid') {
    const exp = session.planExpiresAt ? new Date(session.planExpiresAt).getTime() : 0;
    if (!(exp > Date.now())) planTier = 'free';
  }
  return {
    uid: session.uid,
    email: session.email || null,
    displayName: session.name || null,
    role: session.role || 'staff',
    organizationId: session.organizationId,
    allowedFacilityIds: session.allowedFacilityIds || null,
    planTier,
    planExpiresAt: planTier === 'paid' ? session.planExpiresAt : null,
    isAdmin: session.role === 'admin' || isAdminEmail(session.email),
    authProvider: 'cpos',
  };
}

// ───────── Cookie ヘルパ ─────────
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}
function appendSetCookie(res, value) {
  const prev = res.getHeader('Set-Cookie');
  const arr = Array.isArray(prev) ? prev : prev ? [prev] : [];
  res.setHeader('Set-Cookie', [...arr, value]);
}
function cookieFlags() {
  const secure = process.env.KASAN_COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production';
  const sameSite = process.env.KASAN_COOKIE_SAMESITE || 'Lax';
  return { secure, sameSite };
}

export function readSession(req) {
  if (!isSessionSecretConfigured()) return null;
  const value = readCookie(req, SESSION_COOKIE_NAME);
  if (!value) return null;
  const r = unsealCookieDetailed(value);
  if (!r.ok) return null;
  return r.payload;
}

export function setSessionCookie(res, payload) {
  const sealed = sealCookie(payload);
  const { secure, sameSite } = cookieFlags();
  const maxAgeSec = Math.max(60, Math.floor((payload.exp - Date.now()) / 1000));
  appendSetCookie(
    res,
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sealed)}; HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=${maxAgeSec}` +
      (secure ? '; Secure' : ''),
  );
}

export function clearSessionCookie(res) {
  const { secure, sameSite } = cookieFlags();
  appendSetCookie(
    res,
    `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=0` + (secure ? '; Secure' : ''),
  );
}

// OAuth state（CSRF）: 署名 cookie に短期保存
export function setStateCookie(res, state) {
  const sealed = sealCookie({ state, exp: Date.now() + STATE_MAX_AGE_SEC * 1000 });
  const { secure, sameSite } = cookieFlags();
  appendSetCookie(
    res,
    `${STATE_COOKIE_NAME}=${encodeURIComponent(sealed)}; HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=${STATE_MAX_AGE_SEC}` +
      (secure ? '; Secure' : ''),
  );
}
export function verifyStateCookie(req, state) {
  const value = readCookie(req, STATE_COOKIE_NAME);
  if (!value || !state) return false;
  const r = unsealCookieDetailed(value);
  return r.ok && r.payload?.state === state;
}
export function clearStateCookie(res) {
  const { secure, sameSite } = cookieFlags();
  appendSetCookie(
    res,
    `${STATE_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=0` + (secure ? '; Secure' : ''),
  );
}
