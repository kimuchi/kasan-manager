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
import { CposClient, defaultBaseUrl } from './client.js';
import { APP_ID, getAppCposClient, isAppCposConfigured, isFakeMode } from './app-context.js';
import { getEntitlement } from './store.js';
import { isAdminEmail } from '../admin-emails.js';

export const SESSION_COOKIE_NAME = 'kasan_session';
const STATE_COOKIE_NAME = 'kasan_oauth_state';
// CPOS が .care-planning.co.jp に発行するセッション cookie 名（ゲートウェイ方式で本人確認に転送）
const CPOS_SESSION_COOKIE_NAME = process.env.KASAN_CPOS_SESSION_COOKIE_NAME || 'cpos_session';
const SESSION_MAX_AGE_SEC = 12 * 60 * 60; // 12 時間
const STATE_MAX_AGE_SEC = 10 * 60; // 10 分

export function isCposLoginEnabled() {
  return isSessionSecretConfigured() && isAppCposConfigured();
}

// ───────── 認可開始 ─────────
// 旧方式: CPOS の B1 connect（redirect_uri 許可リストに依存）。CPOS 側に許可実装があるときだけ使う。
export function buildConnectUrl({ redirectUri, state, baseUrl = defaultBaseUrl() }) {
  if (!baseUrl) throw new Error('cpos_base_url_unset');
  const u = new URL(`${baseUrl.replace(/\/+$/, '')}/api/apps/${encodeURIComponent(APP_ID)}/connect`);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  return u.toString();
}

// 新方式（既定）: CPOS 共通ログインゲートウェイ /api/auth/login?next=...。
// CPOS の ALLOWED_ORIGIN_SUFFIXES=.care-planning.co.jp に依存するため redirect_uri 許可登録が不要。
export function buildLoginGatewayUrl({ nextUrl, baseUrl = defaultBaseUrl() }) {
  if (!baseUrl) throw new Error('cpos_base_url_unset');
  if (!nextUrl) throw new Error('next_url_unset');
  const u = new URL(`${baseUrl.replace(/\/+$/, '')}/api/auth/login`);
  u.searchParams.set('next', nextUrl);
  return u.toString();
}

// 認証フローの切り替え。既定は 'gateway'（connect にすると invalid_redirect_uri が再発しうる）。
export function cposAuthFlow() {
  return process.env.KASAN_CPOS_AUTH_FLOW || 'gateway';
}

// 開始 URL を構築（flow に応じて gateway / connect を出し分け）。
export function buildCposStartUrl({ redirectUri, state, baseUrl = defaultBaseUrl() }) {
  const flow = cposAuthFlow();
  if (flow === 'connect') {
    return buildConnectUrl({ redirectUri, state, baseUrl });
  }
  // gateway: state は next（= callback URL）のクエリに載せて戻してもらう
  const nextUrl = new URL(redirectUri);
  nextUrl.searchParams.set('state', state);
  return buildLoginGatewayUrl({ nextUrl: nextUrl.toString(), baseUrl });
}

export function newState() {
  return crypto.randomBytes(16).toString('hex');
}

// CPOS へ転送してよい cookie は cpos_session だけ。kasan_session 等は送らない。
export function pickRawCookiePair(req, name) {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed; // "cpos_session=..." をそのまま返す
  }
  return null;
}

// ───────── CPOS identity → セッション（共通） ─────────
async function buildSessionFromCposIdentity({ user, organizationId, allowedFacilityIds = null }) {
  if (!user?.id || !organizationId) {
    const e = new Error('invalid_cpos_identity');
    e.statusCode = 502;
    throw e;
  }
  let ent = { status: 'none', expiresAt: null };
  try {
    ent = await getEntitlement({ organizationId, userId: user.id });
  } catch {
    /* エンタイトルメント取得失敗時は free 扱い */
  }
  const planTier = ent.status === 'active' ? 'paid' : 'free';
  const session = buildSessionPayload({
    user,
    organizationId,
    allowedFacilityIds,
    planTier,
    planExpiresAt: ent.expiresAt || null,
  });
  return { session, user, organizationId };
}

// ───────── code → セッション（旧 connect 方式の互換） ─────────
export async function loginWithCode(code) {
  const c = getAppCposClient();
  if (!c) {
    const e = new Error('cpos_not_configured');
    e.statusCode = 503;
    throw e;
  }
  const r = await c.exchangeAppSessionCode(APP_ID, code); // { user, organizationId, allowedFacilityIds, expiresIn }
  return buildSessionFromCposIdentity({
    user: r?.user,
    organizationId: r?.organizationId,
    allowedFacilityIds: r?.allowedFacilityIds || null,
  });
}

// ───────── cpos_session cookie → セッション（ゲートウェイ方式・本命） ─────────
export async function loginWithCposCookie(req) {
  const cookiePair = pickRawCookiePair(req, CPOS_SESSION_COOKIE_NAME);
  if (!cookiePair) {
    const e = new Error(
      `${CPOS_SESSION_COOKIE_NAME} cookie が見つかりません。CPOS側の AUTH_COOKIE_DOMAIN=.care-planning.co.jp / AUTH_COOKIE_SAMESITE=Lax を確認してください。`,
    );
    e.statusCode = 401;
    throw e;
  }
  const baseUrl = defaultBaseUrl();
  if (!baseUrl) {
    const e = new Error('cpos_base_url_unset');
    e.statusCode = 503;
    throw e;
  }
  // 本番は token なしクライアント（Bearer を付けない）。Fake モードはプロセス内 Fake を使う。
  const c = isFakeMode() ? getAppCposClient() : new CposClient({ baseUrl, token: null });
  const me = await c.getAuthMeWithCookie(cookiePair);
  const orgId = me?.organizationId || me?.user?.organizationId || me?.organization?.id || null;
  if (!me || me.ok === false || !me.user?.id || !orgId) {
    const e = new Error('CPOS /api/auth/me のレスポンスが不正です');
    e.statusCode = 502;
    throw e;
  }
  return buildSessionFromCposIdentity({
    user: {
      id: me.user.id,
      email: me.user.email || null,
      name: me.user.name || null,
      role: me.user.role || 'staff',
    },
    organizationId: orgId,
    // 現行 CPOS /api/auth/me が allowedFacilityIds を返さない場合は null（＝制限なし扱い）。
    allowedFacilityIds: me.allowedFacilityIds || me.user?.allowedFacilityIds || null,
  });
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
