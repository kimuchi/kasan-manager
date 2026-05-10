// CPOS PAT セッションのライフサイクル管理
//
// 指示書 §3 の sealed cookie 方式を実装する。
//   - sealCpoSession({ baseUrl, token, ...meta })  → 暗号化済み cookie 値
//   - readCposSession(req) → 復号 payload（または null）
//   - setCposSessionCookie(res, value, maxAgeSec)
//   - clearCposSessionCookie(res)

import {
  sealCookie,
  unsealCookieDetailed,
  tokenPreview as makeTokenPreview,
} from '../../utils/cookie-seal.js';

export const COOKIE_NAME = 'kasan_cpos_session';
const DEFAULT_MAX_AGE_SEC = 90 * 24 * 60 * 60; // 90 日（指示書推奨上限）

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

// 失敗理由付きで session を返す。サーバ側の診断ログ用。
export function readCposSessionDetailed(req) {
  const value = readCookie(req, COOKIE_NAME);
  if (!value) return { session: null, reason: 'missing_cookie' };
  const r = unsealCookieDetailed(value);
  if (!r.ok) return { session: null, reason: r.reason, detail: r };
  return { session: r.payload, reason: null };
}

// 後方互換用の薄いラッパ
export function readCposSession(req) {
  return readCposSessionDetailed(req).session;
}

export function buildSessionPayload({ cposBaseUrl, token, me, expiresAtFromCpos = null }) {
  const now = Date.now();
  // CPOS PAT の expiresAt があればそれを優先。無ければ 90 日
  const expFromCpos = expiresAtFromCpos ? Date.parse(expiresAtFromCpos) : null;
  const expDefault = now + DEFAULT_MAX_AGE_SEC * 1000;
  const exp = expFromCpos && Number.isFinite(expFromCpos) ? Math.min(expFromCpos, expDefault) : expDefault;

  return {
    v: 1,
    cposBaseUrl,
    token,
    tokenPreview: makeTokenPreview(token),
    subjectUserId: me?.user?.id || me?.id || null,
    subjectUserEmail: me?.user?.email || me?.email || null,
    subjectUserName: me?.user?.name || me?.name || null,
    subjectUserRole: me?.user?.role || me?.role || null,
    scopes: me?.token?.scopes || me?.scopes || [],
    allowedFacilityIds: me?.token?.allowedFacilityIds || me?.allowedFacilityIds || null,
    authMethod: me?.token?.authMethod || me?.authMethod || 'personal_access_token',
    expiresAtFromCpos: expiresAtFromCpos || null,
    createdAt: new Date(now).toISOString(),
    exp,
  };
}

export function setCposSessionCookie(res, payload) {
  const sealed = sealCookie(payload);
  const secure = process.env.KASAN_COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production';
  const sameSite = process.env.KASAN_COOKIE_SAMESITE || 'Lax';
  const maxAgeSec = Math.max(60, Math.floor((payload.exp - Date.now()) / 1000));
  const cookie =
    `${COOKIE_NAME}=${encodeURIComponent(sealed)}; HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=${maxAgeSec}` +
    (secure ? '; Secure' : '');
  appendSetCookie(res, cookie);
}

export function clearCposSessionCookie(res) {
  const secure = process.env.KASAN_COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production';
  const sameSite = process.env.KASAN_COOKIE_SAMESITE || 'Lax';
  const cookie =
    `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=0` + (secure ? '; Secure' : '');
  appendSetCookie(res, cookie);
}

function appendSetCookie(res, value) {
  const prev = res.getHeader('Set-Cookie');
  const arr = Array.isArray(prev) ? prev : prev ? [prev] : [];
  res.setHeader('Set-Cookie', [...arr, value]);
}

// publicView: PAT 平文を含まないビュー（クライアントへ返す）
export function toPublicSessionView(session) {
  if (!session) return null;
  return {
    connected: true,
    cposBaseUrl: session.cposBaseUrl,
    user: {
      id: session.subjectUserId,
      email: session.subjectUserEmail,
      name: session.subjectUserName,
      role: session.subjectUserRole,
    },
    token: {
      tokenPreview: session.tokenPreview,
      scopes: session.scopes || [],
      allowedFacilityIds: session.allowedFacilityIds || null,
      authMethod: session.authMethod,
      expiresAt: session.expiresAtFromCpos || new Date(session.exp).toISOString(),
      createdAt: session.createdAt,
    },
  };
}
