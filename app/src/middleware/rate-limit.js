// IP ベースのレート制限ミドルウェア
//
// 一般 API （/api/services, /api/health, /api/judge）と Gemini を呼ぶ高コスト API
// （/api/analyze, /api/import-receipt）で別リミッタを用意する。
//
// .env で各上限と窓を制御:
//   RATE_LIMIT_ENABLED          true/false   全体オン/オフ（デフォルト true）
//   RATE_LIMIT_GENERAL_MAX      数値         一般 API の上限（デフォルト 60）
//   RATE_LIMIT_GENERAL_WINDOW_MS 数値        一般 API の窓ミリ秒（デフォルト 600000 = 10分）
//   RATE_LIMIT_HEAVY_MAX        数値         高コスト API の上限（デフォルト 10）
//   RATE_LIMIT_HEAVY_WINDOW_MS  数値         高コスト API の窓ミリ秒（デフォルト 600000）

import rateLimit from 'express-rate-limit';

function envInt(key, fallback) {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function envBool(key, fallback) {
  const v = process.env[key];
  if (v == null) return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(v).toLowerCase());
}

const ENABLED = envBool('RATE_LIMIT_ENABLED', true);
const GENERAL_MAX = envInt('RATE_LIMIT_GENERAL_MAX', 60);
const GENERAL_WINDOW = envInt('RATE_LIMIT_GENERAL_WINDOW_MS', 10 * 60 * 1000);
const HEAVY_MAX = envInt('RATE_LIMIT_HEAVY_MAX', 10);
const HEAVY_WINDOW = envInt('RATE_LIMIT_HEAVY_WINDOW_MS', 10 * 60 * 1000);

function rejected(label) {
  return (req, res /*, next, options */) => {
    const retryAfter = Number(res.getHeader('Retry-After')) || Math.ceil(req.rateLimit.resetTime?.getTime?.() - Date.now()) / 1000 || 60;
    res.status(429).json({
      error: 'rate_limit_exceeded',
      message: `${label}: アクセスが集中しています。しばらく時間をおいてから再度お試しください。`,
      retry_after_seconds: Math.max(1, Math.ceil(retryAfter)),
    });
  };
}

const passthrough = (_req, _res, next) => next();

export const generalLimiter = ENABLED
  ? rateLimit({
      windowMs: GENERAL_WINDOW,
      max: GENERAL_MAX,
      standardHeaders: 'draft-7', // RateLimit-* ヘッダで通知
      legacyHeaders: false,
      handler: rejected('一般 API レート制限'),
    })
  : passthrough;

export const heavyLimiter = ENABLED
  ? rateLimit({
      windowMs: HEAVY_WINDOW,
      max: HEAVY_MAX,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: rejected('AI 分析レート制限'),
    })
  : passthrough;

export const rateLimitConfig = {
  enabled: ENABLED,
  general: { max: GENERAL_MAX, window_ms: GENERAL_WINDOW },
  heavy: { max: HEAVY_MAX, window_ms: HEAVY_WINDOW },
};
