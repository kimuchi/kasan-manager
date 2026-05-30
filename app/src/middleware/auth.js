// 認証ミドルウェア（CPOS ログイン一本化）。
//
// 認証は CPOS のアプリ連携（案Y: B1 受け渡し）で確立した、加算マネージャ独自の
// サーバ側セッション cookie（kasan_session, AES-GCM 封入）で行う。
//   - authMiddleware: セッションがあれば req.user を populate（無くても 401 にしない＝無料動作は継続）
//   - requireAuth:  req.user が無ければ 401
//   - requirePaid:  CPOS エンタイトルメントが active（planTier==='paid'）でなければ 402
//   - requireAdmin: CPOS role==='admin'（または KASAN_ADMIN_EMAILS）でなければ 403
//
// req.user = { uid, email, displayName, role, organizationId, allowedFacilityIds,
//              planTier, planExpiresAt, isAdmin, authProvider:'cpos' }

import { readSession, resolveUser } from '../services/cpos/app-auth.js';

export async function authMiddleware(req, _res, next) {
  try {
    const session = readSession(req);
    if (session) {
      const user = resolveUser(session);
      if (user) req.user = user;
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[auth] session resolve failed: ${err.message}`);
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user?.uid) {
    return res.status(401).json({ ok: false, error: 'auth_required', message: 'CPOS でログインしてください' });
  }
  next();
}

export function requirePaid(req, res, next) {
  if (!req.user?.uid) {
    return res.status(401).json({ ok: false, error: 'auth_required', message: 'CPOS でログインしてください' });
  }
  if (req.user.planTier !== 'paid') {
    return res.status(402).json({
      ok: false,
      error: 'paid_required',
      message: 'この機能は有料プラン専用です。CPOS の管理者にエンタイトルメント付与を依頼してください。',
    });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user?.uid) {
    return res.status(401).json({ ok: false, error: 'auth_required', message: 'CPOS でログインしてください' });
  }
  if (!req.user.isAdmin) {
    return res.status(403).json({ ok: false, error: 'admin_required', message: '管理者権限が必要です' });
  }
  next();
}
