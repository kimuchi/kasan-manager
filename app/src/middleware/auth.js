// Firebase Authentication middleware.
//
// - authMiddleware: Authorization: Bearer <ID token> があれば検証して req.user を populate。
//   トークンが無い/不正でも 401 は返さない（無料ユーザーが解析を回せるようにするため）。
// - requireAuth: req.user がなければ 401。
// - requirePaid: req.user.planTier === 'paid' でなければ 402（または 403）。
// - requireAdmin: req.user.isAdmin でなければ 403。

import { getAuthClient } from '../services/firebase-admin.js';
import { ensureUser, getUserSummary, isAdminEmail } from '../services/users.js';
import { readSession, resolveUserFromSession } from '../services/auth-local.js';

const tokenCache = new Map(); // idTokenHash -> { decoded, expAt }
const CACHE_TTL_MS = 60 * 1000;

function extractToken(req) {
  const h = req.headers.authorization || req.headers.Authorization;
  if (!h || typeof h !== 'string') return null;
  if (!h.toLowerCase().startsWith('bearer ')) return null;
  return h.slice(7).trim() || null;
}

function cacheKey(token) {
  // 軽い hash で十分（高頻度の同一トークン検証だけスキップしたい）
  let h = 0;
  for (let i = 0; i < token.length; i += 1) {
    h = ((h << 5) - h + token.charCodeAt(i)) | 0;
  }
  return String(h);
}

export async function authMiddleware(req, _res, next) {
  // 1) Firebase ID トークン（Google OAuth / Firebase email-password）
  const token = extractToken(req);
  if (token) {
    try {
      const auth = getAuthClient();
      if (auth) {
        const key = cacheKey(token);
        const cached = tokenCache.get(key);
        let decoded;
        if (cached && cached.expAt > Date.now()) {
          decoded = cached.decoded;
        } else {
          decoded = await auth.verifyIdToken(token);
          tokenCache.set(key, { decoded, expAt: Date.now() + CACHE_TTL_MS });
        }
        const uid = decoded.uid;
        const email = decoded.email || null;
        const emailVerified = decoded.email_verified === true;
        await ensureUser({ uid, email, emailVerified, displayName: decoded.name || null });
        const summary = await getUserSummary(uid);
        req.user = {
          uid,
          email,
          emailVerified,
          displayName: decoded.name || null,
          planTier: summary.planTier,
          planExpiresAt: summary.planExpiresAt,
          isAdmin: isAdminEmail(email),
          authProvider: 'firebase',
        };
      }
    } catch (err) {
      // 検証失敗時は無視（無料動作にフォールバック）。ログだけ残す。
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[auth] verifyIdToken failed: ${err.message}`);
      }
    }
  }

  // 2) ネイティブ（ユーザー名/パスワード）セッション Cookie
  if (!req.user?.uid) {
    try {
      const session = readSession(req);
      if (session) {
        const rec = await resolveUserFromSession(session);
        if (rec) {
          const summary = await getUserSummary(rec.uid);
          req.user = {
            uid: rec.uid,
            email: rec.email || null,
            emailVerified: Boolean(rec.emailVerified),
            displayName: rec.displayName || null,
            planTier: summary.planTier,
            planExpiresAt: summary.planExpiresAt,
            isAdmin: isAdminEmail(rec.email) || rec.isAdmin === true,
            authProvider: 'local',
          };
        }
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[auth] session resolve failed: ${err.message}`);
      }
    }
  }

  next();
}

export function requireAuth(req, res, next) {
  if (!req.user?.uid) {
    return res.status(401).json({ ok: false, error: 'auth_required', message: 'ログインが必要です' });
  }
  next();
}

export function requirePaid(req, res, next) {
  if (!req.user?.uid) {
    return res.status(401).json({ ok: false, error: 'auth_required', message: 'ログインが必要です' });
  }
  if (req.user.planTier !== 'paid') {
    return res.status(402).json({
      ok: false,
      error: 'paid_required',
      message: 'この機能は有料プラン専用です。アクセスコードを入力して有効化してください。',
    });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user?.uid) {
    return res.status(401).json({ ok: false, error: 'auth_required', message: 'ログインが必要です' });
  }
  if (!req.user.isAdmin) {
    return res.status(403).json({ ok: false, error: 'admin_required', message: '管理者権限が必要です' });
  }
  next();
}
