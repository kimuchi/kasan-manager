// CSRF 対策ミドルウェア（double-submit cookie パターン）
//
// 指示書 §5:
//   - GET 時に kasan_csrf cookie をセット（HttpOnly では無い ＝ JS が読める）
//   - POST/PUT/DELETE では X-CSRF-Token ヘッダの値が cookie の値と一致しなければ 403
//   - JSON API のみ受け付ける（Content-Type: application/json）
//
// SameSite=Lax を併用しているのでクロスオリジンからの自動送信は基本的に拒否される。

import crypto from 'node:crypto';

const COOKIE_NAME = 'kasan_csrf';
const HEADER_NAME = 'x-csrf-token';
const TOKEN_LEN = 32; // bytes

function generateToken() {
  return crypto.randomBytes(TOKEN_LEN).toString('hex');
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

function appendSetCookie(res, value) {
  const prev = res.getHeader('Set-Cookie');
  const arr = Array.isArray(prev) ? prev : prev ? [prev] : [];
  res.setHeader('Set-Cookie', [...arr, value]);
}

// GET 時: cookie が無ければ新規発行。token を req.csrfToken に格納
export function csrfIssueMiddleware(req, res, next) {
  let token = readCookie(req, COOKIE_NAME);
  if (!token) {
    token = generateToken();
    const secure = process.env.KASAN_COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production';
    const sameSite = process.env.KASAN_COOKIE_SAMESITE || 'Lax';
    const cookie =
      `${COOKIE_NAME}=${token}; Path=/; SameSite=${sameSite}; Max-Age=${60 * 60 * 12}` +
      (secure ? '; Secure' : '');
    appendSetCookie(res, cookie);
  }
  req.csrfToken = token;
  next();
}

// 変更系（POST/PUT/DELETE）でのみ検証
export function csrfVerifyMiddleware(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  // CSRF skip 対象: ファイルアップロード（multipart）はブラウザフォーム由来で SameSite に守られている。
  // ただし簡素化のため、CSRF はすべての mutating リクエストに適用する設計にする。
  const cookieToken = readCookie(req, COOKIE_NAME);
  const headerToken = (req.headers[HEADER_NAME] || '').toString();
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({
      ok: false,
      error: 'csrf_token_mismatch',
      message: 'CSRF トークンが一致しません。ページを再読込してから再度お試しください。',
    });
  }
  next();
}

export const CSRF_COOKIE_NAME = COOKIE_NAME;
export const CSRF_HEADER_NAME = HEADER_NAME;
