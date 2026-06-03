// Google reCAPTCHA v3 検証ミドルウェア
//
// クライアントは grecaptcha.execute(siteKey, { action }) でトークンを取得し、
// multipart/form-data の `recaptcha_token` フィールド、または `X-Recaptcha-Token`
// ヘッダで送る。サーバはトークンを Google の siteverify API に POST して
// score を確認する。
//
// .env で制御:
//   RECAPTCHA_ENABLED       true/false  オン/オフ（site_key/secret が両方揃ったら自動で true）
//   RECAPTCHA_SITE_KEY      文字列      フロントが grecaptcha に渡す公開鍵
//   RECAPTCHA_SECRET_KEY    文字列      siteverify に渡す秘密鍵
//   RECAPTCHA_MIN_SCORE     0.0〜1.0    これ未満は拒否（デフォルト 0.5）

const SITEVERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

function envFloat(key, fallback) {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
}

function envBool(key, fallback) {
  const v = process.env[key];
  if (v == null) return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(v).toLowerCase());
}

const SITE_KEY = process.env.RECAPTCHA_SITE_KEY || '';
const SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || '';
const MIN_SCORE = envFloat('RECAPTCHA_MIN_SCORE', 0.5);
const EXPLICIT = process.env.RECAPTCHA_ENABLED;
const ENABLED = EXPLICIT == null ? Boolean(SITE_KEY && SECRET_KEY) : envBool('RECAPTCHA_ENABLED', false);

export const recaptchaConfig = {
  enabled: ENABLED && Boolean(SITE_KEY && SECRET_KEY),
  site_key: SITE_KEY || null,
  min_score: MIN_SCORE,
};

async function verifyToken(token, remoteIp) {
  const body = new URLSearchParams({ secret: SECRET_KEY, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: ctrl.signal,
    });
    if (!r.ok) {
      return { ok: false, reason: `siteverify HTTP ${r.status}` };
    }
    const json = await r.json();
    return { ok: true, json };
  } catch (err) {
    return { ok: false, reason: `siteverify error: ${err.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

// expectedAction は紐付けたい action 名（例: 'analyze' / 'judge'）
export function recaptchaMiddleware(expectedAction) {
  if (!recaptchaConfig.enabled) {
    return (_req, _res, next) => next();
  }
  return async (req, res, next) => {
    const token =
      (req.body && req.body.recaptcha_token) ||
      req.headers['x-recaptcha-token'] ||
      '';
    if (!token) {
      return res.status(400).json({
        error: 'recaptcha_missing',
        message: 'reCAPTCHA トークンが送信されていません。ページを再読込してから再度お試しください。',
      });
    }
    const result = await verifyToken(String(token), req.ip);
    if (!result.ok) {
      console.warn('[recaptcha] verify failure:', result.reason);
      return res.status(503).json({
        error: 'recaptcha_unavailable',
        message: '人間判定サービスに接続できませんでした。しばらく時間をおいて再度お試しください。',
      });
    }
    const { success, score, action, 'error-codes': errorCodes } = result.json || {};
    if (!success) {
      return res.status(403).json({
        error: 'recaptcha_failed',
        message: 'reCAPTCHA 検証に失敗しました。',
        codes: errorCodes,
      });
    }
    if (expectedAction && action && action !== expectedAction) {
      return res.status(403).json({
        error: 'recaptcha_action_mismatch',
        message: `reCAPTCHA action が想定と異なります（expected=${expectedAction}, actual=${action}）。`,
      });
    }
    if (typeof score === 'number' && score < MIN_SCORE) {
      return res.status(403).json({
        error: 'recaptcha_low_score',
        message: `自動アクセスの可能性が高いと判定されました（score=${score.toFixed(2)}）。`,
        score,
      });
    }
    req.recaptcha = { action, score };
    next();
  };
}
