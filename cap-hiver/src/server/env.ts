export interface Env {
  databaseUrl: string | null;
  sessionSecret: string;
  tokenKey: string | null;
  appUrl: string;
  cronSecret: string | null;
  anthropicKey: string | null;
  anthropicModel: string;
  stravaId: string | null;
  stravaSecret: string | null;
  stravaVerify: string | null;
  signupOpen: boolean;
  production: boolean;
}

const opt = (k: string): string | null => process.env[k]?.trim() || null;

export function env(): Env {
  const production = process.env['NODE_ENV'] === 'production';
  const secret = opt('SESSION_SECRET');
  if (production && (!secret || secret.length < 32)) throw new Error('SESSION_SECRET (32 caractères minimum) est requis en production.');
  return {
    databaseUrl: opt('DATABASE_URL'),
    sessionSecret: secret ?? 'dev-only-secret-change-me-dev-only-secret',
    tokenKey: opt('TOKEN_ENCRYPTION_KEY'),
    appUrl: (opt('APP_URL') ?? 'http://localhost:3000').replace(/\/$/, ''),
    cronSecret: opt('CRON_SECRET'),
    anthropicKey: opt('ANTHROPIC_API_KEY'),
    anthropicModel: opt('ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5',
    stravaId: opt('STRAVA_CLIENT_ID'),
    stravaSecret: opt('STRAVA_CLIENT_SECRET'),
    stravaVerify: opt('STRAVA_VERIFY_TOKEN'),
    signupOpen: (opt('SIGNUP') ?? 'open') !== 'closed',
    production,
  };
}
